import type { SpeechSynthesisInput, SpeechSynthesisProvider, SpeechSynthesisResult } from "./voiceTypes";

type CachedSpeechSynthesisProviderOptions = {
  maxEntries?: number;
};

const DEFAULT_MAX_CACHE_ENTRIES = 80;

// 给 TTS provider 增加内存缓存, 避免常见短句重复消耗云端额度.
export function createCachedSpeechSynthesisProvider(
  provider: SpeechSynthesisProvider,
  options: CachedSpeechSynthesisProviderOptions = {}
): SpeechSynthesisProvider {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const cache = new Map<string, SpeechSynthesisResult>();

  return {
    // 只缓存成功结果, 失败或限流响应不污染后续调用.
    async synthesize(input: SpeechSynthesisInput) {
      const key = createCacheKey(input);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }

      const result = await provider.synthesize(input);
      if (result.ok) {
        cache.set(key, result);
        trimOldestEntries(cache, maxEntries);
      }
      return result;
    }
  };
}

// 生成和语音内容, 情绪, 音色, 语速, 格式绑定的缓存 key.
function createCacheKey(input: SpeechSynthesisInput) {
  return JSON.stringify({
    text: input.text,
    voiceProfileId: input.voiceProfileId ?? "",
    emotion: input.emotion ?? "neutral",
    speed: input.speed ?? 1,
    format: input.format ?? "wav"
  });
}

// 保持缓存为简单 LRU, 防止长时间运行时无限增长.
function trimOldestEntries(cache: Map<string, SpeechSynthesisResult>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}
