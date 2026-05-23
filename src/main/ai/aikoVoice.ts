import type { PendingActionDto } from "../../shared/ipcTypes";

// 为本地确定性路径生成 Aiko 风格文案, 避免绕过模型时变成系统提示腔.
export function describePendingAction(action: PendingActionDto): string {
  if (action.capability === "open_application") {
    return `嗯, ${action.target} 我可以帮你叫出来. 先等你点头确认, 我再动手.`;
  }

  if (action.capability === "open_url") {
    if (action.title.startsWith("搜索网页:")) {
      const query = action.title.slice("搜索网页:".length);
      return `我可以替你搜 "${query}". 先把动作放在这里, 你确认后我就打开搜索页.`;
    }
    return "这个链接我可以接住. 你确认一下, 我就帮你打开.";
  }

  if (action.capability === "create_reminder") {
    const amount = action.params?.amount;
    const unit = action.params?.unit === "hours" ? "小时" : "分钟";
    const title = typeof action.params?.title === "string" ? action.params.title : action.target;
    return `提醒我可以记好: ${amount} ${unit}后, ${title}. 确认一下就行.`;
  }

  if (action.capability === "cancel_reminder") {
    return "我可以取消最近一条还没触发的提醒. 先确认一下, 我再动手.";
  }

  if (action.capability === "set_default_application") {
    const defaultFor = typeof action.params?.defaultFor === "string" ? action.params.defaultFor : action.target;
    const application = typeof action.params?.application === "string" ? action.params.application : "这个应用";
    return `我可以把默认${defaultFor}改成 ${application}. 你确认一下, 我就记住.`;
  }

  if (action.capability === "write_desktop_markdown") {
    return "这份内容有点长, 我可以把它写成 Markdown 放到桌面 Aiko 文件夹里. 你确认一下, 我再落盘.";
  }

  return "这个操作我先收住了. 等你确认后, 我再继续.";
}

// 描述本地执行成功后的 Aiko 风格反馈.
export function describeActionSuccess(action: PendingActionDto): string {
  if (action.capability === "open_url") {
    return "网页已打开. 这一步我接上了.";
  }

  if (action.capability === "open_application") {
    return `${action.target} 已经打开. 我在旁边待命.`;
  }

  if (action.capability === "create_reminder") {
    const title = typeof action.params?.title === "string" ? action.params.title : action.target;
    return `提醒已记好: ${title}. 到点我会把它拎出来.`;
  }

  if (action.capability === "cancel_reminder") {
    return "最近一条待触发提醒已取消. 我把这件事从清单里拿掉了.";
  }

  if (action.capability === "set_default_application") {
    const defaultFor = typeof action.params?.defaultFor === "string" ? action.params.defaultFor : action.target;
    const application = typeof action.params?.application === "string" ? action.params.application : action.target;
    return `默认${defaultFor}已改成 ${application}. 下次我会按这个来.`;
  }

  if (action.capability === "write_desktop_markdown") {
    return "Markdown 文件已经写好. 长内容放进文件里会清爽很多.";
  }

  return "完成了. 这一步我已经处理好.";
}

// 描述本地执行失败后的 Aiko 风格反馈.
export function describeActionFailure(action: PendingActionDto, reason: "unsupported" | "not_found" | "invalid" | "high_risk") {
  if (reason === "high_risk") {
    return "这个动作风险偏高, 我先不碰. 稳一点比较好.";
  }

  if (reason === "not_found") {
    return `我没找到 ${action.target}. 可能还没加入应用目录, 先别硬开.`;
  }

  if (reason === "invalid") {
    return "这个动作缺少必要信息, 我不想乱猜. 你补一下我再接着处理.";
  }

  return "这个能力当前版本还没接上. 我先把边界说清楚.";
}

// 描述模型不可用时的降级反馈.
export function describeModelFallback() {
  return "大模型那边现在没接上, 但打开应用, 打开网页和提醒这类本地小动作我还能接住.";
}

// 描述模型没有生成有效文本时的反馈.
export function describeEmptyAssistantReply() {
  return "我听到了, 但这次没有整理出可靠回复. 这句不硬编.";
}

// 描述模型工具调用生成待确认动作时的反馈.
export function describeModelProposedAction(action: PendingActionDto) {
  return `${describePendingAction(action)} 我不会擅自执行, 这点会守住.`;
}
