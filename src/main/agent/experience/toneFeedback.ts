export type AikoExperienceSatisfaction = "satisfied" | "unsatisfied" | "unclear";
export type AikoExperienceTone = "positive" | "negative" | "corrective" | "neutral";
export type AikoExperienceAspect = "answer_style" | "tool_behavior" | "memory_behavior" | "latency" | "general";

export type AikoUserToneSignal = {
  tone: AikoExperienceTone;
  satisfaction: AikoExperienceSatisfaction;
  aspect: AikoExperienceAspect;
  confidence: number;
  summary: string;
  recommendation: string;
};

const correctivePatterns = [
  /不是这个意思|不是这个|不对|错了|搞错|理解错|你没懂|没懂我意思|应该是/i,
  /又.*(?:错|没|不|还)|怎么.*(?:又|还|没|不)|一直.*(?:错|没|不)/i,
  /太啰嗦|太长|短一点|简短一点|直接一点/i
];

const negativePatterns = [
  /太啰嗦|太长|废话|别说这么多|短一点|简短一点|直接一点/i,
  /没反应|打不开|没打开|失败|失效|卡住|卡顿|闪烁|不显示|看不到/i,
  /不满意|不好用|不够聪明|不够自然|没有特点|很奇怪|别自顾自|自问自答/i,
  /别说了|不要说了|停止|中止|终止|停下/i
];

const positivePatterns = [
  /现在可以了|这样可以|可以了|这样就行|挺好|很好|不错|对的|没问题|做得好|满意/i,
  /\b(ok|nice|great|good)\b/i
];

// 根据用户自然语言中的语气线索推断体验信号, 不把推断结果当成长期事实.
export function analyzeUserTone(text: string): AikoUserToneSignal {
  const normalized = text.trim();
  if (!normalized) return neutralSignal();

  const aspect = inferAspect(normalized);
  if (matchesAny(normalized, correctivePatterns)) {
    return {
      tone: "corrective",
      satisfaction: "unsatisfied",
      aspect,
      confidence: 0.9,
      summary: "用户可能在纠正 Aiko 的理解或上一次处理结果.",
      recommendation: recommendationForAspect(aspect, "corrective")
    };
  }

  if (matchesAny(normalized, negativePatterns) && !/不(?:错|用改|需要改)/.test(normalized)) {
    return {
      tone: "negative",
      satisfaction: "unsatisfied",
      aspect,
      confidence: 0.82,
      summary: "用户语气里出现了不满, 中止或体验问题信号.",
      recommendation: recommendationForAspect(aspect, "negative")
    };
  }

  if (matchesAny(normalized, positivePatterns) && !/不可以|不好|不满意|不对/.test(normalized)) {
    return {
      tone: "positive",
      satisfaction: "satisfied",
      aspect: "general",
      confidence: 0.72,
      summary: "用户可能认可当前处理方式.",
      recommendation: "保持当前简洁直接的处理方式, 不要因为被认可就加戏或扩大承诺."
    };
  }

  return neutralSignal();
}

// 判断输入是否命中任一语气模式.
function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

// 根据关键词推断用户不满更可能落在哪个体验面.
function inferAspect(text: string): AikoExperienceAspect {
  if (/太啰嗦|太长|短一点|简短|直接一点|废话|别说这么多/.test(text)) return "answer_style";
  if (/打不开|没打开|应用|浏览器|工具|动作|执行|请求格式/.test(text)) return "tool_behavior";
  if (/记忆|记住|忘了|偏好|默认/.test(text)) return "memory_behavior";
  if (/卡|慢|延迟|等很久/.test(text)) return "latency";
  return "general";
}

// 针对不同体验面给出下一轮回复策略.
function recommendationForAspect(aspect: AikoExperienceAspect, tone: "negative" | "corrective") {
  if (aspect === "answer_style") return "下一轮回复短一点, 先给结论和可执行动作, 避免长篇解释.";
  if (aspect === "tool_behavior") return "先承认具体操作问题, 再说明当前能检查或重试的动作, 不要声称已经完成.";
  if (aspect === "memory_behavior") return "先确认记忆或默认选项可能有偏差, 不要把推断当事实, 必要时请用户确认.";
  if (aspect === "latency") return "减少解释, 直接说明正在处理或给出最短可行结果.";
  return tone === "corrective"
    ? "先承认具体问题, 按用户当前说法重新对齐, 不要继续沿用上一轮假设."
    : "降低打扰感, 先接住问题, 给一个更稳的下一步.";
}

// 普通任务请求不进入体验反馈, 防止把操作意图误判为满意度.
function neutralSignal(): AikoUserToneSignal {
  return {
    tone: "neutral",
    satisfaction: "unclear",
    aspect: "general",
    confidence: 0,
    summary: "",
    recommendation: ""
  };
}
