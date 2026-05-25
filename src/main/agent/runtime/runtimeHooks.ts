export type AikoRuntimeHookName =
  | "agent_status"
  | "before_model_call"
  | "after_model_call"
  | "before_tool_call"
  | "after_tool_call"
  | "after_memory_write";

export type AikoRuntimeHookEvent = {
  name: AikoRuntimeHookName;
  runId?: string;
  payload?: unknown;
};

export type AikoRuntimeHookListener = (event: AikoRuntimeHookEvent) => Promise<void> | void;
export type AikoRuntimeHooks = ReturnType<typeof createAikoRuntimeHooks>;

// 创建 Runtime hook 总线, 为日志, 动作反馈和未来 worker 扩展提供统一入口.
export function createAikoRuntimeHooks() {
  const listeners = new Map<AikoRuntimeHookName, AikoRuntimeHookListener[]>();

  return {
    // 注册指定 hook 的监听器.
    on(name: AikoRuntimeHookName, listener: AikoRuntimeHookListener) {
      const current = listeners.get(name) ?? [];
      current.push(listener);
      listeners.set(name, current);
      return () => {
        const next = (listeners.get(name) ?? []).filter((candidate) => candidate !== listener);
        listeners.set(name, next);
      };
    },

    // 触发 hook, 单个监听失败不会打断主链路.
    async emit(event: AikoRuntimeHookEvent) {
      for (const listener of listeners.get(event.name) ?? []) {
        try {
          await listener(event);
        } catch {
          continue;
        }
      }
    }
  };
}
