type SpeakOptions = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

export type AikoSpeechController = {
  speak: (text: string, options?: SpeakOptions) => Promise<boolean>;
  cancel: () => void;
  isSupported: () => boolean;
};

export type AikoSpeechControllerOptions = {
  synth?: SpeechSynthesis;
  synthesizeSpeech?: typeof window.aiko.synthesizeSpeech;
  AudioCtor?: typeof Audio;
};

// 创建 Aiko 语音输出控制器, 优先使用本地 CosyVoice, 失败时退回浏览器 Web Speech.
export function createAikoSpeechController(options: AikoSpeechControllerOptions = {}): AikoSpeechController {
  const synth = options.synth ?? window.speechSynthesis;
  const synthesizeSpeech = options.synthesizeSpeech ?? window.aiko?.synthesizeSpeech;
  const AudioCtor = options.AudioCtor ?? Audio;
  let activeAudio: HTMLAudioElement | null = null;

  return {
    // 播放一段 Aiko 回复, 返回 false 表示当前环境没有可用语音合成能力.
    async speak(text, speakOptions) {
      const speechText = normalizeSpeechText(text);
      if (!speechText) return false;

      stopAudio();
      synth?.cancel();
      const remoteStarted = await speakWithCosyVoice(speechText, speakOptions);
      if (remoteStarted) return true;
      return speakWithWebSpeech(speechText, synth, speakOptions);
    },

    // 停止当前语音输出.
    cancel() {
      stopAudio();
      synth?.cancel();
    },

    // 判断当前 renderer 是否有远端 TTS 或系统语音合成.
    isSupported() {
      return Boolean(synthesizeSpeech || synth);
    }
  };

  // 通过主进程调用本地 CosyVoice 服务并播放返回音频.
  async function speakWithCosyVoice(text: string, speakOptions?: SpeakOptions) {
    if (!synthesizeSpeech) return false;
    try {
      const response = await synthesizeSpeech({ text, emotion: "neutral", speed: 1 });
      if (!response.ok) return false;
      const audio = new AudioCtor(response.dataUrl);
      activeAudio = audio;
      audio.onplay = () => speakOptions?.onStart?.();
      audio.onended = () => {
        if (activeAudio === audio) activeAudio = null;
        speakOptions?.onEnd?.();
      };
      audio.onerror = () => {
        if (activeAudio === audio) activeAudio = null;
        speakOptions?.onError?.();
      };
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  // 停止当前 HTMLAudioElement 播放.
  function stopAudio() {
    if (!activeAudio) return;
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

// 使用浏览器 Web Speech API 作为兜底语音合成.
function speakWithWebSpeech(text: string, synth: SpeechSynthesis | undefined, options?: SpeakOptions) {
  if (!synth) return false;
  const utterance = new SpeechSynthesisUtterance(text);
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
}

// 把 Markdown 和 UI 标记清理成适合 TTS 朗读的文本.
export function normalizeSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " 代码内容已省略 ")
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
