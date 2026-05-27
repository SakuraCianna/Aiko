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
  tone?: "neutral" | "ok" | "failed";
};

export type ShellCommandOutput = {
  exitCode: string;
  stdout: string;
  stderr: string;
  noOutput: boolean;
  timedOut: boolean;
};

export type RestoreHistoryItem = {
  id: string;
  originalPath: string;
  trashPath: string;
  deletedAt?: string;
  restoredAt?: string;
  restoredPath?: string;
  status: "in_trash" | "restored";
  restoreAction?: PendingActionDto;
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

// 从动作执行消息中提取 Aiko trash 恢复后的路径.
export function extractRestoredPathFromAuditMessage(message?: string) {
  return extractPathAfterMarker(message, "File restored from Aiko trash:");
}

// 解析受控 PowerShell 执行结果, 方便 UI 分开展示退出码和输出流.
export function extractShellCommandOutput(message?: string): ShellCommandOutput | null {
  if (!message) return null;
  const match = message.match(/^Shell command finished with exit code ([^.]+)\.\s*(?:\r?\n([\s\S]*))?$/u);
  if (!match) return null;

  const exitCode = match[1]?.trim() || "unknown";
  const body = match[2]?.trim() ?? "";
  const sections = parseShellSections(body);

  return {
    exitCode,
    stdout: sections.stdout,
    stderr: sections.stderr,
    noOutput: body.length === 0 || body === "No output.",
    timedOut: exitCode === "timeout"
  };
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
    const shellOutput = extractShellCommandOutput(entry.message);
    if (!shellOutput) {
      artifacts.push({ label: "Shell 输出", value: entry.message, tone: entry.ok ? "neutral" : "failed" });
      return artifacts;
    }

    artifacts.push({
      label: "退出码",
      value: shellOutput.exitCode,
      tone: shellOutput.exitCode === "0" ? "ok" : "failed"
    });
    if (shellOutput.stdout) artifacts.push({ label: "标准输出", value: shellOutput.stdout, tone: "neutral" });
    if (shellOutput.stderr) artifacts.push({ label: "错误输出", value: shellOutput.stderr, tone: "failed" });
    if (shellOutput.noOutput) artifacts.push({ label: "Shell 输出", value: "No output.", tone: "neutral" });
  }
  return artifacts;
}

// 从删除和恢复执行日志构建文件恢复历史.
export function buildRestoreHistory(entries: AikoActionJournalEntryDto[]): RestoreHistoryItem[] {
  const items = new Map<string, RestoreHistoryItem>();

  for (const entry of entries) {
    if (entry.phase !== "execution" || entry.ok !== true || entry.capability !== "delete_file") continue;
    const trashPath = extractTrashPathFromAuditMessage(entry.message);
    const restoreAction = createRestoreActionFromAuditEntry(entry);
    if (!trashPath || !restoreAction) continue;
    items.set(normalizeAuditPath(trashPath), {
      id: entry.id,
      originalPath: entry.target,
      trashPath,
      deletedAt: entry.createdAt,
      status: "in_trash",
      restoreAction
    });
  }

  for (const entry of entries) {
    if (entry.phase !== "execution" || entry.ok !== true || entry.capability !== "restore_file_from_trash") continue;
    const key = normalizeAuditPath(entry.target);
    const restoredPath = extractRestoredPathFromAuditMessage(entry.message) ?? readStringParam(entry, "destinationPath") ?? entry.target;
    const existing = items.get(key);
    if (existing) {
      existing.status = "restored";
      existing.restoredAt = entry.createdAt;
      existing.restoredPath = restoredPath;
      delete existing.restoreAction;
      continue;
    }

    items.set(key, {
      id: entry.id,
      originalPath: restoredPath,
      trashPath: entry.target,
      restoredAt: entry.createdAt,
      restoredPath,
      status: "restored"
    });
  }

  return [...items.values()].sort((left, right) => {
    const leftTime = Date.parse(left.deletedAt ?? left.restoredAt ?? "");
    const rightTime = Date.parse(right.deletedAt ?? right.restoredAt ?? "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
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

// 按 stdout 和 stderr 标记切分 Shell 输出正文.
function parseShellSections(body: string) {
  const sections = {
    stdout: "",
    stderr: ""
  };
  let current: keyof typeof sections | null = null;
  const buckets: Record<keyof typeof sections, string[]> = {
    stdout: [],
    stderr: []
  };

  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (line === "stdout:") {
      current = "stdout";
      continue;
    }
    if (line === "stderr:") {
      current = "stderr";
      continue;
    }
    if (current) buckets[current].push(line);
  }

  sections.stdout = buckets.stdout.join("\n").trim();
  sections.stderr = buckets.stderr.join("\n").trim();
  return sections;
}

// 规范化路径 key, 用于把删除记录和恢复记录配对.
function normalizeAuditPath(value: string) {
  return value.trim().toLowerCase();
}

// 从审计记录参数里读取字符串字段.
function readStringParam(entry: AikoActionJournalEntryDto, key: string) {
  const params = (entry as { params?: Record<string, unknown> }).params;
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
