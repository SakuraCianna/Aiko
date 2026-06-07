type SpeakOptions = {
  allowCloudTts?: boolean;
  maxCloudSegments?: number;
  emotion?: "neutral" | "happy" | "serious" | "comfort" | "notice";
  speed?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
  onMouthOpen?: (value: number) => void;
  onSegmentStart?: (segment: string, index: number) => void;
  onSegmentEnd?: (segment: string, index: number) => void;
};

type SpeechDuckOptions = {
  volume?: number;
  fadeMs?: number;
};

export type AikoSpeechController = {
  speak: (text: string, options?: SpeakOptions) => Promise<boolean>;
  cancel: () => void;
  duckForUserSpeech: (options?: SpeechDuckOptions) => boolean;
  interruptForUserSpeech: () => boolean;
  restoreVolume: (options?: { fadeMs?: number }) => void;
  isSpeaking: () => boolean;
  isSupported: () => boolean;
};

export type AikoSpeechControllerOptions = {
  synth?: SpeechSynthesis;
  synthesizeSpeech?: typeof window.aiko.synthesizeSpeech;
  AudioCtor?: typeof Audio;
  AudioContextCtor?: typeof AudioContext;
};

const MAX_SPEECH_SEGMENT_LENGTH = 120;
const DEFAULT_MAX_CLOUD_SEGMENTS = 4;
const AUDIO_VOLUME_FFT_SIZE = 512;
const AUDIO_SILENCE_FLOOR = 0.025;
const AUDIO_MOUTH_GAIN = 4.2;
const AUDIO_RMS_WEIGHT = 1.7;
const AUDIO_PEAK_WEIGHT = 0.32;
const MOUTH_ATTACK = 0.58;
const MOUTH_RELEASE = 0.24;
const MIN_VISIBLE_MOUTH_OPEN = 0.025;
const EVENT_MOUTH_INTERVAL_MS = 70;
const EVENT_MOUTH_FALLBACK_PULSE_MS = 240;
const DEFAULT_DUCK_VOLUME = 0.32;
const DEFAULT_DUCK_FADE_MS = 120;
const DEFAULT_RESTORE_FADE_MS = 160;
const VOLUME_FADE_INTERVAL_MS = 16;

type MouthDriver = {
  pulse?: (value?: number) => void;
  resume?: () => void;
  stop: (closeMouth?: boolean) => void;
};

type BrowserWindowWithAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

// 创建 Aiko 语音输出控制器, 支持分句队列, 中止和 VRM 口型驱动.
export function createAikoSpeechController(options: AikoSpeechControllerOptions = {}): AikoSpeechController {
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const synth = options.synth ?? browserWindow?.speechSynthesis;
  const synthesizeSpeech = options.synthesizeSpeech ?? browserWindow?.aiko?.synthesizeSpeech;
  const fallbackAudioCtor = typeof Audio === "undefined" ? undefined : Audio;
  const AudioCtor = options.AudioCtor ?? browserWindow?.Audio ?? fallbackAudioCtor;
  const AudioContextCtor = options.AudioContextCtor ?? readAudioContextConstructor(browserWindow);
  let activeAudio: HTMLAudioElement | null = null;
  let speechGeneration = 0;
  let activeMouthDriver: MouthDriver | null = null;
  let activeAudioSettle: ((ok: boolean) => void) | null = null;
  let activeWebSpeechSettle: ((ok: boolean) => void) | null = null;
  let volumeFadeTimer: ReturnType<typeof setInterval> | null = null;
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
      speechGeneration += 1;
      cancelActiveSpeech();
    },

    // 用户开始说话时先压低当前 TTS, 云端音频可渐变降音, Web Speech 则等待中止.
    duckForUserSpeech(duckOptions = {}) {
      if (!isSpeechActive()) return false;
      if (!activeAudio) return true;
      fadeAudioVolume(activeAudio, duckOptions.volume ?? DEFAULT_DUCK_VOLUME, duckOptions.fadeMs ?? DEFAULT_DUCK_FADE_MS);
      return true;
    },

    // 用户开口被确认后中止当前 TTS, 给 ASR 输入让路.
    interruptForUserSpeech() {
      if (!isSpeechActive()) return false;
      speechGeneration += 1;
      cancelActiveSpeech();
      return true;
    },

    // 录音结束或误触后恢复当前云端 TTS 音量.
    restoreVolume(restoreOptions = {}) {
      if (!activeAudio) return;
      fadeAudioVolume(activeAudio, 1, restoreOptions.fadeMs ?? DEFAULT_RESTORE_FADE_MS);
    },

    isSpeaking() {
      return isSpeechActive();
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
    return speakWithWebSpeech(
      segment,
      synth,
      options,
      startEventMouthDriver,
      stopMouthDriver,
      () => generation === speechGeneration,
      (settle) => {
        activeWebSpeechSettle = settle;
      },
      (settle) => {
        if (activeWebSpeechSettle === settle) activeWebSpeechSettle = null;
      }
    );
  }

  // 通过主进程调用云端 TTS 服务并等待该句播放结束.
  async function speakWithCloudTts(text: string, options: SpeakOptions, generation: number) {
    if (!synthesizeSpeech) return false;
    if (!AudioCtor) return false;
    try {
      const delivery = selectVoiceDelivery(text);
      const response = await synthesizeSpeech({
        text,
        emotion: options.emotion ?? delivery.emotion,
        speed: options.speed ?? delivery.speed
      });
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
        if (activeAudio === audio) {
          activeAudio = null;
          activeAudioSettle = null;
        }
        clearVolumeFadeTimer();
        stopMouthDriver();
        resolve(ok);
      };

      audio.volume = 1;
      activeAudioSettle = settle;
      audio.onplay = () => {
        if (generation !== speechGeneration) {
          settle(false);
          return;
        }
        options.onStart?.();
        const volumeDriverStarted = startVolumeMouthDriver(audio, options.onMouthOpen);
        if (volumeDriverStarted) {
          activeMouthDriver?.resume?.();
          return;
        }
        const eventDriver = startEventMouthDriver(options.onMouthOpen);
        eventDriver?.pulse?.(0.42);
      };
      audio.onended = () => settle(generation === speechGeneration);
      audio.onerror = () => settle(false);
      void audio.play().catch(() => settle(false));
    });
  }

  // 停止当前 HTMLAudioElement 播放.
  function stopAudio() {
    if (!activeAudio) return;
    const audio = activeAudio;
    const settle = activeAudioSettle;
    activeAudio = null;
    activeAudioSettle = null;
    audio.pause();
    audio.currentTime = 0;
    settle?.(false);
  }

  // 停止当前语音输出, 包括云端音频, Web Speech 和口型驱动.
  function cancelActiveSpeech() {
    stopAudio();
    synth?.cancel();
    activeWebSpeechSettle?.(false);
    activeWebSpeechSettle = null;
    clearVolumeFadeTimer();
    stopMouthDriver();
  }

  // 云端 TTS 返回真实音频后, 直接采样当前播放波形的音量来驱动口型.
  function startVolumeMouthDriver(audio: HTMLAudioElement, onMouthOpen: ((value: number) => void) | undefined) {
    latestMouthCallback = onMouthOpen;
    if (!latestMouthCallback || !AudioContextCtor) return false;
    stopMouthDriver(false);
    try {
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaElementSource(audio);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = AUDIO_VOLUME_FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      const samples = new Uint8Array(analyser.fftSize);
      let frameId: number | null = null;
      let stopped = false;
      let smoothedMouthOpen = 0;

      const resume = () => {
        if (audioContext.state === "suspended") {
          void audioContext.resume().catch(() => undefined);
        }
      };

      const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(samples);
        const targetMouthOpen = calculateVolumeMouthOpen(samples);
        const smoothing = targetMouthOpen > smoothedMouthOpen ? MOUTH_ATTACK : MOUTH_RELEASE;
        smoothedMouthOpen += (targetMouthOpen - smoothedMouthOpen) * smoothing;
        latestMouthCallback?.(smoothedMouthOpen < MIN_VISIBLE_MOUTH_OPEN ? 0 : smoothedMouthOpen);
        frameId = requestAnimationFrame(tick);
      };

      activeMouthDriver = {
        resume,
        stop(closeMouth = true) {
          stopped = true;
          if (frameId !== null) cancelAnimationFrame(frameId);
          source.disconnect();
          analyser.disconnect();
          if (audioContext.state !== "closed") {
            void audioContext.close().catch(() => undefined);
          }
          if (closeMouth) latestMouthCallback?.(0);
        }
      };

      resume();
      tick();
      return true;
    } catch {
      return false;
    }
  }

  // Web Speech 不暴露合成后的音频帧, 这里只做事件级兼容口型.
  function startEventMouthDriver(onMouthOpen: ((value: number) => void) | undefined): MouthDriver | null {
    latestMouthCallback = onMouthOpen;
    if (!latestMouthCallback) return null;
    stopMouthDriver(false);

    let currentMouthOpen = 0;
    let targetMouthOpen = 0;
    let lastPulseAt = readNow();

    const timer = setInterval(() => {
      const now = readNow();
      if (now - lastPulseAt > EVENT_MOUTH_FALLBACK_PULSE_MS) {
        targetMouthOpen = Math.max(targetMouthOpen, 0.34);
        lastPulseAt = now;
      }
      const smoothing = targetMouthOpen > currentMouthOpen ? MOUTH_ATTACK : MOUTH_RELEASE;
      currentMouthOpen += (targetMouthOpen - currentMouthOpen) * smoothing;
      latestMouthCallback?.(currentMouthOpen < MIN_VISIBLE_MOUTH_OPEN ? 0 : currentMouthOpen);
      targetMouthOpen *= 0.6;
    }, EVENT_MOUTH_INTERVAL_MS);

    const driver: MouthDriver = {
      pulse(value = 0.52) {
        targetMouthOpen = Math.max(targetMouthOpen, value);
        lastPulseAt = readNow();
      },
      stop(closeMouth = true) {
        clearInterval(timer);
        if (closeMouth) latestMouthCallback?.(0);
      }
    };
    activeMouthDriver = driver;
    return driver;
  }

  // 停止口型驱动并让嘴部闭合.
  function stopMouthDriver(closeMouth = true) {
    const driver = activeMouthDriver;
    activeMouthDriver = null;
    if (driver) {
      driver.stop(closeMouth);
      return;
    }
    if (closeMouth) latestMouthCallback?.(0);
  }

  function isSpeechActive() {
    return Boolean(activeAudio || activeAudioSettle || activeWebSpeechSettle);
  }

  function fadeAudioVolume(audio: HTMLAudioElement, targetVolume: number, fadeMs: number) {
    clearVolumeFadeTimer();
    const fromVolume = audio.volume;
    const nextVolume = clamp(targetVolume, 0, 1);
    if (fadeMs <= 0) {
      audio.volume = nextVolume;
      return;
    }

    const startedAt = readNow();
    volumeFadeTimer = setInterval(() => {
      const progress = clamp((readNow() - startedAt) / fadeMs, 0, 1);
      audio.volume = fromVolume + (nextVolume - fromVolume) * progress;
      if (progress >= 1) clearVolumeFadeTimer();
    }, VOLUME_FADE_INTERVAL_MS);
  }

  function clearVolumeFadeTimer() {
    if (!volumeFadeTimer) return;
    clearInterval(volumeFadeTimer);
    volumeFadeTimer = null;
  }
}

// 把 Web Audio 的时域采样转换成 VRM 需要的 0 到 1 口型权重.
export function calculateVolumeMouthOpen(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let squareSum = 0;
  let peak = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    const absolute = Math.abs(centered);
    squareSum += centered * centered;
    if (absolute > peak) peak = absolute;
  }

  const rms = Math.sqrt(squareSum / samples.length);
  const loudness = rms * AUDIO_RMS_WEIGHT + peak * AUDIO_PEAK_WEIGHT;
  if (loudness <= AUDIO_SILENCE_FLOOR) return 0;
  const normalized = clamp((loudness - AUDIO_SILENCE_FLOOR) * AUDIO_MOUTH_GAIN, 0, 1);
  return clamp(0.06 + Math.pow(normalized, 0.72) * 0.88, 0, 1);
}

// 读取可用的 Web Audio 构造器, 兼容旧 WebKit 命名.
function readAudioContextConstructor(browserWindow: (Window & typeof globalThis) | undefined) {
  const audioWindow = browserWindow as BrowserWindowWithAudio | undefined;
  return audioWindow?.AudioContext ?? audioWindow?.webkitAudioContext;
}

function readNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 使用浏览器 Web Speech API 作为兜底语音合成.
function speakWithWebSpeech(
  text: string,
  synth: SpeechSynthesis | undefined,
  options: SpeakOptions,
  startEventMouthDriver: (onMouthOpen: ((value: number) => void) | undefined) => MouthDriver | null,
  stopMouthDriver: (closeMouth?: boolean) => void,
  isCurrentGeneration: () => boolean,
  registerSettle: (settle: (ok: boolean) => void) => void,
  clearSettle: (settle: (ok: boolean) => void) => void
) {
  if (!synth) return false;
  const delivery = selectVoiceDelivery(text);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = options.speed ?? delivery.speed;
  utterance.pitch = delivery.pitch;
  utterance.volume = 1;

  const voice = selectAikoVoice(synth.getVoices());
  if (voice) utterance.voice = voice;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearSettle(settle);
      stopMouthDriver();
      resolve(ok && isCurrentGeneration());
    };
    let mouthDriver: MouthDriver | null = null;

    utterance.onstart = () => {
      if (!isCurrentGeneration()) {
        settle(false);
        return;
      }
      options.onStart?.();
      mouthDriver = startEventMouthDriver(options.onMouthOpen);
      mouthDriver?.pulse?.(0.42);
    };
    utterance.onboundary = (event) => {
      const value = event.name === "sentence" ? 0.42 : 0.58;
      mouthDriver?.pulse?.(value);
    };
    utterance.onend = () => settle(true);
    utterance.onerror = () => settle(false);
    registerSettle(settle);
    synth.speak(utterance);
  });
}

// 根据句子情绪给云端 TTS 和 Web Speech 一组轻量参数, 与角色动作保持同一方向.
export function selectVoiceDelivery(text: string): {
  emotion: NonNullable<SpeakOptions["emotion"]>;
  speed: number;
  pitch: number;
} {
  const normalized = normalizeSpeechText(text);
  if (/(失败|出错|不能|无法|没有找到|暂时不可用|风险|确认|权限)/.test(normalized)) {
    return { emotion: "serious", speed: 0.96, pitch: 1.02 };
  }
  if (/(已完成|成功|好了|接住了|没问题|可以)/.test(normalized)) {
    return { emotion: "happy", speed: 1.06, pitch: 1.16 };
  }
  if (/(别急|先稳住|我在|慢慢来|没关系)/.test(normalized)) {
    return { emotion: "comfort", speed: 0.94, pitch: 1.08 };
  }
  if (/(注意|等你确认|关键风险|高风险|截图|屏幕|窗口|键盘|鼠标)/.test(normalized)) {
    return { emotion: "notice", speed: 0.98, pitch: 1.06 };
  }
  return { emotion: "neutral", speed: 1.04, pitch: 1.12 };
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
