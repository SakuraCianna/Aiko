import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent as ReactSubmitEvent } from "react";
import { ImagePlus, Mic, Send, Square, X } from "lucide-react";
import {
  isImageMimeType,
  MAX_ATTACHMENTS,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  type ChatAttachment,
  type ChatPayload
} from "../../shared/chatPayload";
import { createAudioAttachmentFromBlob, selectSupportedAudioMimeType } from "../audio/microphoneRecorder";
import {
  createRealtimeSpeechController,
  getRealtimeSpeechSupport,
  normalizeTranscript,
  type RealtimeSpeechController
} from "../audio/realtimeSpeech";

type CommandInputProps = {
  onSubmit: (payload: ChatPayload) => void | Promise<void>;
};

// 渲染桌宠底部输入框, 负责文本, 图片和麦克风录音入口.
export function CommandInput({ onSubmit }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const speechControllerRef = useRef<RealtimeSpeechController | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const recordingSessionRef = useRef<string | null>(null);
  const speechSessionRef = useRef<string | null>(null);
  const speechFinalTranscriptRef = useRef("");
  const speechInterimTranscriptRef = useRef("");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanupRealtimeSpeech();
      cleanupRecording();
    };
  }, []);

  // 提交当前文本和附件.
  function submit(event: ReactSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    submitPayload(value);
  }

  // 统一提交聊天 payload, 保证语音识别和手动输入使用同一条路径.
  function submitPayload(text: string) {
    const trimmed = text.trim();
    const currentAttachments = attachmentsRef.current;
    if (!trimmed && currentAttachments.length === 0) return false;
    void onSubmit({ text: trimmed, attachments: currentAttachments });
    setValue("");
    setAttachmentList([]);
    setError("");
    return true;
  }

  // 校验并读取用户选择的图片文件.
  async function handleImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    setError("");

    if (attachmentsRef.current.length + selectedFiles.length > MAX_ATTACHMENTS) {
      setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return;
    }

    const nextAttachments: ChatAttachment[] = [];
    for (const file of selectedFiles) {
      if (!isImageMimeType(file.type)) {
        setError("只支持 PNG, JPEG, WebP, GIF 图片.");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        setError("单张图片不能超过 5 MB.");
        return;
      }

      const dataUrl = await readAsDataUrl(file);
      if (!mountedRef.current) return;

      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: "image",
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl
      });
    }

    appendAttachments(nextAttachments);
  }

  // 切换语音输入, 优先实时识别, 不支持时退回录音附件.
  async function toggleVoiceInput() {
    setError("");

    if (speechSessionRef.current) {
      stopRealtimeSpeech();
      return;
    }

    if (recordingSessionRef.current) {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        cleanupRecording();
      }
      return;
    }

    const support = getRealtimeSpeechSupport();
    if (support.supported) {
      startRealtimeSpeech();
      return;
    }

    setError(`${support.reason} 已切换为录音附件模式.`);
    await toggleAudioAttachmentRecording();
  }

  // 开始浏览器实时语音识别, 把识别文本直接填入并提交给 Agent.
  function startRealtimeSpeech() {
    const sessionId = crypto.randomUUID();
    const controller = createRealtimeSpeechController({
      onInterimTranscript: (transcript) => {
        if (!isActiveSpeechSession(sessionId)) return;
        speechInterimTranscriptRef.current = normalizeTranscript(transcript);
        setValue(mergeSpeechTranscript(speechFinalTranscriptRef.current, speechInterimTranscriptRef.current));
      },
      onFinalTranscript: (transcript) => {
        if (!isActiveSpeechSession(sessionId)) return;
        speechFinalTranscriptRef.current = mergeSpeechTranscript(speechFinalTranscriptRef.current, transcript);
        speechInterimTranscriptRef.current = "";
        setValue(speechFinalTranscriptRef.current);
      },
      onError: (message) => {
        if (!isActiveSpeechSession(sessionId)) return;
        setError(message);
        cleanupRealtimeSpeech();
      },
      onEnd: () => finishRealtimeSpeech(sessionId)
    });

    if (!controller) {
      setError("当前环境无法启动实时语音识别.");
      return;
    }

    speechSessionRef.current = sessionId;
    speechControllerRef.current = controller;
    speechFinalTranscriptRef.current = "";
    speechInterimTranscriptRef.current = "";
    setIsListening(true);

    try {
      controller.start();
    } catch {
      cleanupRealtimeSpeech();
      setError("实时语音识别启动失败, 可以先改用文字输入.");
    }
  }

  // 开始或停止旧版默认麦克风录音附件模式.
  async function toggleAudioAttachmentRecording() {
    if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
      setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前环境无法调用麦克风录音.");
      return;
    }

    const sessionId = crypto.randomUUID();
    recordingSessionRef.current = sessionId;
    setIsRecording(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || recordingSessionRef.current !== sessionId) {
        stopMediaStream(stream);
        return;
      }

      const mimeType = selectSupportedAudioMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordingChunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (recordingSessionRef.current !== sessionId) return;
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      });

      recorder.addEventListener(
        "stop",
        () => {
          void finishRecording(sessionId);
        },
        { once: true }
      );

      recorder.start();
    } catch {
      if (recordingSessionRef.current !== sessionId) return;
      cleanupRecording();
      if (mountedRef.current) setError("无法访问默认麦克风, 请检查 Windows 麦克风权限.");
    }
  }

  // 判断指定实时语音会话是否仍然有效.
  function isActiveSpeechSession(sessionId: string) {
    return speechSessionRef.current === sessionId;
  }

  // 停止实时语音识别, 让浏览器触发 onend 后统一提交.
  function stopRealtimeSpeech() {
    const controller = speechControllerRef.current;
    if (!controller) {
      cleanupRealtimeSpeech();
      return;
    }

    try {
      controller.stop();
    } catch {
      cleanupRealtimeSpeech();
    }
  }

  // 实时语音结束后提交最终文本, 没有最终文本时使用最后一次临时文本兜底.
  function finishRealtimeSpeech(sessionId: string) {
    if (!isActiveSpeechSession(sessionId)) return;

    const transcript = mergeSpeechTranscript(speechFinalTranscriptRef.current, speechInterimTranscriptRef.current);
    speechSessionRef.current = null;
    speechControllerRef.current = null;
    speechFinalTranscriptRef.current = "";
    speechInterimTranscriptRef.current = "";
    if (mountedRef.current) setIsListening(false);

    if (!submitPayload(transcript) && mountedRef.current) {
      setError("没有识别到有效语音, 可以再说一次.");
    }
  }

  // 停止录音后把音频片段转换成聊天附件.
  async function finishRecording(sessionId: string) {
    if (recordingSessionRef.current !== sessionId) return;

    const chunks = recordingChunksRef.current;
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    recordingSessionRef.current = null;
    recorderRef.current = null;
    recordingChunksRef.current = [];
    stopMicrophoneStream();
    if (mountedRef.current) setIsRecording(false);

    if (!mountedRef.current) return;

    if (chunks.length === 0) {
      setError("没有录到有效语音.");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("单段语音不能超过 15 MB.");
      return;
    }

    const attachment = await createAudioAttachmentFromBlob(blob);
    if (!mountedRef.current) return;
    appendAttachments([attachment]);
  }

  // 同步附件状态和附件引用, 避免异步回调使用过期数组.
  function setAttachmentList(nextAttachments: ChatAttachment[]) {
    attachmentsRef.current = nextAttachments;
    if (mountedRef.current) setAttachments(nextAttachments);
  }

  // 追加附件并在提交时再次检查数量上限.
  function appendAttachments(nextAttachments: ChatAttachment[]) {
    if (nextAttachments.length === 0) return;
    const currentAttachments = attachmentsRef.current;
    if (currentAttachments.length + nextAttachments.length > MAX_ATTACHMENTS) {
      if (mountedRef.current) setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return;
    }
    setAttachmentList([...currentAttachments, ...nextAttachments]);
  }

  // 停止当前录音会话并释放关联资源.
  function cleanupRecording() {
    recordingSessionRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingChunksRef.current = [];
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopMicrophoneStream();
    if (mountedRef.current) setIsRecording(false);
  }

  // 取消实时语音识别并清理临时文本.
  function cleanupRealtimeSpeech() {
    speechSessionRef.current = null;
    speechFinalTranscriptRef.current = "";
    speechInterimTranscriptRef.current = "";
    const controller = speechControllerRef.current;
    speechControllerRef.current = null;
    try {
      controller?.abort();
    } catch {
      // 语音控制器可能已经被浏览器释放, 清理阶段忽略即可.
    }
    if (mountedRef.current) setIsListening(false);
  }

  // 停止麦克风流, 释放系统录音资源.
  function stopMicrophoneStream() {
    if (!streamRef.current) return;
    stopMediaStream(streamRef.current);
    streamRef.current = null;
  }

  // 从待发送列表中移除指定附件.
  function removeAttachment(id: string) {
    setAttachmentList(attachmentsRef.current.filter((attachment) => attachment.id !== id));
  }

  return (
    <div className="command-shell">
      {attachments.length > 0 && (
        <div className="attachment-strip" aria-label="已选择的附件">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="attachment-chip">
              {attachment.kind === "image" ? "图片" : "语音"} - {attachment.name}
              <button type="button" title="移除附件" onClick={() => removeAttachment(attachment.id)}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <div className="command-error">{error}</div>}
      <form className="command-input" onSubmit={submit}>
        <input
          aria-label="和 Aiko 说话"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder="和 Aiko 说点什么..."
        />
        <input
          ref={imageInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => void handleImageFiles(event)}
        />
        <button type="button" title="上传图片" onClick={() => imageInputRef.current?.click()}>
          <ImagePlus size={16} />
        </button>
        <button
          type="button"
          className={isListening || isRecording ? "recording-button" : undefined}
          title={isListening ? "停止实时语音识别" : isRecording ? "停止录音" : "实时语音输入"}
          aria-pressed={isListening || isRecording}
          onClick={() => void toggleVoiceInput()}
        >
          {isListening || isRecording ? <Square size={15} /> : <Mic size={16} />}
        </button>
        <button type="submit" title="发送">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

// 把图片文件读取为 data URL.
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// 停止指定媒体流内的所有轨道.
function stopMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

// 合并实时识别的最终文本和临时文本.
function mergeSpeechTranscript(...parts: string[]): string {
  return normalizeTranscript(parts.filter(Boolean).join(" "));
}
