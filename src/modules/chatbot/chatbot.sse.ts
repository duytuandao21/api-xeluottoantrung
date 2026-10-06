// Streaming decoder handles UTF-8 split across chunks, CRLF and multiline data.
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (pending.length + data.join('\n').length > 131072) throw new Error('Upstream SSE event too large');
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (!line) { if (data.length) { yield data.join('\n'); data = []; } }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (chunk.done) {
        if (pending.startsWith('data:')) data.push(pending.slice(5).replace(/^ /, '').replace(/\r$/, ''));
        if (data.length) yield data.join('\n');
        return;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
