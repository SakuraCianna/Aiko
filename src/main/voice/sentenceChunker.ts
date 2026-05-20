export function chunkForSpeech(text: string): string[] {
  const chunks: string[] = [];
  let buffer = "";

  for (const char of text) {
    buffer += char;
    if ("。！？!?".includes(char)) {
      const chunk = buffer.trim();
      if (chunk.length > 0) chunks.push(chunk);
      buffer = "";
    }
  }

  return chunks;
}
