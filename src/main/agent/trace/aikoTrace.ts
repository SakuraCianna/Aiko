export type AikoTraceEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type AikoTraceRecord = {
  requestId: string;
  startedAt: string;
  endedAt: string | null;
  events: AikoTraceEvent[];
};

export type AikoTrace = {
  add: (name: string, data?: Record<string, unknown>) => void;
  end: (data?: Record<string, unknown>) => void;
};

export type AikoTraceRecorder = {
  start: (requestId?: string) => AikoTrace;
  list: () => AikoTraceRecord[];
};

// 创建内存 Trace 记录器, 用于调试 Agent 决策链路.
export function createAikoTraceRecorder(): AikoTraceRecorder {
  const records: AikoTraceRecord[] = [];

  return {
    // 开始记录一次 Agent 请求.
    start(requestId = crypto.randomUUID()) {
      const record: AikoTraceRecord = {
        requestId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        events: []
      };
      records.push(record);

      return {
        // 追加一个请求生命周期事件.
        add(name, data) {
          record.events.push({
            name,
            at: new Date().toISOString(),
            data
          });
        },

        // 结束当前请求并记录最终状态.
        end(data) {
          record.endedAt = new Date().toISOString();
          record.events.push({
            name: "request.completed",
            at: record.endedAt,
            data
          });
        }
      };
    },

    // 返回所有 Trace 快照.
    list() {
      return records.map((record) => ({
        ...record,
        events: [...record.events]
      }));
    }
  };
}
