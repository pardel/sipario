'use strict';

/* The talk, read aloud in the speaker's own voice: every step's script
 * spoken by a local voice engine (lib/tts.js) cloned from a few seconds
 * of a live take, into a take of its own that `export video` makes a
 * video of like any other.
 *
 * Only the speaker's own voice is cloned, and only from what they
 * recorded themselves: the sample is cut from a live take of this deck,
 * never a voiced one (a clone of a clone drifts further from the voice
 * with every generation, and it is not a recording of anybody), never a
 * file handed in from elsewhere.
 *
 *   sample   ten seconds of speech from the latest live take, or the one
 *            named, found by ffmpeg's silencedetect: the first stretch
 *            of ten seconds with no pause of a second or more in it.
 *            Chatterbox listens to the first ten seconds of a sample and
 *            no more. Natural speech pauses for breath every few seconds,
 *            so a stretch is broken only by a pause longer than one; the
 *            longest stretch serves if none runs ten, down to five, below
 *            which a sample is too thin to clone from and is refused.
 *   steps    in the deck's order. A step with a script is voiced; one
 *            with none is never sent to the engine and is held silent
 *            for `hold` seconds (Paul's call, 2026-10-03), so every step,
 *            a flash included, is in the take. A script that directs the
 *            voice (lib/ssml.js) is spoken as its pieces: each run of text
 *            one request, a pause exact silence, an expletive a tone, and
 *            a piece's volume, rate and pitch put on by ffmpeg once the
 *            clip is made, so changing them never asks the engine again.
 *            A script without directions is one request, as it always was.
 *   clips    kept in $SIPARIO_DATA/voice/<deck>/, named by a hash of
 *            everything the engine said of itself when it was ready, the
 *            sample's bytes and the script, and its language when it has
 *            one (none: the hash is the one it always was). A run that dies part way
 *            leaves every clip it finished, and the next run picks up from
 *            there; so will re-voicing a step later. A newer live take is
 *            a new sample, and every step is voiced again in it.
 *   the take a new one, always, beside the live takes: `voice.wav`, the
 *            sample it was cloned from, and `take.json` written last.
 *            The live take is read and never written.
 *
 * Where each step begins is counted in frames from the clips' own WAV
 * headers (lib/wav.js), not timed by ffmpeg, which rounds to ten
 * milliseconds a clip and drifts over a deck.
 *
 * The take's `take.json` is a live take's (lib/record.js), with `kind:
 * 'voiced'`, `source` the live take the voice came from, and a `voice`
 * block saying how it was made. Its marks carry a version `v` and its
 * `notes` the script of every step at that version, as a live take's do,
 * so a mark's script is `notes[mark.v][mark.id]` whichever kind of take
 * it is. A live take's version is the server's reload token, a number; a
 * voiced take's is `deck:` and the first twelve hex digits of the
 * SHA-256 of the deck.md it was read from, which can never be mistaken
 * for one, and is the same for every run over the same draft.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { talk } = require('./talk.js');
const { identity } = require('./render.js');
const { outline } = require('./export.js');
const { dataDir } = require('./results.js');
const { findFfmpeg, ffmpeg, takesDir, listTakes, readTake } = require('./video.js');
const { nameTake } = require('./record.js');
const { sessionId } = require('./relay.js');
const { findTts, startEngine, clip } = require('./tts.js');
const { readWav, wavHeader } = require('./wav.js');
const ssml = require('./ssml.js');

/* The take's audio: one format for every clip, whatever each engine
   wrote. 24 kHz mono is Chatterbox's own, so its clips go in untouched. */
const RATE = 24000;

/* What counts as speech in a live take. -35 dB is quieter than a voice
   and louder than a quiet room; the pause is the shortest gap that ends a
   stretch, and is a second because Paul's own take of the robot deck
   pauses for half a second every few seconds of speech and has no
   stretch of ten without one (measured 2026-10-03: at 0.4 s its longest
   ran 5.8 s; at 1 s its first of ten began at 3:23). */
const SPEECH = { noise: '-35dB', pause: 1, want: 10, least: 5 };

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const sha = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
/* A moment as m:ss.s, rounded to the tenth before it is split, or 239.97 s
   would be 3:60.0. */
const clock = (s) => {
  const t = Math.round(s * 10) / 10;
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};

/** The live take a voice is cloned from: the one named, or the latest.
 *  A voiced take is refused by name: only a recording of the speaker is
 *  a sample of the speaker. */
function liveTake(key, from, root) {
  if (from) {
    const t = readTake(key, from, root);
    if ((t.kind || 'live') !== 'live') {
      const by = t.voice && t.voice.engine ? `, spoken by ${t.voice.engine}` : '';
      throw new Error(`take ${from} is ${t.kind}${by}: a voice is cloned only from a live take, ` +
        'the speaker\'s own recording, never from a voice already cloned');
    }
    return t;
  }
  const ids = listTakes(key, root);
  for (let i = ids.length - 1; i >= 0; i--) {
    let kind;
    try { kind = JSON.parse(fs.readFileSync(path.join(takesDir(key, root), ids[i], 'take.json'), 'utf8')).kind; } catch { continue; }
    if ((kind || 'live') === 'live') return readTake(key, ids[i], root);
  }
  throw new Error(`no live take of this deck is kept in ${takesDir(key, root)}` +
    `${ids.length ? ` (${ids.length} voiced)` : ''}, and the voice is cloned from one: ` +
    'record a take with V in the notes\' own window first.');
}

/** Where in a recording someone is speaking: `[{ start, end }]`, from
 *  ffmpeg's silencedetect, each stretch ended by a pause of `pause`
 *  seconds or more. */
function speech(file, ff, { noise = SPEECH.noise, pause = SPEECH.pause } = {}) {
  const r = ffmpeg(ff, ['-i', file, '-vn', '-af', `silencedetect=noise=${noise}:d=${pause}`, '-f', 'null', '-']);
  const err = String(r.stderr);
  const times = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (r.status !== 0 || !times.length) throw new Error(`ffmpeg could not read ${file}: ${err.trim().split('\n').pop()}`);
  const [, h, m, s] = times[times.length - 1];
  const end = Number(h) * 3600 + Number(m) * 60 + Number(s);
  const quiet = [];
  for (const x of err.matchAll(/silence_(start|end): (-?\d+(?:\.\d+)?)/g)) {
    if (x[1] === 'start') quiet.push([Math.max(0, Number(x[2])), end]);
    else if (quiet.length) quiet[quiet.length - 1][1] = Number(x[2]);
  }
  const out = [];
  let at = 0;
  for (const [a, b] of quiet) { if (a > at) out.push({ start: at, end: a }); at = Math.max(at, b); }
  if (end > at) out.push({ start: at, end });
  return out;
}

/** The sample: ten seconds of the take's speech cut to a 24 kHz mono WAV
 *  at `out`. Returns `{ offset, length }` in seconds, the length read off
 *  the WAV that was cut. */
function cutSample(take, ff, out) {
  if (!isFile(take.audioFile)) throw new Error(`take ${take.take} has lost its audio, ${take.audioFile}`);
  const found = speech(take.audioFile, ff);
  const longest = found.reduce((a, s) => (!a || s.end - s.start > a.end - a.start ? s : a), null);
  const first = found.find((s) => s.end - s.start >= SPEECH.want);
  const pick = first || longest;
  if (!pick || pick.end - pick.start < SPEECH.least) {
    throw new Error(`take ${take.take} has no ${SPEECH.least}s of speech to clone a voice from: ` + (longest
      ? `its longest stretch without a pause of ${SPEECH.pause}s runs ${(longest.end - longest.start).toFixed(1)}s, at ${clock(longest.start)}`
      : `ffmpeg heard nothing louder than ${SPEECH.noise} in it`) +
      '. Record a take that talks for ten seconds at a stretch, or name one with --from.');
  }
  const offset = Math.round(pick.start * 1000) / 1000;
  const length = Math.min(SPEECH.want, Math.floor((pick.end - offset) * 1000) / 1000);
  /* Bit-exact and without metadata, so the same take cuts to the same
     bytes every run, and the clips cached under them are found again. */
  const r = ffmpeg(ff, ['-y', '-ss', String(offset), '-i', take.audioFile, '-t', String(length),
    '-vn', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', out]);
  if (r.status !== 0) throw new Error(`ffmpeg could not cut the sample: ${String(r.stderr).trim().split('\n').pop()}`);
  return { offset, length: readWav(out).seconds };
}

/* A clip in the take's format: as it is when it is already, else made so
   by ffmpeg into `work`. Returns the file and what it holds. */
function normal(file, ff, work, n) {
  const info = readWav(file);
  if (info.format === 'pcm' && info.bits === 16 && info.channels === 1 && info.rate === RATE) return { file, info };
  const to = path.join(work, `${n}.wav`);
  const r = ffmpeg(ff, ['-y', '-i', file, '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le',
    '-map_metadata', '-1', '-fflags', '+bitexact', to]);
  if (r.status !== 0) throw new Error(`ffmpeg could not convert ${file}: ${String(r.stderr).trim().split('\n').pop()}`);
  return { file: to, info: readWav(to) };
}

/* A tempo factor as atempo filters, each between a half and two, where
   it sounds least changed. */
function atempo(x) {
  const out = [];
  let f = x;
  while (f < 0.5) { out.push('atempo=0.5'); f /= 0.5; }
  while (f > 2) { out.push('atempo=2'); f /= 2; }
  if (Math.abs(f - 1) > 1e-9) out.push(`atempo=${f.toFixed(6)}`);
  return out;
}

/* Gain past 0 dB is held under -1 dBFS by a limiter that keeps every
   frame where it was (latency=true): clips arrive levelled with peaks
   near full scale, and a louder piece would otherwise clip. */
const LIMIT = 0.891;

/** A piece of a script directed to sound otherwise: the clip at `file`
 *  made `rate` times as fast, `pitch` semitones higher or lower and
 *  `volume` dB louder or softer, into `work`, in the take's format.
 *
 *  There is no rubberband in the ffmpeg this runs on, so pitch is the
 *  old way: the clip played faster or slower (asetrate), which moves its
 *  pitch and its length together, then brought back to its length by
 *  atempo. The voice is resampled once and time-stretched once, and a
 *  shift of more than a few semitones is heard as processed. atempo
 *  drops the last few milliseconds of what it is given, so the clip is
 *  padded with silence first and cut to exactly its new length after:
 *  `rate` 0.75 makes a piece of N frames exactly round(N / 0.75). */
function shape(file, v, ff, work, n) {
  const info = readWav(file);
  const frames = Math.round(info.frames * RATE / info.rate);
  const f = [`aresample=${RATE}`];
  let tempo = v.rate || 1;
  if (v.pitch) {
    const to = Math.round(RATE * 2 ** (v.pitch / 12));
    f.push(`asetrate=${to}`, `aresample=${RATE}`);
    tempo /= to / RATE;
  }
  const want = Math.round(frames / (v.rate || 1));
  const stretch = atempo(tempo);
  if (stretch.length) f.push(`apad=pad_len=${RATE}`, ...stretch, `atrim=end_sample=${want}`);
  if (v.volume === -Infinity) f.push('volume=0');
  else if (v.volume) f.push(`volume=${v.volume}dB`, ...(v.volume > 0 ? [`alimiter=limit=${LIMIT}:level=false:latency=true`] : []));
  const to = path.join(work, `${n}.wav`);
  const r = ffmpeg(ff, ['-y', '-i', file, '-af', f.join(','), '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le',
    '-map_metadata', '-1', '-fflags', '+bitexact', to]);
  if (r.status !== 0) throw new Error(`ffmpeg could not shape ${file}: ${String(r.stderr).trim().split('\n').pop()}`);
  return { file: to, info: readWav(to) };
}

/* A bleep for an expletive: a 1 kHz tone at about the level of speech
   (-20 dBFS), faded in and out over five milliseconds so it starts and
   stops without a click, exactly `frames` long. */
function tone(frames) {
  const buf = Buffer.alloc(frames * 2);
  const fade = Math.round(RATE * 0.005);
  for (let i = 0; i < frames; i++) {
    const edge = Math.min(1, i / fade, (frames - 1 - i) / fade);
    buf.writeInt16LE(Math.round(3277 * edge * Math.sin(2 * Math.PI * 1000 * i / RATE)), i * 2);
  }
  return buf;
}

const shaped = (v) => v.volume !== undefined || v.rate !== undefined || v.pitch !== undefined;

/** Voice a talk: a new take of the deck read by the engine in the voice
 *  of one of its live takes. Returns `{ take, dir, length, steps, engine,
 *  source, sample, synthetic, held, made, cached }`, `made` and `cached`
 *  counting clips, of which a step directing the voice may have several.
 *  Progress goes to `log`, a step a line. */
async function voice(dir, { from = null, hold = 2, root = dataDir(), env = process.env,
                            log = process.stderr, readyTimeout } = {}) {
  if (typeof hold !== 'number' || !Number.isFinite(hold) || hold <= 0) {
    throw new Error(`hold is ${JSON.stringify(hold)}: it is the seconds a step with no script is held silent, a number above 0`);
  }
  const ff = findFfmpeg(env);
  const bin = findTts(env);
  const t = talk(dir);
  const src = fs.readFileSync(t.deck, 'utf8');
  const deck = identity(src);
  const steps = outline(src, t);
  const v = `deck:${sha(src).slice(0, 12)}`;
  const live = liveTake(deck.key, from, root);
  const say = (line) => { if (log) log.write(`${line}\n`); };

  /* Ctrl-C or SIGTERM once the engine is up stops the run and leaves no
     take, whether the engine is speaking (lib/tts.js hears it then),
     letting go of its model, or gone and the take being put together. That
     last part waits on nothing, and a signal is heard only when this
     process waits, so it waits a moment before each part and before the
     take is made a take, to hear one. Without a listener here, a signal
     then would end the process on the spot, half a voice.wav left in a
     folder nothing lists. */
  const signals = ['SIGINT', 'SIGTERM'];
  let stopped = null;
  const onSignal = (sig) => { stopped = sig; };
  const heed = async () => {
    await new Promise((r) => setImmediate(r));
    if (stopped) throw new Error(`stopped by ${stopped}`);
  };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-voice-'));
  try {
    const sampleFile = path.join(work, 'sample.wav');
    const sample = { take: live.take, ...cutSample(live, ff, sampleFile) };
    const sampleBytes = fs.readFileSync(sampleFile);
    say(`[voice] the voice of take ${live.take}: ${sample.length.toFixed(1)}s from ${clock(sample.offset)}`);

    const cache = path.join(root, 'voice', String(deck.key).replace(/^sipario:/, ''));
    fs.mkdirSync(cache, { recursive: true });
    say(`[voice] starting ${bin}`);
    const engine = await startEngine(bin, { env, log, ...(readyTimeout ? { readyTimeout } : {}) });
    for (const sg of signals) process.on(sg, onSignal);
    const ready = engine.ready;
    const name = typeof ready.engine === 'string' && ready.engine ? ready.engine : path.basename(bin);
    /* A clip is cached under the whole of the ready line, not the engine's
       name alone: the same name upgraded, or set to another device or
       other settings, makes another voice, and a take that mixed the two
       while its record named one would say what is not so. With the whole
       line in the key, every clip a take is made of was made by the engine
       its take.json names. The name, or the executable's, is in it too, for
       an engine that says nothing but that it is ready. */
    const self = JSON.stringify(ready);

    /* Every clip first, then the take: a run that stops on a step leaves
       no take behind, and every clip it finished is kept for the next. */
    const parts = [];
    let made = 0;
    let found = 0;
    try {
      for (const [i, s] of steps.entries()) {
        const at = `${i + 1}/${steps.length} ${s.id}`;
        const items = ssml.speech(s.script);
        if (!items.length) {
          parts.push({ id: s.id, pieces: null });
          say(`[voice] ${at}: no script, held ${hold}s`);
          continue;
        }
        /* Each run of text is one request and one clip, every one under
           the step's id. Its language joins the hash only when it has
           one, so a script with no directions finds the clip it always
           had. */
        const pieces = [];
        let secs = 0;
        let fresh = 0;
        const began = Date.now();
        for (const it of items) {
          if (it.text === undefined) { pieces.push(it); continue; }
          const key = it.language ? sha(name, self, sampleBytes, it.text, it.language) : sha(name, self, sampleBytes, it.text);
          const file = path.join(cache, `${key}.wav`);
          if (isFile(file)) {
            secs += readWav(file).seconds;
            found += 1;
          } else {
            const info = await clip(engine, { id: s.id, text: it.text, sample: sampleFile, out: file, language: it.language });
            secs += info.seconds;
            fresh += 1;
            made += 1;
          }
          pieces.push({ ...it, file });
        }
        const took = `${((Date.now() - began) / 1000).toFixed(1)}s`;
        const clips = pieces.filter((p) => p.file).length;
        if (items.length === 1 && clips === 1) say(`[voice] ${at}: ${secs.toFixed(2)}s, ${fresh ? `new in ${took}` : 'cached'}`);
        else {
          say(`[voice] ${at}: ${items.length} piece${items.length === 1 ? '' : 's'}, ${secs.toFixed(2)}s of speech in ${clips} clip${clips === 1 ? '' : 's'}` +
            ` (${fresh} new${fresh ? ` in ${took}` : ''}, ${clips - fresh} cached)`);
        }
        parts.push({ id: s.id, pieces });
      }
    } finally {
      await engine.close();
    }

    const takes = takesDir(deck.key, root);
    fs.mkdirSync(takes, { recursive: true });
    let id = nameTake(takes);
    while (fs.existsSync(path.join(takes, id))) id = sessionId();
    const into = path.join(takes, id);
    fs.mkdirSync(into);
    try {
      const audio = path.join(into, 'voice.wav');
      const fd = fs.openSync(audio, 'wx');
      const marks = [];
      let frames = 0;
      try {
        fs.writeSync(fd, wavHeader({ rate: RATE, frames: 0 }));
        let n = 0;
        for (const p of parts) {
          await heed();
          marks.push({ id: p.id, t: frames / RATE, v });
          if (!p.pieces) {
            const held = Math.round(hold * RATE);
            fs.writeSync(fd, Buffer.alloc(held * 2));
            frames += held;
            continue;
          }
          for (const it of p.pieces) {
            if (it.pause !== undefined || it.tone !== undefined) {
              const len = Math.round((it.pause !== undefined ? it.pause : it.tone) * RATE);
              fs.writeSync(fd, it.pause !== undefined ? Buffer.alloc(len * 2) : tone(len));
              frames += len;
              continue;
            }
            n += 1;
            const { file, info } = shaped(it) ? shape(it.file, it, ff, work, n) : normal(it.file, ff, work, n);
            const buf = fs.readFileSync(file);
            fs.writeSync(fd, buf, info.dataOffset, info.dataBytes);
            frames += info.frames;
          }
        }
        fs.writeSync(fd, wavHeader({ rate: RATE, frames }), 0, 44, 0);
      } finally {
        fs.closeSync(fd);
      }
      /* The marks were counted from the clips; the file is what the video
         is cut against. They agree, or every step after the first that
         disagrees would sit off its words. */
      const wrote = readWav(audio).frames;
      if (wrote !== frames) throw new Error(`voice.wav holds ${wrote} frames and the steps add up to ${frames}`);
      fs.copyFileSync(sampleFile, path.join(into, 'sample.wav'));

      const synthetic = parts.filter((p) => p.pieces && p.pieces.some((it) => it.file)).map((p) => p.id);
      const held = parts.filter((p) => !p.pieces).map((p) => p.id);
      const record = {
        version: 1,
        kind: 'voiced',
        source: live.take,
        audio: 'voice.wav',
        created: new Date().toISOString(),
        deck: deck.key,
        length: frames / RATE,
        marks,
        notes: { [v]: Object.fromEntries(steps.map((s) => [s.id, s.script])) },
        voice: { engine: name, ready, sample: { ...sample, file: 'sample.wav' }, synthetic, held, hold },
      };
      await heed();
      const json = path.join(into, 'take.json');
      fs.writeFileSync(`${json}.tmp`, JSON.stringify(record, null, 2) + '\n');
      fs.renameSync(`${json}.tmp`, json);
      return { take: id, dir: into, length: record.length, steps: steps.length, engine: name, source: live.take,
               sample, synthetic, held, made, cached: found };
    } catch (err) {
      /* A take this run began and could not finish is nobody's: it holds
         no take.json, so nothing would list it, and it would only sit
         there. The clips it was made from are kept. */
      fs.rmSync(into, { recursive: true, force: true });
      throw err;
    }
  } finally {
    for (const sg of signals) process.removeListener(sg, onSignal);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { voice, speech, cutSample, liveTake, clock, shape, tone, atempo, RATE, SPEECH };
