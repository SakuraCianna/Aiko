import { ChangeEvent, FormEvent, useRef, useState } from "react";
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 提交当前文本和附件.
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    void onSubmit({ text: trimmed, attachments });
    setValue("");
    setAttachments([]);
    setError("");
  }

  // 校验并读取用户选择的图片文件.
  async function handleImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    setError("");

    if (attachments.length + selectedFiles.length > MAX_ATTACHMENTS) {
      setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return;
    }

    const nextAttachments: ChatAttachment[] = [];
    for (const file of selectedFiles) {
      if (!isImageMimeType(file.type)) {
        setError("只支持 PNG,JPEG,WebP,GIF 图片.");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        setError("单张图片不能超过 5 MB.");
        return;
      }

      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: "image",
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: await readAsDataUrl(file)
      });
    }

    setAttachments((current) => [...current, ...nextAttachments]);
  }

  // 开始或停止默认麦克风录音.
  async function toggleRecording() {
    setError("");

    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }

    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(`最多只能同时上传 ${MAX_ATTACHMENTS} 个附件.`);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前环境无法调用麦克风录音.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = selectSupportedAudioMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordingChunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        void finishRecording();
      });

      recorder.start();
      setIsRecording(true);
    } catch {
      stopMicrophoneStream();
      setIsRecording(false);
      setError("无法访问默认麦克风,请检查 Windows 麦克风权限.");
    }
  }

  // 停止录音后把音频片段转换成聊天附件.
  async function finishRecording() {
    const chunks = recordingChunksRef.current;
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    recorderRef.current = null;
    recordingChunksRef.current = [];
    stopMicrophoneStream();
    setIsRecording(false);

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
    setAttachments((current) => [...current, attachment]);
  }

  // 停止麦克风流, 释放系统录音资源.
  function stopMicrophoneStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // 从待发送列表中移除指定附件.
  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  return (
    <div className="command-shell">
      {attachments.length > 0 && (
        <div className="attachment-strip" aria-label="已选择的附件">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="attachment-chip">
              {attachment.kind === "image" ? "图片" : "语音"} · {attachment.name}
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
          title={isRecording ? "停止录音" : "使用默认麦克风录音"}
          aria-pressed={isRecording}
          onClick={() => void toggleRecording()}
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
