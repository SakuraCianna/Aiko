type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  length?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

type SpeechWindowLike = {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

export type RealtimeSpeechController = {
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type RealtimeSpeechCallbacks = {
  onInterimTranscript: (transcript: string) => void;
  onFinalTranscript: (transcript: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

export type RealtimeSpeechSupport = {
  supported: boolean;
  reason: string;
};

// 检查当前渲染环境是否提供浏览器实时语音识别构造器.
export function getRealtimeSpeechSupport(scope: SpeechWindowLike = getDefaultSpeechScope()): RealtimeSpeechSupport {
  if (getSpeechRecognitionConstructor(scope)) {
    return { supported: true, reason: "" };
  }

  return {
    supported: false,
    reason: "当前 Electron/Chromium 环境没有提供 Web Speech API 实时语音识别."
  };
}

// 创建实时语音识别控制器, 用于把麦克风语音转为文本.
export function createRealtimeSpeechController(
  callbacks: RealtimeSpeechCallbacks,
  scope: SpeechWindowLike = getDefaultSpeechScope()
): RealtimeSpeechController | null {
  const Recognition = getSpeechRecognitionConstructor(scope);
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const update = collectSpeechRecognitionText(event);
    if (update.interimTranscript) callbacks.onInterimTranscript(update.interimTranscript);
    if (update.finalTranscript) callbacks.onFinalTranscript(update.finalTranscript);
  };

  recognition.onerror = (event) => {
    callbacks.onError(normalizeSpeechError(event.error, event.message));
  };

  recognition.onend = () => {
    callbacks.onEnd();
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort()
  };
}

// 从 Web Speech API 的 result 事件里拆出临时文本和最终文本.
export function collectSpeechRecognitionText(event: SpeechRecognitionEventLike) {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = normalizeTranscript(result[0]?.transcript ?? "");
    if (!transcript) continue;

    if (result.isFinal) {
      finalParts.push(transcript);
    } else {
      interimParts.push(transcript);
    }
  }

  return {
    finalTranscript: finalParts.join(" "),
    interimTranscript: interimParts.join(" ")
  };
}

// 把浏览器语音识别错误转换成用户可读提示.
export function normalizeSpeechError(error: string, message = ""): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "无法访问麦克风, 请检查 Windows 麦克风权限.";
  }

  if (error === "no-speech") {
    return "没有识别到有效语音, 可以再说一次.";
  }

  if (error === "audio-capture") {
    return "没有检测到可用麦克风设备.";
  }

  if (error === "network") {
    return "实时语音识别网络不可用, 可以先改用文字输入.";
  }

  return message || `实时语音识别失败: ${error}`;
}

// 合并语音片段前统一清理空白.
export function normalizeTranscript(transcript: string): string {
  return transcript.replace(/\s+/g, " ").trim();
}

// 兼容 Chromium 的 webkit 前缀实现和标准实现.
function getSpeechRecognitionConstructor(scope: SpeechWindowLike): SpeechRecognitionConstructorLike | undefined {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

// DOM 类型尚未稳定暴露 SpeechRecognition, 因此这里集中做一次显式适配.
function getDefaultSpeechScope(): SpeechWindowLike {
  return window as unknown as SpeechWindowLike;
}
