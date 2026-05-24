import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple
} from "@langchain/langgraph";
import type { DatabaseSync } from "node:sqlite";

type ChannelVersions = Record<string, string | number>;
type CheckpointListOptions = {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
};
type PendingWrite = [string, unknown];
type StoredPendingWrite = [string, string, unknown];

type CheckpointRow = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_blob: Uint8Array;
  metadata_type: string;
  metadata_blob: Uint8Array;
};

type CheckpointWriteRow = {
  task_id: string;
  channel: string;
  value_type: string;
  value_blob: Uint8Array;
};

const SPECIAL_WRITE_INDEX: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4
};

// 创建基于 node:sqlite 的 LangGraph checkpointer, 用于恢复 interrupt 审批.
export function createSqliteCheckpointSaver(db: DatabaseSync) {
  return new AikoSqliteCheckpointSaver(db);
}

class AikoSqliteCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: DatabaseSync) {
    super();
  }

  // 读取指定 checkpoint, 如果没有 checkpoint_id 则读取线程最新 checkpoint.
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = readThreadId(config);
    if (!threadId) return undefined;

    const checkpointNs = readCheckpointNamespace(config);
    const checkpointId = readCheckpointId(config);
    const row = checkpointId
      ? this.db.prepare(`
          SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
                 checkpoint_type, checkpoint_blob, metadata_type, metadata_blob
          FROM langgraph_checkpoints
          WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
        `).get(threadId, checkpointNs, checkpointId) as CheckpointRow | undefined
      : this.db.prepare(`
          SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
                 checkpoint_type, checkpoint_blob, metadata_type, metadata_blob
          FROM langgraph_checkpoints
          WHERE thread_id = ? AND checkpoint_ns = ?
          ORDER BY checkpoint_id DESC
          LIMIT 1
        `).get(threadId, checkpointNs) as CheckpointRow | undefined;

    return row ? await this.rowToTuple(row) : undefined;
  }

  // 列出符合 thread, namespace 和过滤条件的 checkpoint 历史.
  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadIds = readThreadId(config) ? [readThreadId(config) as string] : this.listThreadIds();
    const configCheckpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const configCheckpointId = readCheckpointId(config);
    const beforeCheckpointId = readCheckpointId(options?.before);
    let remaining = options?.limit;

    for (const threadId of threadIds) {
      const rows = this.db.prepare(`
        SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
               checkpoint_type, checkpoint_blob, metadata_type, metadata_blob
        FROM langgraph_checkpoints
        WHERE thread_id = ?
        ORDER BY checkpoint_ns ASC, checkpoint_id DESC
      `).all(threadId) as CheckpointRow[];

      for (const row of rows) {
        if (configCheckpointNs !== undefined && row.checkpoint_ns !== configCheckpointNs) continue;
        if (configCheckpointId && row.checkpoint_id !== configCheckpointId) continue;
        if (beforeCheckpointId && row.checkpoint_id >= beforeCheckpointId) continue;

        const tuple = await this.rowToTuple(row);
        if (options?.filter && !metadataMatchesFilter(tuple.metadata, options.filter)) continue;

        if (remaining !== undefined) {
          if (remaining <= 0) return;
          remaining -= 1;
        }
        yield tuple;
      }
    }
  }

  // 写入一个完整 checkpoint, 返回 LangGraph 后续写入要使用的新配置.
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = readThreadId(config);
    if (!threadId) {
      throw new Error("AikoSqliteCheckpointSaver requires configurable.thread_id when putting checkpoints.");
    }

    const checkpointNs = readCheckpointNamespace(config);
    const parentCheckpointId = readCheckpointId(config) || null;
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [checkpointType, checkpointBlob] = await this.serde.dumpsTyped(preparedCheckpoint);
    const [metadataType, metadataBlob] = await this.serde.dumpsTyped(metadata);

    this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_checkpoints (
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        checkpoint_type,
        checkpoint_blob,
        metadata_type,
        metadata_blob,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      checkpointNs,
      checkpoint.id,
      parentCheckpointId,
      checkpointType,
      checkpointBlob,
      metadataType,
      metadataBlob,
      new Date().toISOString()
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id
      }
    };
  }

  // 保存节点中间写入, 让同一 super-step 恢复时不用重跑已成功节点.
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = readThreadId(config);
    const checkpointId = readCheckpointId(config);
    if (!threadId) {
      throw new Error("AikoSqliteCheckpointSaver requires configurable.thread_id when putting writes.");
    }
    if (!checkpointId) {
      throw new Error("AikoSqliteCheckpointSaver requires configurable.checkpoint_id when putting writes.");
    }

    const checkpointNs = readCheckpointNamespace(config);
    for (const [index, [channel, value]] of writes.entries()) {
      const writeIndex = SPECIAL_WRITE_INDEX[channel] ?? index;
      const [valueType, valueBlob] = await this.serde.dumpsTyped(value);
      const statement = writeIndex >= 0
        ? `INSERT OR IGNORE INTO langgraph_checkpoint_writes (
            thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value_type, value_blob, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT OR REPLACE INTO langgraph_checkpoint_writes (
            thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value_type, value_blob, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      this.db.prepare(statement).run(
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        writeIndex,
        channel,
        valueType,
        valueBlob,
        new Date().toISOString()
      );
    }
  }

  // 删除某个 LangGraph thread 的所有 checkpoint 和 pending writes.
  async deleteThread(threadId: string): Promise<void> {
    this.db.prepare("DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM langgraph_checkpoints WHERE thread_id = ?").run(threadId);
  }

  // 把数据库行还原成 LangGraph 需要的 checkpoint tuple.
  private async rowToTuple(row: CheckpointRow): Promise<CheckpointTuple> {
    const checkpoint = await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint_blob) as Checkpoint;
    const metadata = await this.serde.loadsTyped(row.metadata_type, row.metadata_blob) as CheckpointMetadata;
    const pendingWrites = await this.readPendingWrites(row);
    const tuple: CheckpointTuple = {
      config: checkpointConfig(row.thread_id, row.checkpoint_ns, row.checkpoint_id),
      checkpoint,
      metadata,
      pendingWrites: pendingWrites as CheckpointTuple["pendingWrites"]
    };

    if (row.parent_checkpoint_id) {
      tuple.parentConfig = checkpointConfig(row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id);
    }
    return tuple;
  }

  // 读取某个 checkpoint 附带的 pending writes.
  private async readPendingWrites(row: CheckpointRow): Promise<StoredPendingWrite[]> {
    const rows = this.db.prepare(`
      SELECT task_id, channel, value_type, value_blob
      FROM langgraph_checkpoint_writes
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY idx ASC, task_id ASC
    `).all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as CheckpointWriteRow[];

    const result: StoredPendingWrite[] = [];
    for (const write of rows) {
      result.push([
        write.task_id,
        write.channel,
        await this.serde.loadsTyped(write.value_type, write.value_blob)
      ]);
    }
    return result;
  }

  // 列出当前数据库里存在的 LangGraph thread id.
  private listThreadIds() {
    const rows = this.db.prepare(`
      SELECT DISTINCT thread_id
      FROM langgraph_checkpoints
      ORDER BY thread_id ASC
    `).all() as Array<{ thread_id: string }>;

    return rows.map((row) => row.thread_id);
  }
}

// 读取 LangGraph 线程 id.
function readThreadId(config: RunnableConfig | undefined): string | undefined {
  const value = config?.configurable?.thread_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// 读取 checkpoint namespace, root graph 使用空字符串.
function readCheckpointNamespace(config: RunnableConfig | undefined): string {
  const value = config?.configurable?.checkpoint_ns;
  return typeof value === "string" ? value : "";
}

// 兼容 LangGraph 新旧 checkpoint id 字段.
function readCheckpointId(config: RunnableConfig | undefined): string {
  const checkpointId = config?.configurable?.checkpoint_id;
  if (typeof checkpointId === "string") return checkpointId;
  const threadTs = config?.configurable?.thread_ts;
  return typeof threadTs === "string" ? threadTs : "";
}

// 创建返回给 LangGraph 的 checkpoint 配置.
function checkpointConfig(threadId: string, checkpointNs: string, checkpointId: string): RunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpointId
    }
  };
}

// 判断 checkpoint metadata 是否满足 list 的 filter 条件.
function metadataMatchesFilter(metadata: CheckpointMetadata | undefined, filter: Record<string, unknown>): boolean {
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => (metadata as Record<string, unknown>)[key] === value);
}
