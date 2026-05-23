type SpeakOptions = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

export type AikoSpeechController = {
  speak: (text: string, options?: SpeakOptions) => boolean;
  cancel: () => void;
  isSupported: () => boolean;
};

// 创建基于浏览器 Web Speech API 的本地语音输出控制器.
export function createAikoSpeechController(synth: SpeechSynthesis | undefined = window.speechSynthesis): AikoSpeechController {
  return {
    // 播放一段 Aiko 回复, 返回 false 表示当前环境不支持语音合成.
    speak(text, options) {
      if (!synth) return false;
      const speechText = normalizeSpeechText(text);
      if (!speechText) return false;

      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.lang = "zh-CN";
      utterance.rate = 1.04;
      utterance.pitch = 1.12;
      utterance.volume = 1;

      const voice = selectAikoVoice(synth.getVoices());
      if (voice) utterance.voice = voice;

      utterance.onstart = () => options?.onStart?.();
      utterance.onend = () => options?.onEnd?.();
      utterance.onerror = () => options?.onError?.();
      synth.speak(utterance);
      return true;
    },
    // 停止当前语音输出.
    cancel() {
      synth?.cancel();
    },
    // 判断当前 renderer 是否能使用系统语音合成.
    isSupported() {
      return Boolean(synth);
    }
  };
}

// 把 Markdown 和 UI 标记清理成适合 TTS 朗读的文本.
export function normalizeSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " 代码内容已省略. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_#>`~-]+/g, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 优先选择中文女声, 没有时退回任意中文语音.
function selectAikoVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const preferredNames = ["xiaoxiao", "huihui", "yaoyao", "hanhan", "kangkang"];
  const chineseVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
  const preferredVoice = chineseVoices.find((voice) => preferredNames.some((name) => voice.name.toLowerCase().includes(name)));
  return preferredVoice ?? chineseVoices[0] ?? null;
}
