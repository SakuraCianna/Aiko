const EXACT_CANCELLATION_COMMANDS = new Set([
  "中止",
  "终止",
  "停止",
  "停",
  "停下",
  "停一下",
  "暂停",
  "别说了",
  "不要说了",
  "别继续",
  "别继续了",
  "打住",
  "stop",
  "cancel",
  "abort"
]);

const NATURAL_CANCELLATION_PATTERNS = [
  /^(?:先)?(?:别|不要|不用|不必)(?:再)?(?:继续)?(?:说|回答|回复|输出|讲|讲话|说话|生成|写)(?:了|下去|下去了)?$/,
  /^(?:先)?(?:停止|中止|终止|取消|暂停)(?:输出|回复|回答|生成|说话|讲话|朗读)(?:了)?$/,
  /^(?:打住)(?:先)?(?:停|停止|停下|停一下|暂停)?(?:吧|了)?$/,
  /^(?:行了|可以了|够了)(?:可以)?(?:先)?(?:停|停止|停下|停一下|别说了)(?:吧|了)?$/,
  /^(?:please)?(?:stop|cancel|abort)(?:talking|speaking|replying|responding|generating|output)?$/
];

const CANCELLATION_FALSE_POSITIVE_PATTERNS = [
  /^(?:怎么|如何|怎样|为什么|为何).*(?:停止|中止|终止|取消|stop|cancel|abort)/,
  /(?:停止|中止|终止|取消)(?:录音|提醒|闹钟|更新|下载|安装|服务|进程)/,
  /(?:stop|cancel|abort)(?:函数|方法|变量|接口|按钮|逻辑|代码)/
];

// 判断用户输入是否是本地中止意图, 命中后不再发送给模型.
export function isCancellationCommand(text: string): boolean {
  const normalized = normalizeCancellationText(text);
  if (!normalized) return false;
  if (CANCELLATION_FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (EXACT_CANCELLATION_COMMANDS.has(normalized)) return true;
  return NATURAL_CANCELLATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

// 归一化中止命令, 去掉空白和常见标点, 让自然短句更容易命中.
function normalizeCancellationText(text: string): string {
  return text.trim().toLowerCase().replace(/[\s,.!?;:，。！？；：、]+/g, "");
}
