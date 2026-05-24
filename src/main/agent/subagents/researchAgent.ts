import type { CurrentKnowledgeContext, CurrentKnowledgeProvider } from "../knowledge/currentKnowledgeProvider";
import type { WebRetriever } from "../retriever/webRetriever";
import type { WebResearchContext } from "../retriever/webTypes";

export type AikoResearchAgentInput = {
  userText: string;
  userTranscript: string;
};

export type AikoResearchAgentResult = {
  webResearch: WebResearchContext | null;
  currentKnowledge: CurrentKnowledgeContext | null;
};

export type AikoResearchAgentOptions = {
  webRetriever?: WebRetriever;
  currentKnowledgeProvider?: CurrentKnowledgeProvider;
};

export type AikoResearchAgent = {
  retrieve: (input: AikoResearchAgentInput, options?: AikoResearchAgentRequestOptions) => Promise<AikoResearchAgentResult>;
};

export type AikoResearchAgentRequestOptions = {
  signal?: AbortSignal;
};

// 创建 Research 子 Agent, 统一管理外部检索和固定实时知识 provider.
export function createAikoResearchAgent(options: AikoResearchAgentOptions = {}): AikoResearchAgent {
  return {
    // 并行获取网页检索和实时知识, 单个 provider 失败时只降级对应结果.
    async retrieve(input, requestOptions = {}) {
      const [webResearch, currentKnowledge] = await Promise.all([
        retrieveWebResearch(options.webRetriever, input, requestOptions),
        retrieveCurrentKnowledge(options.currentKnowledgeProvider, input, requestOptions)
      ]);

      return {
        webResearch,
        currentKnowledge
      };
    }
  };
}

// 调用网页检索器, 失败时降级为空上下文, 避免 Tavily/MCP 阻断本地聊天.
async function retrieveWebResearch(
  webRetriever: WebRetriever | undefined,
  input: AikoResearchAgentInput,
  options: AikoResearchAgentRequestOptions
): Promise<WebResearchContext | null> {
  if (!webRetriever) return null;
  try {
    return await webRetriever.retrieve(input, options);
  } catch (error) {
    console.warn("[aiko:research-agent] web research failed", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

// 调用固定实时知识 provider, 失败时降级为空上下文, 避免外部 API 阻断主流程.
async function retrieveCurrentKnowledge(
  currentKnowledgeProvider: CurrentKnowledgeProvider | undefined,
  input: AikoResearchAgentInput,
  options: AikoResearchAgentRequestOptions
): Promise<CurrentKnowledgeContext | null> {
  if (!currentKnowledgeProvider) return null;
  try {
    return await currentKnowledgeProvider.retrieve(input, options);
  } catch (error) {
    console.warn("[aiko:research-agent] current knowledge failed", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
