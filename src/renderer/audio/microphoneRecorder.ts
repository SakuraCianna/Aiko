import type { ChatAttachment } from "../../shared/chatPayload";

const AUDIO_MIME_CANDIDATES = ["audio/webm", "audio/ogg", "audio/mp4"];

// 从候选列表中选择当前浏览器支持的录音 MIME 类型.
export function selectSupportedAudioMimeType(isSupported: (mimeType: string) => boolean): string {
  return AUDIO_MIME_CANDIDATES.find(isSupported) ?? "";
}

// 根据当前时间生成稳定的录音文件名.
export function createRecordedAudioName(now = new Date()): string {
  return `aiko-voice-${now.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")}.webm`;
}

// 把录音 Blob 转换成聊天附件.
export async function createAudioAttachmentFromBlob(blob: Blob, now = new Date()): Promise<ChatAttachment> {
  return {
    id: crypto.randomUUID(),
    kind: "audio",
    name: createRecordedAudioName(now),
    mimeType: blob.type || "audio/webm",
    size: blob.size,
    dataUrl: await blobToDataUrl(blob)
  };
}

// 把 Blob 读取为 data URL, 供多模态 payload 传输.
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read recorded audio"));
    reader.readAsDataURL(blob);
  });
}
