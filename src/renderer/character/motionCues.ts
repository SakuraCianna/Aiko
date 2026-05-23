import type { ChatPayload } from "../../shared/chatPayload";
import type { CharacterBehavior, CharacterMotion } from "./characterTypes";

const WEB_RESEARCH_CUE_PATTERN =
  /(?:联网|上网|网页|搜索|搜一下|查一下|查询|检索|资料来源|引用来源|最新|今天|现在|当前|近期|新闻|价格|版本|发布|官网|下载地址)/;
const LONG_WRITING_CUE_PATTERN =
  /(?:生成|写|制定|整理|输出|起草|设计|做).{0,12}(?:一份|详细|具体|完整|系统|规划|计划|方案|文档|报告|清单|教程|大纲|路线图|总结)|(?:详细|具体|完整|系统性|可执行|时间表)/;
const CURIOUS_CUE_PATTERN = /(?:为什么|怎么|如何|是什么|可以吗|能不能|？|\?)/;
const EMPHASIS_CUE_PATTERN = /(?:当然|可以|没问题|完成|成功|已经|注意|重点|!|！)/;
const SHY_CUE_PATTERN = /(?:谢谢|辛苦|可爱|喜欢你|夸夸|表扬)/;
const EXPLAIN_RESPONSE_LENGTH = 90;
const PRESENT_RESPONSE_LENGTH = 220;

export type CharacterCue = {
  behavior: CharacterBehavior;
  motion: CharacterMotion;
};

// 根据用户输入预判本轮角色起手状态, 让任务意图先体现在身体动作上.
export function selectInitialCharacterCue(payload: ChatPayload): CharacterCue {
  const text = payload.text.trim();

  if (payload.attachments.some((attachment) => attachment.kind === "audio")) {
    return {
      behavior: "listening",
      motion: "curious"
    };
  }

  if (WEB_RESEARCH_CUE_PATTERN.test(text)) {
    return {
      behavior: "searching",
      motion: "search"
    };
  }

  if (LONG_WRITING_CUE_PATTERN.test(text)) {
    return {
      behavior: "writing",
      motion: "write"
    };
  }

  if (SHY_CUE_PATTERN.test(text)) {
    return {
      behavior: "shy",
      motion: "shy"
    };
  }

  if (CURIOUS_CUE_PATTERN.test(text)) {
    return {
      behavior: "curious",
      motion: "curious"
    };
  }

  return {
    behavior: "thinking",
    motion: "ponder"
  };
}

// 根据回复内容选择说话动作, 让短答, 长解释和结果展示有不同身体语言.
export function selectSpeechMotion(text: string): CharacterMotion {
  const normalized = text.trim();
  if (normalized.length >= PRESENT_RESPONSE_LENGTH || /(?:步骤|方案|计划|如下|清单|总结)/.test(normalized)) {
    return "present";
  }
  if (normalized.length >= EXPLAIN_RESPONSE_LENGTH) return "explain";
  if (EMPHASIS_CUE_PATTERN.test(normalized)) return "emphasis";
  return "nod";
}

// 根据动作执行结果选择反馈姿态.
export function selectActionResultCue(ok: boolean): CharacterCue {
  return ok
    ? {
        behavior: "success",
        motion: "proud"
      }
    : {
        behavior: "recovering",
        motion: "errorRecover"
      };
}

// 根据是否真的打断输出选择中止动作.
export function selectCancelMotion(hasActiveResponse: boolean): CharacterMotion {
  return hasActiveResponse ? "interrupt" : "deny";
}
