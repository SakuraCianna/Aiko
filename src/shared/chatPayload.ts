import { z } from "zod";

export const MAX_CHAT_TEXT_LENGTH = 4000;
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const imageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const audioMimeTypes = ["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4"] as const;

export type ChatAttachmentKind = "image" | "audio";

export type ChatAttachment = {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type ChatPayload = {
  text: string;
  attachments: ChatAttachment[];
};

const attachmentSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(["image", "audio"]),
    name: z.string().min(1).max(180),
    mimeType: z.string().min(1).max(80),
    size: z.number().int().positive(),
    dataUrl: z.string().min(1)
  })
  .superRefine((attachment, ctx) => {
    const allowedMimeTypes = attachment.kind === "image" ? imageMimeTypes : audioMimeTypes;
    const maxBytes = attachment.kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;

    if (!allowedMimeTypes.includes(attachment.mimeType as never)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported ${attachment.kind} MIME type`
      });
    }

    if (attachment.size > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${attachment.kind} attachment is too large`
      });
    }

    if (!attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attachment data URL does not match MIME type"
      });
      return;
    }

    const actualBytes = decodedBase64ByteLength(attachment.dataUrl.slice(`data:${attachment.mimeType};base64,`.length));
    if (actualBytes === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attachment data URL is not valid base64"
      });
      return;
    }

    if (actualBytes > maxBytes || actualBytes !== attachment.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attachment size does not match encoded content"
      });
    }
  });

export const chatPayloadSchema = z
  .object({
    text: z.string().max(MAX_CHAT_TEXT_LENGTH),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS)
  })
  .superRefine((payload, ctx) => {
    if (payload.text.trim().length === 0 && payload.attachments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message must include text or an attachment"
      });
    }
  });

export function validateChatPayload(input: unknown): ChatPayload {
  const payload = chatPayloadSchema.parse(input);
  return {
    text: payload.text.trim(),
    attachments: payload.attachments
  };
}

export function isImageMimeType(mimeType: string): boolean {
  return (imageMimeTypes as readonly string[]).includes(mimeType);
}

export function isAudioMimeType(mimeType: string): boolean {
  return (audioMimeTypes as readonly string[]).includes(mimeType);
}

function decodedBase64ByteLength(base64: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}
