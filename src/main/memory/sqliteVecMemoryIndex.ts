import type { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createMemoryVector, type RecalledMemory } from "./memoryRecall";

export const AIKO_MEMORY_EMBEDDING_DIMENSIONS = 64;

const SQLITE_VEC_TABLE = "aiko_memory_vec_index";
const SQLITE_VEC_ROWID_TABLE = "memory_vec_rowids";
const MAX_LOCAL_VECTOR_DISTANCE = 1.35;

type RankedVectorRow = {
  memory_id: string;
  distance: number;
};

type RowIdRecord = {
  rowid: number;
};

export type AikoMemoryVectorIndex = {
  readonly provider: "sqlite-vec";
  readonly isAvailable: boolean;
  readonly unavailableReason?: string;
  upsert: (memoryId: string, content: string) => void;
  rank: (memories: RecalledMemory[], query: string, limit?: number) => RecalledMemory[] | null;
};

// 创建 sqlite-vec 记忆索引, 如果本机扩展不可用则返回安全降级索引.
export function createSqliteVecMemoryIndex(db: DatabaseSync): AikoMemoryVectorIndex {
  try {
    loadSqliteVecExtension(db);
    ensureSqliteVecSchema(db);
    return createAvailableSqliteVecMemoryIndex(db);
  } catch (error) {
    const reason = formatSqliteVecError(error);
    console.warn("[aiko:memory] sqlite-vec unavailable, sparse recall fallback enabled", { reason });
    return createUnavailableSqliteVecMemoryIndex(reason);
  }
}

// 加载 sqlite-vec 扩展, 加载完成后关闭后续动态扩展入口.
function loadSqliteVecExtension(db: DatabaseSync) {
  sqliteVec.load(db);
  db.enableLoadExtension(false);
  db.prepare("SELECT vec_version() AS version").get();
}

// 创建 sqlite-vec 虚拟表和 memory id 到整数 rowid 的映射表.
function ensureSqliteVecSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SQLITE_VEC_ROWID_TABLE} (
      memory_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS ${SQLITE_VEC_TABLE} USING vec0(
      embedding float[${AIKO_MEMORY_EMBEDDING_DIMENSIONS}],
      +memory_id text
    );
  `);
}

// 创建可用的 sqlite-vec 索引实现.
function createAvailableSqliteVecMemoryIndex(db: DatabaseSync): AikoMemoryVectorIndex {
  return {
    provider: "sqlite-vec",
    isAvailable: true,

    upsert(memoryId, content) {
      const embedding = createLocalMemoryEmbedding(content);
      if (!embedding) return;

      const rowId = ensureMemoryVectorRowId(db, memoryId);
      db.prepare(`DELETE FROM ${SQLITE_VEC_TABLE} WHERE rowid = ?`).run(BigInt(rowId));
      db.prepare(`INSERT INTO ${SQLITE_VEC_TABLE}(rowid, embedding, memory_id) VALUES (?, ?, ?)`).run(
        BigInt(rowId),
        serializeFloat32Embedding(embedding),
        memoryId
      );
    },

    rank(memories, query, limit = 5) {
      const embedding = createLocalMemoryEmbedding(query);
      if (!embedding || memories.length === 0 || limit <= 0) return [];

      try {
        const rows = db
          .prepare(
            `
            SELECT memory_id, distance
            FROM ${SQLITE_VEC_TABLE}
            WHERE embedding MATCH ? AND k = ?
            ORDER BY distance ASC
          `
          )
          .all(serializeFloat32Embedding(embedding), BigInt(Math.max(limit, memories.length))) as RankedVectorRow[];
        return mapVectorRowsToMemories(rows, memories, limit);
      } catch (error) {
        console.warn("[aiko:memory] sqlite-vec recall failed, sparse recall fallback enabled", {
          reason: formatSqliteVecError(error)
        });
        return null;
      }
    }
  };
}

// 创建不可用的占位索引, 仓库层会继续使用稀疏向量召回.
function createUnavailableSqliteVecMemoryIndex(reason: string): AikoMemoryVectorIndex {
  return {
    provider: "sqlite-vec",
    isAvailable: false,
    unavailableReason: reason,
    upsert() {
      return;
    },
    rank() {
      return null;
    }
  };
}

// 为一条记忆分配稳定整数 rowid, 供 vec0 虚拟表使用.
function ensureMemoryVectorRowId(db: DatabaseSync, memoryId: string): number {
  db.prepare(`INSERT OR IGNORE INTO ${SQLITE_VEC_ROWID_TABLE}(memory_id, created_at) VALUES (?, ?)`).run(
    memoryId,
    new Date().toISOString()
  );
  const row = db
    .prepare(`SELECT rowid FROM ${SQLITE_VEC_ROWID_TABLE} WHERE memory_id = ? LIMIT 1`)
    .get(memoryId) as RowIdRecord | undefined;
  if (!row) throw new Error("sqlite-vec rowid allocation failed");
  return row.rowid;
}

// 将 sqlite-vec 查询结果映射回当前有效记忆, 并过滤明显无关的本地向量结果.
function mapVectorRowsToMemories(rows: RankedVectorRow[], memories: RecalledMemory[], limit: number): RecalledMemory[] {
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const ranked: RecalledMemory[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (ranked.length >= limit) break;
    if (!Number.isFinite(row.distance) || row.distance > MAX_LOCAL_VECTOR_DISTANCE) continue;
    if (seen.has(row.memory_id)) continue;
    const memory = memoryById.get(row.memory_id);
    if (!memory) continue;
    seen.add(row.memory_id);
    ranked.push(memory);
  }

  return ranked;
}

// 生成本地确定性 dense embedding, 后续可以替换为真实 embedding 模型.
export function createLocalMemoryEmbedding(text: string): Float32Array | null {
  const sparseVector = createMemoryVector(text);
  const entries = Object.entries(sparseVector);
  if (entries.length === 0) return null;

  const embedding = new Float32Array(AIKO_MEMORY_EMBEDDING_DIMENSIONS);
  for (const [term, weight] of entries) {
    const hash = hashTerm(term);
    const index = hash % AIKO_MEMORY_EMBEDDING_DIMENSIONS;
    const sign = hash & 1 ? 1 : -1;
    embedding[index] += sign * weight;
  }

  return normalizeEmbedding(embedding);
}

// 将 Float32Array 复制成 node:sqlite 可以稳定绑定的 Uint8Array.
function serializeFloat32Embedding(embedding: Float32Array): Uint8Array {
  const bytes = new Uint8Array(embedding.byteLength);
  bytes.set(new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength));
  return bytes;
}

// 对 dense embedding 做 L2 归一化, 避免长文本天然占优.
function normalizeEmbedding(embedding: Float32Array): Float32Array {
  const length = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (length === 0) return embedding;

  for (let index = 0; index < embedding.length; index += 1) {
    embedding[index] = embedding[index] / length;
  }
  return embedding;
}

// 使用 FNV-1a 生成稳定哈希, 保证跨进程的索引结果一致.
function hashTerm(term: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 格式化 sqlite-vec 错误, 避免日志里出现无关堆栈或路径噪声.
function formatSqliteVecError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
