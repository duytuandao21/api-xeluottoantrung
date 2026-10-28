import { Transform, type Readable } from 'node:stream';

/** Bound actual bytes, not a client declaration. Never buffer the whole MP3. */
export function boundedTVAudio(source: Readable, expected: number) {
  let count = 0;
  let prefix = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      count += chunk.length;
      if (count > expected) return done(new Error('File nhạc vượt dung lượng đã đăng ký.'));
      if (prefix.length < 3) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 3 - prefix.length)]);
        if (prefix.length >= 3 && prefix.toString('ascii', 0, 3) !== 'ID3' &&
          !(prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0)) return done(new Error('File không có định dạng MP3 hợp lệ.'));
      }
      done(null, chunk);
    },
    flush(done) { done(count === expected && prefix.length >= 3 ? undefined : new Error('File nhạc chưa được tải đủ.')); },
  });
  const failed = (error: Error) => stream.destroy(error);
  // SDK middleware can attach its reader asynchronously. Preserve stream.errored
  // for that reader without letting an early invalid body become an unhandled event.
  stream.on('error', () => {});
  source.on('error', failed);
  stream.once('close', () => { source.off('error', failed); source.unpipe(stream); if (!source.readableEnded && !source.destroyed) source.destroy(); });
  source.pipe(stream);
  return stream;
}
