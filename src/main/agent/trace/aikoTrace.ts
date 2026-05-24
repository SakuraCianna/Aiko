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

export type AikoTraceStore = {
  startTrace: (trace: Pick<AikoTraceRecord, "requestId" | "startedAt">) => void;
  addTraceEvent: (requestId: string, event: AikoTraceEvent) => void;
  endTrace: (requestId: string, endedAt: string) => void;
  listTraces: () => AikoTraceRecord[];
};

export type AikoTraceRecorderOptions = {
  now?: () => Date;
  store?: AikoTraceStore;
};

// 创建 Trace 记录器, 同时支持内存快照和可选持久化 store.
export function createAikoTraceRecorder(options: AikoTraceRecorderOptions = {}): AikoTraceRecorder {
  const now = options.now ?? (() => new Date());
  const store = options.store;
  const records: AikoTraceRecord[] = [];

  return {
    // 开始记录一次 Agent 请求.
    start(requestId = crypto.randomUUID()) {
      const startedAt = now().toISOString();
      const record: AikoTraceRecord = {
        requestId,
        startedAt,
        endedAt: null,
        events: []
      };
      records.push(record);
      store?.startTrace({ requestId, startedAt });

      return {
        // 追加一个请求生命周期事件.
        add(name, data) {
          const event = {
            name,
            at: now().toISOString(),
            data
          };
          record.events.push(event);
          store?.addTraceEvent(requestId, event);
        },

        // 结束当前请求并记录最终状态.
        end(data) {
          record.endedAt = now().toISOString();
          const event = {
            name: "request.completed",
            at: record.endedAt,
            data
          };
          record.events.push(event);
          store?.endTrace(requestId, record.endedAt);
          store?.addTraceEvent(requestId, event);
        }
      };
    },

    // 返回所有 Trace 快照.
    list() {
      if (store) return store.listTraces();
      return records.map((record) => ({
        ...record,
        events: [...record.events]
      }));
    }
  };
}
