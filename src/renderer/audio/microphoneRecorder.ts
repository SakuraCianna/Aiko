import type { ChatAttachment } from "../../shared/chatPayload";

const AUDIO_MIME_CANDIDATES = ["audio/webm", "audio/ogg", "audio/mp4"];

export function selectSupportedAudioMimeType(isSupported: (mimeType: string) => boolean): string {
  return AUDIO_MIME_CANDIDATES.find(isSupported) ?? "";
}

export function createRecordedAudioName(now = new Date()): string {
  return `aiko-voice-${now.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")}.webm`;
}

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read recorded audio"));
    reader.readAsDataURL(blob);
  });
}
