'use strict';

/* WAV, read by its header and written by hand.
 *
 * A voiced take is cut from clips a voice engine wrote, and where each
 * step begins in it is the sum of the clips before. Summed from what
 * ffmpeg says a file lasts, the error is ten milliseconds a clip and it
 * adds up over a deck; summed from the frame counts in the clips' own
 * headers, it is exact. So the header is read, chunk by chunk as the
 * format lays it out, never at fixed offsets: an engine may put a LIST or
 * a fact chunk before the data, and one that does is still a WAV.
 *
 * Read strictly, too. An engine killed while it was writing leaves a file
 * whose header promises more audio than the file holds, or a data chunk
 * that stops part way through a frame; either is refused here, so a clip
 * cut short can never pass for one that is complete.
 */

const fs = require('fs');

/* The two sample formats a voice engine writes in practice. Extensible
   (0xFFFE) says which of them it is in the first two bytes of its
   SubFormat GUID. */
const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/** What a WAV file holds: `{ format, rate, channels, bits, frames,
 *  seconds, dataOffset, dataBytes }`, `format` being `pcm` or `float`.
 *  Anything that is not a whole RIFF/WAVE file of PCM or IEEE float is
 *  refused, and the refusal says what the file was instead. */
function readWav(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (at, n) => {
      const buf = Buffer.alloc(n);
      const got = fs.readSync(fd, buf, 0, n, at);
      return buf.subarray(0, got);
    };
    const head = read(0, 12);
    if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
      const said = head.toString('latin1', 0, Math.min(4, head.length));
      throw new Error(`${file} is not a WAV file: it begins ${JSON.stringify(said)}` +
        (head.length < 12 ? `, and is ${size} bytes long` : ', not "RIFF....WAVE"'));
    }
    let fmt = null;
    let at = 12;
    while (at + 8 <= size) {
      const h = read(at, 8);
      const id = h.toString('latin1', 0, 4);
      const len = h.readUInt32LE(4);
      const body = at + 8;
      if (id === 'fmt ') {
        if (len < 16) throw new Error(`${file} has a fmt chunk of ${len} bytes, too short to say its format`);
        const f = read(body, Math.min(len, 40));
        let tag = f.readUInt16LE(0);
        if (tag === EXTENSIBLE && f.length >= 26) tag = f.readUInt16LE(24);
        fmt = { tag, channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), align: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
      } else if (id === 'data') {
        if (!fmt) throw new Error(`${file} has its data before its fmt chunk, so nothing says how to read it`);
        if (fmt.tag !== PCM && fmt.tag !== FLOAT) {
          throw new Error(`${file} is a WAV of format ${fmt.tag}; only PCM (1) and IEEE float (3) are read`);
        }
        if (!fmt.channels || !fmt.rate || fmt.align !== fmt.channels * (fmt.bits / 8)) {
          throw new Error(`${file} says ${fmt.channels} channels at ${fmt.rate} Hz, ${fmt.bits} bits, ` +
            `in frames of ${fmt.align} bytes, which do not agree`);
        }
        /* A WAV written through a pipe, by ffmpeg or sox writing to stdout,
           cannot go back to fill in its sizes, and leaves the data chunk's
           as 0xFFFFFFFF or 0, meaning unknown. Such a file may be whole,
           and may as well have been cut short, and nothing in it says which,
           so it is refused; but by what it is, or an engine that pipes its
           clips would be sent looking for a crash that never happened. */
        if (len === 0xffffffff || (len === 0 && size > body)) {
          throw new Error(`${file} does not say how much audio it holds: its data chunk's size is ` +
            `${len ? '0xFFFFFFFF' : 0}, with ${size - body} bytes after it, as a WAV written through a pipe leaves it. ` +
            'Write it to the file itself, which lets the writer fill the size in');
        }
        /* The two ways a file written by a process that died gives itself
           away: a header written first, promising what never arrived, and
           a write that stopped mid-frame. */
        if (len > size - body) {
          throw new Error(`${file} is cut short: its data chunk promises ${len} bytes and the file holds ${size - body}`);
        }
        if (len % fmt.align) {
          throw new Error(`${file} ends part way through a frame: ${len} bytes of data in frames of ${fmt.align}`);
        }
        const frames = len / fmt.align;
        return { format: fmt.tag === PCM ? 'pcm' : 'float', rate: fmt.rate, channels: fmt.channels, bits: fmt.bits,
                 frames, seconds: frames / fmt.rate, dataOffset: body, dataBytes: len };
      }
      at = body + len + (len % 2);     // a chunk of odd length is padded to even
    }
    throw new Error(`${file} has no data chunk${fmt ? '' : ', and no fmt chunk either'}`);
  } finally {
    fs.closeSync(fd);
  }
}

/** The 44 bytes that begin a plain 16-bit PCM WAV of `frames` frames. */
function wavHeader({ rate, channels = 1, frames }) {
  const align = channels * 2;
  const bytes = frames * align;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(PCM, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * align, 28);
  h.writeUInt16LE(align, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(bytes, 40);
  return h;
}

module.exports = { readWav, wavHeader };
