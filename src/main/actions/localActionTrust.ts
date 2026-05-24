import type { PendingActionDto } from "../../shared/ipcTypes";

const AUTO_EXECUTABLE_DESKTOP_MARKDOWN_ACTION = Symbol("aiko.autoExecutableDesktopMarkdownAction");

type AutoExecutableDesktopMarkdownAction = PendingActionDto & {
  [AUTO_EXECUTABLE_DESKTOP_MARKDOWN_ACTION]?: true;
};

// 给 runtime 自己生成的 Markdown 落盘动作加内部信任标记, 这个 Symbol 不会被 IPC 或模型伪造.
export function markAutoExecutableDesktopMarkdownAction(action: PendingActionDto): PendingActionDto {
  Object.defineProperty(action, AUTO_EXECUTABLE_DESKTOP_MARKDOWN_ACTION, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return action;
}

// 判断长回复 Markdown 动作是否来自 runtime 的本地启发式识别, 只有这类动作可以自动落盘.
export function isAutoExecutableDesktopMarkdownAction(action: PendingActionDto): boolean {
  return (
    action.capability === "write_desktop_markdown" &&
    action.target === "Desktop/Aiko" &&
    (action as AutoExecutableDesktopMarkdownAction)[AUTO_EXECUTABLE_DESKTOP_MARKDOWN_ACTION] === true
  );
}
