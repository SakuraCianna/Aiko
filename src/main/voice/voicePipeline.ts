import type { SynthesizeStreamInput, VoiceProvider } from "./voiceTypes";

export function createMockVoiceProvider(): VoiceProvider {
  let cancelled = false;

  return {
    async *synthesizeStream(input: SynthesizeStreamInput) {
      cancelled = false;
      const encoded = new TextEncoder().encode(input.text);
      for (let index = 0; index < encoded.length; index += 16) {
        if (cancelled) return;
        yield encoded.slice(index, index + 16);
      }
    },
    cancel() {
      cancelled = true;
    }
  };
}
