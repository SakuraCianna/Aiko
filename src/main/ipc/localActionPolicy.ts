import type { PendingActionDto } from "../../shared/ipcTypes";

// 判断长回复 Markdown 动作是否来自 Runtime 的本地启发式识别, 只有这类动作可以自动落盘.
export function isAutoExecutableDesktopMarkdownAction(action: PendingActionDto): boolean {
  return (
    action.capability === "write_desktop_markdown" &&
    action.target === "Desktop/Aiko" &&
    action.params?.autoExecute === true
  );
}
