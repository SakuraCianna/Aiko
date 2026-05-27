type SpeakOptions = {
  allowCloudTts?: boolean;
  maxCloudSegments?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
  onMouthOpen?: (value: number) => void;
  onSegmentStart?: (segment: string, index: number) => void;
  onSegmentEnd?: (segment: string, index: number) => void;
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

const MAX_SPEECH_SEGMENT_LENGTH = 120;
const DEFAULT_MAX_CLOUD_SEGMENTS = 4;

// 创建 Aiko 语音输出控制器, 支持分句队列, 中止和 VRM 口型驱动.
export function createAikoSpeechController(options: AikoSpeechControllerOptions = {}): AikoSpeechController {
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const synth = options.synth ?? browserWindow?.speechSynthesis;
  const synthesizeSpeech = options.synthesizeSpeech ?? browserWindow?.aiko?.synthesizeSpeech;
  const fallbackAudioCtor = typeof Audio === "undefined" ? undefined : Audio;
  const AudioCtor = options.AudioCtor ?? browserWindow?.Audio ?? fallbackAudioCtor;
  let activeAudio: HTMLAudioElement | null = null;
  let speechGeneration = 0;
  let mouthTimer: ReturnType<typeof setInterval> | null = null;
  let latestMouthCallback: ((value: number) => void) | undefined;

  return {
    // 播放一段 Aiko 回复, 长文本会被拆成多个短句顺序播放.
    async speak(text, speakOptions = {}) {
      const segments = splitSpeechSegments(normalizeSpeechText(text));
      if (segments.length === 0) return false;

      cancelActiveSpeech();
      const generation = ++speechGeneration;
      latestMouthCallback = speakOptions.onMouthOpen;
      let started = false;
      const maxCloudSegments = speakOptions.maxCloudSegments ?? DEFAULT_MAX_CLOUD_SEGMENTS;

      for (let index = 0; index < segments.length; index += 1) {
        if (generation !== speechGeneration) break;
        const segment = segments[index]!;
        speakOptions.onSegmentStart?.(segment, index);
        const segmentStarted = await speakSegment(segment, index, maxCloudSegments, speakOptions, generation);
        if (segmentStarted) started = true;
        speakOptions.onSegmentEnd?.(segment, index);
      }

      if (generation === speechGeneration) {
        stopMouthDriver();
        if (started) speakOptions.onEnd?.();
      }
      return started;
    },

    // 停止当前语音输出并清空口型.
    cancel() {
      cancelActiveSpeech();
      speechGeneration += 1;
    },

    // 判断当前 renderer 是否有可用的云端 TTS 或系统语音合成.
    isSupported() {
      return Boolean(synthesizeSpeech || synth);
    }
  };

  // 对单句优先使用云端 TTS, 失败时退回 Web Speech.
  async function speakSegment(
    segment: string,
    index: number,
    maxCloudSegments: number,
    options: SpeakOptions,
    generation: number
  ) {
    if (options.allowCloudTts !== false && index < maxCloudSegments) {
      const cloudStarted = await speakWithCloudTts(segment, options, generation);
      if (cloudStarted) return true;
    }
    return speakWithWebSpeech(segment, synth, options, generation);
  }

  // 通过主进程调用云端 TTS 服务并等待该句播放结束.
  async function speakWithCloudTts(text: string, options: SpeakOptions, generation: number) {
    if (!synthesizeSpeech) return false;
    if (!AudioCtor) return false;
    try {
      const response = await synthesizeSpeech({ text, emotion: "neutral", speed: 1 });
      if (!response.ok || generation !== speechGeneration) return false;
      const audio = new AudioCtor(response.dataUrl);
      activeAudio = audio;
      return await playAudioElement(audio, options, generation);
    } catch {
      return false;
    }
  }

  // 播放 HTMLAudioElement, 把播放生命周期转成 Promise.
  function playAudioElement(audio: HTMLAudioElement, options: SpeakOptions, generation: number) {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        if (activeAudio === audio) activeAudio = null;
        stopMouthDriver();
        resolve(ok);
      };

      audio.onplay = () => {
        if (generation !== speechGeneration) {
          settle(false);
          return;
        }
        options.onStart?.();
        startMouthDriver(options.onMouthOpen);
      };
      audio.onended = () => settle(true);
      audio.onerror = () => settle(false);
      void audio.play().catch(() => settle(false));
    });
  }

  // 停止当前 HTMLAudioElement 播放.
  function stopAudio() {
    if (!activeAudio) return;
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  // 停止当前语音输出, 包括云端音频, Web Speech 和口型驱动.
  function cancelActiveSpeech() {
    stopAudio();
    synth?.cancel();
    stopMouthDriver();
  }

  // 启动轻量口型驱动, 后续可以替换成真实音素/音量曲线.
  function startMouthDriver(onMouthOpen: ((value: number) => void) | undefined) {
    latestMouthCallback = onMouthOpen;
    if (!latestMouthCallback) return;
    stopMouthDriver(false);
    latestMouthCallback(0.55);
    mouthTimer = setInterval(() => {
      const phase = (Date.now() / 90) % Math.PI;
      latestMouthCallback?.(0.22 + Math.abs(Math.sin(phase)) * 0.48);
    }, 90);
  }

  // 停止口型驱动并让嘴部闭合.
  function stopMouthDriver(closeMouth = true) {
    if (mouthTimer) {
      clearInterval(mouthTimer);
      mouthTimer = null;
    }
    if (closeMouth) latestMouthCallback?.(0);
  }
}

// 使用浏览器 Web Speech API 作为兜底语音合成.
function speakWithWebSpeech(
  text: string,
  synth: SpeechSynthesis | undefined,
  options: SpeakOptions,
  _generation: number
) {
  if (!synth) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 1.04;
  utterance.pitch = 1.12;
  utterance.volume = 1;

  const voice = selectAikoVoice(synth.getVoices());
  if (voice) utterance.voice = voice;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const stopWebSpeechMouth = () => options.onMouthOpen?.(0);
    const settle = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      stopWebSpeechMouth();
      resolve(ok);
    };

    utterance.onstart = () => {
      options.onStart?.();
      options.onMouthOpen?.(0.5);
    };
    utterance.onend = () => settle(true);
    utterance.onerror = () => settle(false);
    synth.speak(utterance);
  });
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

// 把长回复拆成适合 TTS 的短句队列.
export function splitSpeechSegments(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const sentenceMatches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [normalized];
  return sentenceMatches.flatMap((sentence) => splitLongSpeechSegment(sentence.trim())).filter(Boolean);
}

// 对仍然过长的句子按长度硬切分, 防止单次 TTS 请求过长.
function splitLongSpeechSegment(segment: string): string[] {
  if (segment.length <= MAX_SPEECH_SEGMENT_LENGTH) return [segment];
  const chunks: string[] = [];
  for (let index = 0; index < segment.length; index += MAX_SPEECH_SEGMENT_LENGTH) {
    chunks.push(segment.slice(index, index + MAX_SPEECH_SEGMENT_LENGTH));
  }
  return chunks;
}

// 优先选择中文女声, 没有时退回任意中文语音.
function selectAikoVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const preferredNames = ["xiaoxiao", "huihui", "yaoyao", "hanhan", "kangkang"];
  const chineseVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
  const preferredVoice = chineseVoices.find((voice) => preferredNames.some((name) => voice.name.toLowerCase().includes(name)));
  return preferredVoice ?? chineseVoices[0] ?? null;
}
