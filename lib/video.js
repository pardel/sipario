'use strict';

/* The talk, as a video: the deck's own steps, held on screen for as long
 * as the speaker held them, over the speaker's voice.
 *
 * A take is what a recording leaves behind: one audio file and the
 * moments the deck moved, `{ id, t }` per step shown, `t` in seconds from
 * the start of the audio. It is kept outside the talk, beside the room's
 * sessions and for the same reason: a talk folder is watched and
 * versioned, and a recording is neither its source nor a thing to commit.
 *
 *   $SIPARIO_DATA/takes/<deck>/<take>/take.json   (and its audio)
 *
 * The pictures are the export's photographs, taken by the same browser
 * off the same /print page, so the video cannot disagree with the room
 * any more than the PDF can. They are stills: the deck's slide motion is
 * not in the video, which is a photograph of each step, not a screen
 * recording of the window.
 *
 * The encoder is ffmpeg, borrowed from the machine the way the export
 * borrows a browser: sipario has no dependencies, and one that ships a
 * video codec would be a large first. `SIPARIO_FFMPEG` names a binary
 * when PATH would miss it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { talk } = require('./talk.js');
const { identity, slug } = require('./render.js');
const { onPaper, outline } = require('./export.js');
const { dataDir } = require('./results.js');

/* The video's frame rate, which a still's length is counted in. */
const FPS = 30;

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

function onPath(name, env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['.exe', ''] : ['']) {
      if (dir && isFile(path.join(dir, name + ext))) return path.join(dir, name + ext);
    }
  }
  return null;
}

/** The ffmpeg to encode with: SIPARIO_FFMPEG, or the one on PATH. Neither
 *  is an error that says how to get one. */
function findFfmpeg(env = process.env) {
  if (env.SIPARIO_FFMPEG) {
    const named = path.isAbsolute(env.SIPARIO_FFMPEG) ? env.SIPARIO_FFMPEG : onPath(env.SIPARIO_FFMPEG, env);
    if (named && isFile(named)) return named;
    throw new Error(`SIPARIO_FFMPEG is ${env.SIPARIO_FFMPEG}, which is not a file here`);
  }
  const found = onPath('ffmpeg', env);
  if (found) return found;
  throw new Error('no ffmpeg to make the video with. Install it (on a Mac, `brew install ffmpeg`), ' +
    'or set SIPARIO_FFMPEG to the binary of one that is installed.');
}

/* Run ffmpeg to the end and hand back what it said. Arguments as an
   array, never a shell line: a file name is the talk's, and a quote in
   one must stay a quote. */
function ffmpeg(bin, args) {
  const r = spawnSync(bin, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  return r;
}

/** How long a recording runs, in seconds, by decoding it to the end.
 *  A browser's recording is a stream that never wrote its length into
 *  the file, so a length read from the header would be missing there;
 *  the last timestamp of a full decode is there for every format. */
function durationOf(file, bin = findFfmpeg()) {
  const r = ffmpeg(bin, ['-i', file, '-vn', '-f', 'null', '-']);
  const times = [...String(r.stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (r.status !== 0 || !times.length) {
    throw new Error(`ffmpeg could not read ${file}: ${String(r.stderr).trim().split('\n').pop()}`);
  }
  const [, h, m, s] = times[times.length - 1];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// ------------------------------------------------------------- the takes

/* `key` is the deck's, `sipario:<slug>`; the folder is the slug, the same
   one the deck's sessions and bookmarks are kept under. */
const takesDir = (key, root = dataDir()) =>
  path.join(root, 'takes', String(key).replace(/^sipario:/, ''));

/** The takes kept for a deck, oldest first. A take is named for when it
 *  began, so the names sort by time. */
function listTakes(key, root = dataDir()) {
  const dir = takesDir(key, root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => isFile(path.join(dir, f, 'take.json'))).sort();
}

/* The takes a recording left without their take.json (lib/record.js).
   Never one to export, but a newer one than the take exported is most
   likely the one the speaker just made, and is worth a word. */
function unfinishedTakes(key, root) {
  const dir = takesDir(key, root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !isFile(path.join(dir, f, 'take.json')) &&
    isFile(path.join(dir, f, 'marks.partial.json'))).sort();
}

/** One take, read whole, with the path of its audio resolved. The latest
 *  unless one is named; then `unfinished` names the takes left unfinished
 *  since it, newest last, which were passed over. */
function readTake(key, which = null, root = dataDir()) {
  const takes = listTakes(key, root);
  const left = unfinishedTakes(key, root);
  if (!takes.length) {
    const last = left[left.length - 1];
    throw new Error(`no takes of this deck are kept in ${takesDir(key, root)}. ` + (last
      ? `Take ${last} was left unfinished: sipario takes recover ${last} finishes it.`
      : 'Record one from the notes window first.'));
  }
  const id = which || takes[takes.length - 1];
  if (!takes.includes(id)) {
    throw new Error(`there is no take "${id}"; the takes kept are ${takes.join(', ')}`);
  }
  const dir = path.join(takesDir(key, root), id);
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  if (!Array.isArray(take.marks) || !take.marks.length) throw new Error(`take ${id} has no steps in it`);
  if (!take.audio || take.audio !== path.basename(take.audio)) {
    throw new Error(`take ${id} names its audio as ${JSON.stringify(take.audio)}, not a file beside it`);
  }
  return { ...take, take: id, dir, audioFile: path.join(dir, take.audio),
           unfinished: which ? [] : left.filter((u) => u > id) };
}

// --------------------------------------------------------- the timeline

/** Where each mark sits on the audio: from its own moment to the next
 *  one's, the last running to the end. Whatever was said before the first
 *  press is said over the first step shown, so the video opens on a slide
 *  rather than on black. Marks are taken in time order; two at the same
 *  moment leave the first with no length, which `segments` can drop.
 *  Everything is clamped to the audio: a press after the recording
 *  stopped, a recorder that stops a beat before the last click lands,
 *  shows nothing, because there is no voice left to hold it for. */
function spans(marks, end) {
  const at = (t) => Math.min(Math.max(t, 0), end);
  const sorted = marks.slice().sort((a, b) => a.t - b.t);
  return sorted.map((m, i) => {
    const start = i === 0 ? 0 : at(m.t);
    const stop = i + 1 < sorted.length ? at(sorted[i + 1].t) : end;
    return { id: m.id, start, dur: Math.max(0, stop - start) };
  });
}

/** The spans the video is cut into. Every span that leaves this function
 *  is a still in the video, held for `dur` seconds; the durations must
 *  still add up to the audio's length, or the voice drifts off the
 *  slides it belongs to.
 *
 *  Every flash is kept: the video is what the room saw, and a quick double
 *  press through a build showed that step, however briefly (Paul's call,
 *  2026-10-03). Kept means seen, so each span is snapped to the video's
 *  frames and given one frame at the least; a frame rate drops a still
 *  shorter than a frame without a word. What a flash borrows comes out of
 *  the span after it, so the whole still ends where the audio does. Only
 *  a span of no length at all goes: two marks at one moment, or a press
 *  after the recording stopped, showed nothing. */
function segments(list, fps = FPS) {
  const kept = list.filter((s) => s.dur > 0);
  const total = Math.round(kept.reduce((a, s) => a + s.dur, 0) * fps);
  let at = 0;          // frames used so far
  let cum = 0;         // seconds the spans so far ran
  return kept.map((s, i) => {
    cum += s.dur;
    const left = kept.length - i - 1;
    /* At least a frame for this one, and room left for one for each
       after it; within that, the frame nearest where the span ended. */
    const end = i === kept.length - 1 ? total
      : Math.min(Math.max(Math.round(cum * fps), at + 1), total - left);
    const frames = Math.max(end - at, 1);
    at += frames;
    return { ...s, dur: frames / fps };
  });
}

/** The concat demuxer's list: a still and how long it stays. The last
 *  still is named twice, because the demuxer reads a duration as the gap
 *  to the next entry and would otherwise drop the last one's. */
function concatList(segs, fileOf) {
  const q = (f) => `'${String(f).replace(/'/g, "'\\''")}'`;
  const lines = ['ffconcat version 1.0'];
  for (const s of segs) lines.push(`file ${q(fileOf(s.id))}`, `duration ${s.dur.toFixed(3)}`);
  if (segs.length) lines.push(`file ${q(fileOf(segs[segs.length - 1].id))}`);
  return lines.join('\n') + '\n';
}

// ----------------------------------------------------------- the export

/** The talk as an .mp4 from a take: each step it showed, for as long as
 *  it showed it, over its audio. Returns `{ file, take, kind, source,
 *  duration, stills, steps, width, height, unfinished }`: `kind` is the
 *  take's own, `live` for a recording of the speaker and for a take that
 *  does not say, `source` the take another was made from, where it was,
 *  and `unfinished` the newer takes passed over (readTake). */
async function exportVideo(dir, { take: which = null, out = null, root = dataDir(), env = process.env } = {}) {
  const bin = findFfmpeg(env);
  const t = talk(dir);
  const src = fs.readFileSync(t.deck, 'utf8');
  const deck = identity(src);
  const take = readTake(deck.key, which, root);

  /* A take recorded against an earlier draft names steps by the ids that
     draft had. One the deck no longer has would be paired with no
     picture, or with whichever step took the id over; refused by name,
     so the speaker knows which part to record again. */
  const ids = new Set(outline(src, t).map((s) => s.id));
  const gone = [...new Set(take.marks.map((m) => m.id))].filter((id) => !ids.has(id));
  if (gone.length) {
    throw new Error(`take ${take.take} shows ${gone.join(', ')}, which the deck no longer has; ` +
      'record it again, or put the steps back');
  }
  if (!isFile(take.audioFile)) throw new Error(`take ${take.take} has lost its audio, ${take.audioFile}`);

  const duration = durationOf(take.audioFile, bin);
  const segs = segments(spans(take.marks, duration));
  const total = segs.reduce((a, s) => a + s.dur, 0);
  if (Math.abs(total - duration) > 1 / FPS) {
    throw new Error(`the stills add up to ${total.toFixed(2)}s and the audio runs ${duration.toFixed(2)}s, ` +
      'so the voice would drift off its slides; segments() must keep the total');
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-video-'));
  try {
    const wanted = new Set(segs.map((s) => s.id));
    const size = await onPaper(dir, async ({ page, slides, w, h }) => {
      for (const s of slides) {
        if (wanted.has(s.id)) fs.writeFileSync(path.join(work, `${s.id}.png`), await page.screenshot(s));
      }
      return { w, h };
    });

    fs.writeFileSync(path.join(work, 'stills.txt'), concatList(segs, (id) => `${id}.png`));
    /* H.264 wants even sides, and the stills are taken at twice the
       stage's size for sharpness on paper; the video is the stage's. */
    const W = Math.round(size.w / 2) * 2;
    const H = Math.round(size.h / 2) * 2;
    const file = path.resolve(out || `${slug(deck.name)}-${take.take}.mp4`);
    const r = ffmpeg(bin, [
      '-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'stills.txt'),
      '-i', take.audioFile,
      '-map', '0:v', '-map', '1:a',
      '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-r', String(FPS),
      '-c:v', 'libx264', '-preset', 'medium', '-tune', 'stillimage', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', '-shortest', file,
    ]);
    if (r.status !== 0) {
      throw new Error(`ffmpeg could not make the video: ${String(r.stderr).trim().split('\n').slice(-3).join(' / ')}`);
    }
    return { file, take: take.take, kind: take.kind || 'live', source: take.source || null,
             duration, stills: segs.length, steps: wanted.size, width: W, height: H, unfinished: take.unfinished };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = {
  findFfmpeg, durationOf, takesDir, listTakes, readTake,
  FPS, spans, segments, concatList, exportVideo,
};
