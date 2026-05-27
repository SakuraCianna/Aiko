import type { ChatAttachment } from "../../shared/chatPayload";
import type { SpeechTranscriptDelta } from "../../shared/ipcTypes";

export type VoiceEmotion = "neutral" | "happy" | "serious" | "comfort" | "notice";

export type VoiceProfile = {
  id: string;
  name: string;
  provider: "mock" | "local-streaming" | "remote-streaming";
  referenceAudioPath?: string;
  speed: number;
  pitch: number;
  volume: number;
  streamingEnabled: boolean;
  lipSyncEnabled: boolean;
};

export type SynthesizeStreamInput = {
  text: string;
  voiceProfileId: string;
  emotion: VoiceEmotion;
  speed: number;
  format: "pcm" | "wav" | "mp3";
};

export type VoiceProvider = {
  synthesizeStream: (input: SynthesizeStreamInput) => AsyncIterable<Uint8Array>;
  cancel: () => void;
};

export type SpeechSynthesisInput = {
  text: string;
  voiceProfileId?: string;
  emotion?: VoiceEmotion;
  speed?: number;
  format?: "wav" | "mp3";
};

export type SpeechSynthesisResult =
  | {
      ok: true;
      dataUrl: string;
      mimeType: string;
    }
  | {
      ok: false;
      message: string;
    };

export type SpeechSynthesisProvider = {
  synthesize: (input: SpeechSynthesisInput) => Promise<SpeechSynthesisResult>;
};

export type SpeechUnderstandingInput = {
  attachments: ChatAttachment[];
};

export type SpeechUnderstandingResult = {
  attachmentId: string;
  transcript: string;
  confidence?: number;
  language?: string;
  error?: string;
};

export type SpeechUnderstandingProvider = {
  understand: (input: SpeechUnderstandingInput) => Promise<SpeechUnderstandingResult[]>;
};

export type SpeechStreamStartInput = {
  sessionId: string;
  sampleRate: number;
  frameMs: number;
  onTranscript?: (delta: SpeechTranscriptDelta) => void;
};

export type SpeechStreamChunkInput = {
  sessionId: string;
  sequence: number;
  sampleRate: number;
  pcm: Buffer;
  isFinal?: boolean;
};

export type SpeechStreamFinishInput = {
  sessionId: string;
};

export type SpeechStreamFinishResult = {
  transcript: string;
  confidence?: number;
  language?: string;
  error?: string;
};

export type SpeechStreamingProvider = {
  start: (input: SpeechStreamStartInput) => Promise<void>;
  pushChunk: (input: SpeechStreamChunkInput) => Promise<void>;
  finish: (input: SpeechStreamFinishInput) => Promise<SpeechStreamFinishResult>;
  cancel: (input: SpeechStreamFinishInput) => Promise<void>;
};
