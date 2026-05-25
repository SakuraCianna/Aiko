import { randomUUID } from "node:crypto";
import { analyzeUserTone, type AikoUserToneSignal } from "./toneFeedback";

export type AikoExperienceSignal = AikoUserToneSignal & {
  id: string;
  sourceText: string;
  createdAt: string;
};

export type AikoExperienceGuidance = {
  currentSignal: AikoUserToneSignal | null;
  recentSignals: AikoExperienceSignal[];
  recommendations: string[];
};

export type AikoExperiencePolicyOptions = {
  idFactory?: () => string;
  now?: () => Date;
  maxSignals?: number;
};

export type AikoExperiencePolicy = ReturnType<typeof createAikoExperiencePolicy>;

// 创建隐式体验策略, 只保存运行期推断信号, 不替代用户明确记忆.
export function createAikoExperiencePolicy(options: AikoExperiencePolicyOptions = {}) {
  const idFactory = options.idFactory ?? (() => `experience_${randomUUID()}`);
  const now = options.now ?? (() => new Date());
  const maxSignals = options.maxSignals ?? 30;
  const signals: AikoExperienceSignal[] = [];

  return {
    // 根据用户语气记录一条非中性的隐式体验信号.
    recordUserTone(sourceText: string): AikoExperienceSignal | null {
      const tone = analyzeUserTone(sourceText);
      if (tone.satisfaction === "unclear" || tone.confidence < 0.55) return null;

      const signal = {
        ...tone,
        id: idFactory(),
        sourceText: sourceText.trim().slice(0, 500),
        createdAt: now().toISOString()
      };
      signals.push(signal);
      trimSignals(signals, maxSignals);
      return { ...signal };
    },

    // 为当前请求生成短期体验指导, 当前语气不需要先落库也能生效.
    createGuidance(currentText: string): AikoExperienceGuidance {
      const currentSignal = analyzeUserTone(currentText);
      const activeCurrentSignal = currentSignal.satisfaction === "unclear" ? null : currentSignal;
      const recentSignals = signals.slice(-5).map(cloneSignal);
      const recommendations = dedupeRecommendations([
        ...(activeCurrentSignal ? [activeCurrentSignal.recommendation] : []),
        ...recentSignals.slice(-3).map((signal) => signal.recommendation)
      ]);

      return {
        currentSignal: activeCurrentSignal,
        recentSignals,
        recommendations
      };
    },

    // 返回最近体验信号快照, 用于 Agent 调试面板.
    listSignals() {
      return signals.map(cloneSignal);
    }
  };
}

// 把体验策略格式化为模型上下文, 并明确它只是推断, 不是用户显式指令.
export function formatExperiencePolicyContext(guidance: AikoExperienceGuidance): string {
  if (!guidance.currentSignal && guidance.recommendations.length === 0) return "";

  const lines = [
    "体验策略(由用户语气和近期互动推断;不是用户明确指令;如果与当前输入冲突,以当前输入优先;不要把它写入长期记忆):"
  ];
  if (guidance.currentSignal) {
    lines.push(
      `- 当前语气:${guidance.currentSignal.satisfaction}/${guidance.currentSignal.aspect}/${guidance.currentSignal.tone}. ${guidance.currentSignal.summary}`
    );
  }
  for (const recommendation of guidance.recommendations) {
    if (recommendation) lines.push(`- 回复调整:${recommendation}`);
  }
  return lines.join("\n");
}

// 限制运行期体验信号数量.
function trimSignals(signals: AikoExperienceSignal[], maxSignals: number) {
  while (signals.length > maxSignals) {
    signals.shift();
  }
}

// 去除重复建议, 让 prompt 保持短.
function dedupeRecommendations(recommendations: string[]) {
  return [...new Set(recommendations.map((item) => item.trim()).filter(Boolean))];
}

// 克隆信号, 避免外部修改运行期数组.
function cloneSignal(signal: AikoExperienceSignal): AikoExperienceSignal {
  return { ...signal };
}
