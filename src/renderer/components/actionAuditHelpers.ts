import type { AikoActionJournalEntryDto, PendingActionDto } from "../../shared/ipcTypes";

export type AuditRiskFilter = "all" | AikoActionJournalEntryDto["risk"];
export type AuditResultFilter = "all" | "planned" | "approval" | "ok" | "failed";

export type AuditEntryFilter = {
  risk: AuditRiskFilter;
  capability: string;
  result: AuditResultFilter;
  searchText: string;
};

export type AuditArtifact = {
  label: string;
  value: string;
};

// 按当前筛选条件过滤审计日志, 供 UI 和测试共用.
export function filterAuditEntries(entries: AikoActionJournalEntryDto[], filters: AuditEntryFilter) {
  const search = filters.searchText.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.risk !== "all" && entry.risk !== filters.risk) return false;
    if (filters.capability !== "all" && entry.capability !== filters.capability) return false;
    if (!matchesResultFilter(entry, filters.result)) return false;
    if (!search) return true;
    return createSearchHaystack(entry).includes(search);
  });
}

// 从动作执行消息中提取 Aiko trash 路径.
export function extractTrashPathFromAuditMessage(message?: string) {
  return extractPathAfterMarker(message, "File moved to Aiko trash:");
}

// 从动作执行消息中提取覆盖写入前的备份路径.
export function extractBackupPathFromAuditMessage(message?: string) {
  return extractPathAfterMarker(message, "Backup saved:");
}

// 把成功删除日志转换成恢复动作, 但仍然交给统一确认弹窗处理.
export function createRestoreActionFromAuditEntry(entry: AikoActionJournalEntryDto): PendingActionDto | null {
  if (entry.phase !== "execution" || entry.ok !== true || entry.capability !== "delete_file") return null;
  const trashPath = extractTrashPathFromAuditMessage(entry.message);
  if (!trashPath) return null;

  return {
    title: `恢复文件:${trashPath}`,
    source: "动作审计",
    risk: "high",
    capability: "restore_file_from_trash",
    target: trashPath,
    params: {
      destinationPath: entry.target
    }
  };
}

// 提取审计消息里的关键产物, 让用户能定位备份, trash 和 Shell 输出.
export function extractAuditArtifacts(entry: AikoActionJournalEntryDto): AuditArtifact[] {
  const artifacts: AuditArtifact[] = [];
  const backupPath = extractBackupPathFromAuditMessage(entry.message);
  const trashPath = extractTrashPathFromAuditMessage(entry.message);

  if (backupPath) artifacts.push({ label: "备份路径", value: backupPath });
  if (trashPath) artifacts.push({ label: "隔离路径", value: trashPath });
  if (entry.phase === "execution" && entry.capability === "run_shell_command" && entry.message) {
    artifacts.push({ label: "Shell 输出", value: entry.message });
  }
  return artifacts;
}

// 判断一条日志是否匹配结果筛选.
function matchesResultFilter(entry: AikoActionJournalEntryDto, result: AuditResultFilter) {
  if (result === "all") return true;
  if (result === "planned") return entry.phase === "planned";
  if (result === "approval") return entry.phase === "approval";
  if (result === "ok") return entry.phase === "execution" && entry.ok === true;
  return entry.phase === "execution" && entry.ok === false;
}

// 拼接搜索字段, 只用于本地 UI 过滤.
function createSearchHaystack(entry: AikoActionJournalEntryDto) {
  return [
    entry.phase,
    entry.capability,
    entry.target,
    entry.risk,
    entry.source,
    entry.decision,
    entry.message
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

// 从固定英文 marker 后提取一行路径, 避免把后续日志文本吃进去.
function extractPathAfterMarker(message: string | undefined, marker: string) {
  if (!message) return null;
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return null;
  const value = message.slice(markerIndex + marker.length).trim().split(/\r?\n/u)[0]?.trim();
  if (!value) return null;
  return value.replace(/^["'`]+/u, "").replace(/["'`,;.]+$/u, "");
}
