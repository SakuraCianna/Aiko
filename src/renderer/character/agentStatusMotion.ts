import type { AikoAgentStatusEventDto } from "../../shared/ipcTypes";
import type { CharacterCue } from "./motionCues";

// 把 Agent 运行阶段转换成 VRM 身体语言, 让角色表现跟内部状态同步.
export function selectAgentStatusCue(status: AikoAgentStatusEventDto): CharacterCue | null {
  switch (status.phase) {
    case "accepted":
    case "running":
    case "planning":
      return {
        behavior: "thinking",
        motion: "ponder"
      };
    case "retrieving":
      return {
        behavior: "searching",
        motion: "search"
      };
    case "preparing_action":
    case "waiting_approval":
      return {
        behavior: "confirming",
        motion: "notice"
      };
    case "model_generating":
      return {
        behavior: "thinking",
        motion: "think"
      };
    case "memory_writing":
      return {
        behavior: "writing",
        motion: "write"
      };
    case "action_executing":
      return {
        behavior: "presenting",
        motion: "tap"
      };
    case "cancelled":
      return {
        behavior: "idle",
        motion: "interrupt"
      };
    case "failed":
      return {
        behavior: "recovering",
        motion: "errorRecover"
      };
    case "completed":
      return null;
    default:
      return null;
  }
}
