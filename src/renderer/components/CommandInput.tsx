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
import { createAudioAttachmentFromBlob, createWavAudioRecorder, type WavAudioRecorder } from "../audio/microphoneRecorder";
import { createStreamingAsrController, type StreamingAsrController } from "../audio/streamingAsrController";

type CommandInputProps = {
  onSubmit: (payload: ChatPayload) => void | Promise<void>;
};

// 渲染桌宠底部输入框, 负责文本, 图片和麦克风录音入口.
export function CommandInput({ onSubmit }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<WavAudioRecorder | null>(null);
  const streamingAsrRef = useRef<StreamingAsrController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const recordingSessionRef = useRef<string | null>(null);
  const recordingModeRef = useRef<"streaming" | "attachment" | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanupRecording();
    };
  }, []);

  useEffect(() => {
    // 接收实时 ASR partial/final 转写, 真实 WebSocket provider 接入后会边说边更新输入框.
    return window.aiko.onSpeechTranscriptDelta((delta) => {
      if (!mountedRef.current || delta.sessionId !== recordingSessionRef.current) return;
      const transcript = delta.text.trim();
      if (transcript.length === 0) return;
      setValue(transcript);
    });
  }, []);

  // 提交当前文本和附件.
  function submit(event: ReactSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    submitPayload(value);
  }

  // 统一提交聊天 payload, 保证语音识别和手动输入使用同一条路径.
  function submitPayload(text: string, overrideAttachments: ChatAttachment[] = attachmentsRef.current) {
    const trimmed = text.trim();
    const currentAttachments = overrideAttachments;
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

  // 切换语音输入, 优先走流式 ASR, 不可用时降级为 WAV 附件提交.
  async function toggleVoiceInput() {
    setError("");

    if (recordingSessionRef.current) {
      void finishRecording(recordingSessionRef.current);
      return;
    }

    await startStreamingVoiceInput();
  }

  // 开始麦克风流式转写, renderer 会边录边把 PCM16 分片推给主进程.
  async function startStreamingVoiceInput() {
    if (!navigator.mediaDevices?.getUserMedia) {
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

      streamRef.current = stream;
      const streamingController = createStreamingAsrController({
        api: window.aiko,
        createRecorder: createWavAudioRecorder,
        createSessionId: () => sessionId
      });
      const startResult = await streamingController.start(stream);
      if (!mountedRef.current || recordingSessionRef.current !== sessionId) {
        void streamingController.cancel();
        stopMicrophoneStream();
        return;
      }

      if (startResult.ok) {
        streamingAsrRef.current = streamingController;
        recordingModeRef.current = "streaming";
        return;
      }

      const fallbackStarted = await startAudioAttachmentRecordingFromStream(stream, sessionId);
      if (fallbackStarted && mountedRef.current) setError("实时语音暂时不可用, 已切换为录音片段提交.");
    } catch {
      if (recordingSessionRef.current !== sessionId) return;
      cleanupRecording();
      if (mountedRef.current) setError("无法访问默认麦克风, 请检查 Windows 麦克风权限.");
    }
  }

  // 当流式 ASR 不可用时复用同一个麦克风流, 回退成原有 WAV 附件链路.
  async function startAudioAttachmentRecordingFromStream(stream: MediaStream, sessionId: string): Promise<boolean> {
    if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
      cleanupRecording();
      if (mountedRef.current) setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return false;
    }

    const recorder = await createWavAudioRecorder(stream);
    if (!mountedRef.current || recordingSessionRef.current !== sessionId) {
      void recorder.stop();
      stopMicrophoneStream();
      return false;
    }
    recorderRef.current = recorder;
    recordingModeRef.current = "attachment";
    return true;
  }

  // 停止录音后把音频片段转换成聊天附件.
  async function finishRecording(sessionId: string) {
    if (recordingSessionRef.current !== sessionId) return;

    const mode = recordingModeRef.current;
    const recorder = recorderRef.current;
    const streamingController = streamingAsrRef.current;
    recordingSessionRef.current = null;
    recordingModeRef.current = null;
    recorderRef.current = null;
    streamingAsrRef.current = null;
    if (mountedRef.current) setIsRecording(false);

    if (!mountedRef.current) return;

    if (mode === "streaming" && streamingController) {
      try {
        const result = await streamingController.stop();
        stopMicrophoneStream();
        if (!mountedRef.current) return;
        if (!result.ok) {
          setError(`语音转写失败: ${result.message}`);
          return;
        }
        submitVoiceTranscript(result.transcript);
      } catch (error) {
        stopMicrophoneStream();
        if (mountedRef.current) {
          setError(error instanceof Error ? `语音转写失败: ${error.message}` : "语音转写失败.");
        }
      }
      return;
    }

    stopMicrophoneStream();
    if (!recorder) {
      setError("没有录到有效语音.");
      return;
    }

    const blob = await recorder.stop();
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("单段语音不能超过 15 MB.");
      return;
    }

    const attachment = await createAudioAttachmentFromBlob(blob);
    if (!mountedRef.current) return;
    submitPayload(value, [...attachmentsRef.current, attachment]);
  }

  // 把最终转写和用户手动输入合并后发送, 让语音入口进入同一条 Agent 链路.
  function submitVoiceTranscript(transcript: string) {
    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript) {
      setError("没有识别到有效语音.");
      return;
    }

    const mergedText = [value.trim(), normalizedTranscript].filter(Boolean).join("\n");
    submitPayload(mergedText);
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
    recordingModeRef.current = null;
    const recorder = recorderRef.current;
    const streamingController = streamingAsrRef.current;
    recorderRef.current = null;
    streamingAsrRef.current = null;
    if (recorder) void recorder.stop();
    if (streamingController) void streamingController.cancel();
    stopMicrophoneStream();
    if (mountedRef.current) setIsRecording(false);
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
          className={isRecording ? "recording-button" : undefined}
          title={isRecording ? "停止录音" : "语音输入"}
          aria-pressed={isRecording}
          onClick={() => void toggleVoiceInput()}
        >
          {isRecording ? <Square size={15} /> : <Mic size={16} />}
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
