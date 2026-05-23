const CANCELLATION_COMMANDS = new Set([
  "中止",
  "终止",
  "停止",
  "停",
  "停下",
  "停一下",
  "别说了",
  "不要说了",
  "别继续",
  "别继续了",
  "stop",
  "cancel",
  "abort"
]);

// 判断用户输入是否是本地中止命令, 命中后不再发送给模型.
export function isCancellationCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[\s,.!?;:，。！？；：、]+/g, "");
  return CANCELLATION_COMMANDS.has(normalized);
}
