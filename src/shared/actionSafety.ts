import type { AikoActionJournalEntryDto, PendingActionDto } from "./ipcTypes";

type ActionSafetyLike = Pick<PendingActionDto | AikoActionJournalEntryDto, "capability" | "target" | "risk"> & {
  params?: Record<string, string | number | boolean>;
};

// 把动作风险等级转换为面向用户的确认文案.
export function describeActionRisk(action: ActionSafetyLike): string {
  const riskLabel = formatRiskLabel(action.risk);
  if (action.risk === "high") {
    return `${riskLabel}: 这个操作会接触本地文件, Shell 或系统能力, Aiko 只能在你确认后执行.`;
  }
  if (action.risk === "medium") {
    return `${riskLabel}: 这个操作会读取或写入较敏感的本地内容, 执行前需要你确认.`;
  }
  return `${riskLabel}: 这是低风险本地操作, 首次执行仍需要你确认.`;
}

// 描述动作会具体影响什么对象, 用于确认弹窗里给用户更细的判断依据.
export function describeActionImpact(action: ActionSafetyLike): string[] {
  switch (action.capability) {
    case "run_shell_command":
      return [
        `将执行受控 PowerShell 只读命令: ${action.target}.`,
        "执行后会记录 exit code, stdout 和 stderr, 但不会保证自动撤销."
      ];
    case "delete_file":
      return [
        `将把目标文件移动到 Aiko trash: ${action.target}.`,
        "不会直接永久删除, 后续可从动作审计里准备恢复."
      ];
    case "restore_file_from_trash":
      return [
        `将从 Aiko trash 恢复文件: ${action.target}.`,
        `目标路径: ${readStringParam(action, "destinationPath") ?? "恢复元数据中的原路径"}. 如果目标已存在, 执行器会停止恢复.`
      ];
    case "write_file":
      return [
        `将写入目标文件: ${action.target}.`,
        "覆盖写入前会先保存备份路径到动作审计."
      ];
    case "read_file":
      return [
        `将读取目标文件内容: ${action.target}.`,
        "读取动作不会修改文件, 但文件内容可能包含敏感信息."
      ];
    case "list_directory":
      return [
        `将列出目标目录内容: ${action.target}.`,
        "目录结构会进入本次回复和动作审计."
      ];
    case "batch_actions":
      return [
        "将按顺序执行一组已列出的子动作.",
        "任意子动作失败时会停止扩大影响, 并写入动作审计."
      ];
    default:
      return [
        `目标: ${action.target}.`,
        "执行前请确认来源和目标是否符合你的真实意图."
      ];
  }
}

// 描述动作的回滚或恢复策略, 用于确认弹窗和审计面板.
export function describeRollbackStrategy(action: ActionSafetyLike): string {
  switch (action.capability) {
    case "write_file":
      return "回滚策略: 写入前后都会进入审计日志, 后续应优先用备份或版本历史恢复.";
    case "delete_file":
      return "回滚策略: 删除动作会移动到 Aiko trash, 后续可从隔离目录恢复.";
    case "restore_file_from_trash":
      return "回滚策略: 恢复动作会依赖 Aiko trash 元数据, 如果原路径已有新文件会停止恢复.";
    case "run_shell_command":
      return "回滚策略: Shell 命令可能无法自动撤销, 当前只允许只读 allowlist 命令并完整记录输出.";
    case "read_file":
    case "list_directory":
      return "回滚策略: 读取类操作不修改文件, 但会保留审计记录方便追踪.";
    case "batch_actions":
      return "回滚策略: 批量动作按子动作逐条审计, 失败时停止扩大影响.";
    default:
      return "回滚策略: 当前动作会记录到审计日志, 如需恢复请按目标内容手动处理.";
  }
}

// 只有低风险动作允许用户选择记住授权.
export function shouldOfferRememberedAuthorization(action: ActionSafetyLike): boolean {
  return action.risk === "low";
}

// 格式化风险等级标签.
export function formatRiskLabel(risk: ActionSafetyLike["risk"]): string {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  return "低风险";
}

// 从动作参数中读取字符串, 仅用于展示确认文案.
function readStringParam(action: ActionSafetyLike, key: string) {
  const value = action.params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
