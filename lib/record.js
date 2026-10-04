'use strict';

/* A take, recorded: the speaker's voice from the notes window, and the
 * moment each step was shown, kept where `export video` reads them
 * (lib/video.js says where, and why outside the talk).
 *
 * The notes window records and this server keeps. The audio arrives as
 * it is recorded, a slice every few seconds, each appended to one file in
 * order; the steps arrive as they are shown, and are written beside it as
 * they come. A window closed by the deck, a crash, a laptop that sleeps:
 * what had arrived is on disk, and a take left that way is listed as
 * unfinished and can be finished by hand (`sipario takes recover`). The
 * take's `take.json` is written last and renamed into place, so a take
 * half written is never one `export video` can pick up.
 *
 *   takes/<deck>/<take>/take.webm            the audio, as the browser made it
 *   takes/<deck>/<take>/marks.partial.json   the take so far, while it records
 *   takes/<deck>/<take>/take.json            the take, once it is finished
 *
 * `take.json` is what lib/video.js reads, `{ audio, marks: [{ id, t }] }`,
 * and the rest is kept for what comes later:
 *
 *   version   1, the shape of this file
 *   kind      `live`, a take of a speaker's own voice
 *   started, finished   when, by this machine's clock
 *   deck      the deck's key, `sipario:<slug>`
 *   mime, settings      what the browser recorded with, as it reported it:
 *             a constraint asked for is only a wish, so a take may be in
 *             stereo or at 44.1 kHz whatever was asked
 *   length    seconds, by the recorder's clock; `export video` measures
 *             the audio itself, and this is for a listing
 *   marks     `{ id, t, v }` per step shown: the step's id, the seconds
 *             into the audio it arrived, and the version of the deck that
 *             was showing it, by the reload token the deck reports
 *   notes     `{ <v>: { <id>: script } }`: the script of every step of the
 *             deck at each version a mark names, as `outline()` reads it
 *             (its `script`), or null for a version that did not render. A take says the
 *             script out loud, and the deck keeps no history; this is what
 *             was on the page while it was said, so a later edit can be
 *             told from what was recorded. A mark's script is
 *             `notes[mark.v][mark.id]`. A version is read from the render
 *             the server kept for it, so a deck in fullscreen holding a
 *             save back is read as the room saw it; one the server no
 *             longer holds is read from deck.md as it is when the version
 *             is first heard of.
 *
 * Who may send any of this is decided in lib/server.js before a request
 * reaches here: this machine, by a loopback name, from a page of this
 * server's own (`sameOrigin`). Take names are made here and looked up in
 * the takes this process opened, never joined into a path, so a request
 * can name no folder of its own.
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./results.js');
const { post, sessionId } = require('./relay.js');

/* Required where they are used, not at the top: lib/export.js requires the
   server, the server requires this, and a require from here at load time
   would hand export.js a server.js that had not finished loading, its
   `serve` undefined for good. lib/video.js requires export.js. */
const video = () => require('./video.js');
const outline = (src, t) => require('./export.js').outline(src, t);

/* A slice is five seconds of Opus, some tens of kilobytes; eight megabytes
   is a slice no recorder sends. Three hundred is several hours. `stale`
   is how long an open take may go unheard before another start of the
   same deck sets it aside: six slices. The suite lowers these. */
const LIMITS = { chunk: 8 << 20, take: 300 << 20, stale: 30 * 1000 };

const PARTIAL = 'marks.partial.json';

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}
const ok = (body = {}) => ({ status: 200, body: { ok: true, ...body } });
const refuse = (status, error, more = {}) => ({ status, body: { ok: false, error, ...more } });

/* Written beside itself and renamed over, so a reader never meets half a
   file: the server reading a take back, or `sipario takes` mid-take. */
function writeJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Sent by a page of this server's own. An Origin, when the request
 *  carries one, names this listener by one of its loopback names; a
 *  fetch site, when the browser says one, is the same origin or none.
 *  A page on some other site can reach a port on this machine through
 *  the speaker's own browser, and every other check passes for it: the
 *  request comes from this machine, to a loopback name. This is the one
 *  that says whose page it is, and a route that writes megabytes to disk
 *  wants to know. */
function sameOrigin(req, port) {
  const h = req.headers || {};
  if (h.origin !== undefined) {
    const own = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
    if (!own.includes(String(h.origin).toLowerCase())) return false;
  }
  const site = h['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

/* A path as the disk has it: the nearest part that exists, through its
   links, and the rest as written. On a Mac the temp folder is reached
   through a link, and two spellings of one folder must compare equal. */
function real(p) {
  const abs = path.resolve(p);
  const rest = [];
  let at = abs;
  while (!fs.existsSync(at) && path.dirname(at) !== at) { rest.unshift(path.basename(at)); at = path.dirname(at); }
  try { return path.join(fs.realpathSync.native(at), ...rest); } catch { return abs; }
}
const within = (inner, outer) => inner === outer || inner.startsWith(outer + path.sep);

/** A name for a new take in `dir`, the deck's takes folder, live or
 *  voiced alike. It sorts after every take of the same second already
 *  kept: two begun within one second are a false start and the take that
 *  followed it, and `export video` takes the last by name. The suffix is
 *  made one more than the last one's, in the same letters, where a random
 *  one would put the false start last as often as not. */
function nameTake(dir) {
  const id = sessionId();
  const second = id.slice(0, 15);
  const same = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith(`${second}-`)).sort() : [];
  if (!same.length) return id;
  const n = parseInt(same[same.length - 1].slice(16).padEnd(4, '0'), 36) + 1;
  return Number.isFinite(n) && n < 36 ** 4 ? `${second}-${n.toString(36).padStart(4, '0')}` : id;
}

/** The recording routes of one served talk. `deck()` is the current
 *  render's deck (it throws when the deck does not render), `current()`
 *  the version on the reload stream now, `sourceOf(v)` the deck.md a kept
 *  render was made from, or null. `file` is deck.md, `talk` the talk, and
 *  `watched` the folders the server watches. */
function createRecorder({ deck, current, sourceOf, file, talk, watched, log = console }) {
  const open = new Map();             // take id -> the take, for the takes this process opened

  /* The script of every step at version `v`, once per version, as the
     voice reads it (directions to the voice kept), which is what a voiced
     take keeps too. */
  function notesFor(take, v) {
    if (Object.prototype.hasOwnProperty.call(take.record.notes, v)) return;
    let snap = null;
    try {
      const src = sourceOf(v) || fs.readFileSync(file, 'utf8');
      snap = Object.fromEntries(outline(src, talk).map((s) => [s.id, s.script]));
    } catch { /* a draft that does not render has no script to keep */ }
    take.record.notes[v] = snap;
  }

  /* Ends what a take holds open. Its folder stays as it is: unfinished,
     and recoverable. `ended` is for a slice still arriving when this
     runs: its number for the file is closed, and the next file opened,
     the next take's audio most likely, is handed the same number. */
  function end(take) {
    take.ended = true;
    open.delete(take.id);
    try { fs.closeSync(take.fd); } catch { /* closed already */ }
  }

  function start(body) {
    let key;
    try { key = deck().key; } catch (err) {
      return refuse(409, `the deck does not render, so there is nothing to record against: ${String(err.message).split('\n')[0]}`);
    }
    const dir = video().takesDir(key, dataDir());
    /* Every slice appended there would be a change in a folder the server
       watches, and every change reloads the deck: a take would reload the
       room every five seconds. */
    const inside = watched.find((w) => within(real(dir), real(w)));
    if (inside) {
      return refuse(409, `takes would be written to ${dir}, inside ${inside}, which this server watches: ` +
        'every slice of audio would reload the deck. Point SIPARIO_DATA at a folder outside it.');
    }
    const mime = typeof body.mime === 'string' ? body.mime : '';
    const ext = /^audio\/webm\b/i.test(mime) ? 'webm' : /^audio\/mp4\b/i.test(mime) ? 'm4a' : null;
    if (!ext) return refuse(400, `mime is ${JSON.stringify(mime)}; a take is recorded as audio/webm or audio/mp4`);

    /* One take of a deck at a time. One gone quiet is a window that went
       away without finishing, and it is set aside for the new one rather
       than holding the deck for the rest of the run. So is the one the
       notes say they gave up on (`gaveUp`): a slice refused, or a finish,
       ends the take in the notes and nothing here hears of it, and the
       speaker pressing V again would be told to finish a take the window
       has let go of. Only the window that held a take knows its name. */
    const gaveUp = typeof body.gaveUp === 'string' ? body.gaveUp : null;
    let setAside = null;
    for (const t of open.values()) {
      if (t.key !== key) continue;
      if (t.id !== gaveUp && Date.now() - t.heard < LIMITS.stale) {
        return refuse(409, `a take of this deck is already recording (${t.id}); finish it in the notes window that is ` +
          `recording it, or start again once it has been quiet for ${Math.round(LIMITS.stale / 1000)}s and it is set aside`);
      }
      end(t);
      setAside = t.id;
      log.warn(`[record] take ${t.id} ${t.id === gaveUp ? 'was given up by the notes' : 'went quiet'} and is left unfinished; ` +
        `sipario takes recover ${t.id} finishes it`);
    }

    /* A disk that is full, or a data folder under a file or made
       read-only, throws here. Thrown, it would reach relay.post's promise,
       where nothing catches it, and Node ends the process: the deck, the
       notes and the room with it. Answered, the notes say why. */
    const audio = `take.${ext}`;
    const settings = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : null;
    let at = dir;
    let fd = null;
    let take;
    try {
      let id = nameTake(dir);
      while (fs.existsSync(path.join(dir, id))) id = sessionId();
      at = path.join(dir, id);
      fs.mkdirSync(at, { recursive: true });
      fd = fs.openSync(path.join(at, audio), 'wx');
      take = {
        id, key, dir: at, fd, next: 0, bytes: 0, busy: false, heard: Date.now(),
        record: { version: 1, kind: 'live', audio, mime, started: new Date().toISOString(), deck: key, settings, marks: [], notes: {} },
      };
      notesFor(take, typeof body.v === 'string' && body.v ? body.v : current());
      writeJson(path.join(at, PARTIAL), take.record);
    } catch (err) {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } }
      log.error(`[record] a take could not be started in ${at}: ${err.message}`);
      return refuse(500, `the take could not be kept in ${at}: ${err.message}`);
    }
    const id = take.id;
    open.set(id, take);
    log.log(`[record] take ${id} started, kept in ${at}`);
    return ok({ take: id, audio, setAside });
  }

  /* 413, and said so the sender hears it. A request torn down while it
     is still sending reaches the sender as a failed write before it has
     read any answer: a network error, which reads as the server having
     gone and worth sending again, when the answer is that it never will
     be taken. Answering at once and closing does the same, since the
     close comes while the body is still arriving. So the rest of the body
     is read and dropped, nothing of it kept, and the 413 goes once it has
     ended, with `Connection: close`. A body more than twice the largest
     slice is no recorder's, and that one is cut off. `read` is what of
     it has been read already. */
  function tooLarge(req, res, what, read = 0) {
    let seen = read;
    req.on('data', (c) => {
      seen += c.length;
      if (seen > 2 * LIMITS.chunk) req.destroy();
    });
    req.on('end', () => {
      const text = JSON.stringify({ ok: false, error: what });
      res.writeHead(413, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      res.end(text);
    });
    req.resume();
  }

  function chunk(req, res, q) {
    /* Bytes, said to be bytes. A form, or text, is what a page on another
       site can send here without asking first; these types it cannot
       send without a preflight, and nothing here answers one. */
    if (!/^(application\/octet-stream|audio\/[\w.+-]+)\s*(;|$)/i.test(req.headers['content-type'] || '')) {
      return reply(res, 415, { ok: false, error: 'send the audio as application/octet-stream or audio/*' });
    }
    const take = open.get(q.get('take') || '');
    if (!take) return reply(res, 409, { ok: false, error: 'no take of that name is recording here' });
    const seq = Number(q.get('seq'));
    if (q.get('seq') === null || !Number.isInteger(seq) || seq < 0) {
      return reply(res, 400, { ok: false, error: 'seq is the slice\'s number, from 0' });
    }
    /* A slice sent again, because its answer was lost, is taken once. One
       ahead of the next expected means one went missing, and appending it
       would put the voice out of order. The first slice carries the file's
       header, and two in one file is a file nothing reads past the first;
       slice 0 is appended only to a take that has nothing yet, so a second
       one, sent again or sent by a recorder begun again, is never written.
       It is answered as taken, since the one case the notes can send it in
       is the first slice's answer lost, and a refusal would end the take. */
    if (seq < take.next) return reply(res, 200, { ok: true, next: take.next, again: true });
    if (seq > take.next) return reply(res, 409, { ok: false, error: `slice ${take.next} has not arrived`, next: take.next });
    if (take.busy) return reply(res, 409, { ok: false, error: 'a slice of this take is still arriving' });

    const over = (n) => (n > LIMITS.chunk ? `a slice is at most ${LIMITS.chunk} bytes`
      : take.bytes + n > LIMITS.take ? `a take is at most ${LIMITS.take} bytes, and this one is full` : null);
    const said = Number(req.headers['content-length']);
    if (Number.isFinite(said) && over(said)) return tooLarge(req, res, over(said));

    /* Read whole, then appended: a slice refused half way leaves nothing
       of itself in the file. */
    take.busy = true;
    take.heard = Date.now();
    const parts = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      const why = over(size);
      if (why) { done = true; take.busy = false; parts.length = 0; tooLarge(req, res, why, size); return; }
      parts.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      /* Set aside, or the server closed, while this arrived: the number
         it would be written to may be another take's file by now. */
      if (take.ended) {
        take.busy = false;
        return reply(res, 409, { ok: false, error: `take ${take.id} was set aside while this slice arrived; what reached it before is kept, unfinished` });
      }
      const buf = Buffer.concat(parts);
      try {
        fs.writeSync(take.fd, buf);
      } catch (err) {
        take.busy = false;
        return reply(res, 500, { ok: false, error: `the audio could not be written: ${err.message}` });
      }
      take.busy = false;
      take.bytes += buf.length;
      take.next += 1;
      take.heard = Date.now();
      reply(res, 200, { ok: true, next: take.next, bytes: take.bytes });
    });
    /* A request that goes before it ends leaves the take free for the
       slice to be sent again. */
    req.on('close', () => { if (!done) { done = true; take.busy = false; } });
  }

  function marks(body) {
    const take = open.get(body && body.take);
    if (!take) return refuse(409, 'no take of that name is recording here');
    const from = body.from;
    if (!Number.isInteger(from) || from < 0 || !Array.isArray(body.marks)) {
      return refuse(400, 'marks are {take, from, marks: [{id, t, v}]}, from the index of the first');
    }
    const have = take.record.marks.length;
    if (from > have) return refuse(409, `marks from ${have} have not arrived`, { have });
    const bad = body.marks.find((m) => !m || typeof m.id !== 'string' || !m.id || m.id.length > 200 ||
      typeof m.t !== 'number' || !Number.isFinite(m.t) || m.t < 0 || (m.v != null && typeof m.v !== 'string'));
    if (bad) return refuse(400, `${JSON.stringify(bad)} is not a mark: {id, t} with t the seconds into the audio`);
    /* Sent again from an earlier index, the marks already kept are not
       kept twice. A step whose id the deck no longer has is kept as well:
       the speaker has said it, and it is the export that refuses it. */
    for (const m of body.marks.slice(have - from)) {
      const v = typeof m.v === 'string' && m.v ? m.v : current();
      notesFor(take, v);
      take.record.marks.push({ id: m.id, t: Math.round(m.t * 1000) / 1000, v });
    }
    take.heard = Date.now();
    /* Kept only once they are on disk: a full disk answers 500, and the
       marks it would not take are not counted as had. */
    try {
      writeJson(path.join(take.dir, PARTIAL), take.record);
    } catch (err) {
      take.record.marks.length = have;
      log.error(`[record] take ${take.id}: the steps could not be written: ${err.message}`);
      return refuse(500, `the steps could not be written: ${err.message}`);
    }
    return ok({ have: take.record.marks.length });
  }

  function finish(body) {
    const take = open.get(body && body.take);
    if (!take) return refuse(409, 'no take of that name is recording here');
    if (take.busy) return refuse(409, 'a slice of this take is still arriving; finish after it');
    if (!take.record.marks.length || !take.bytes) {
      return refuse(409, `take ${take.id} has ${take.bytes ? 'no step marked' : 'no audio'} yet, so there is nothing to finish`);
    }
    const record = { ...take.record, finished: new Date().toISOString() };
    if (typeof body.length === 'number' && Number.isFinite(body.length) && body.length >= 0) {
      record.length = Math.round(body.length * 1000) / 1000;
    }
    /* Written before the take is let go of: refused by the disk, the take
       is still open, and a finish sent again once there is room keeps it. */
    try {
      writeJson(path.join(take.dir, 'take.json'), record);
    } catch (err) {
      log.error(`[record] take ${take.id} could not be finished: ${err.message}`);
      return refuse(500, `take ${take.id} could not be finished: ${err.message}`);
    }
    end(take);
    /* Left behind, it is only clutter: a take with a take.json is
       finished, whatever lies beside it. */
    try { fs.rmSync(path.join(take.dir, PARTIAL), { force: true }); } catch { /* clutter */ }
    log.log(`[record] take ${take.id} finished: ${record.marks.length} steps, ${take.bytes} bytes`);
    return ok({ take: take.id, marks: record.marks.length, bytes: take.bytes });
  }

  /* Everything not named here is the 404 a route that does not exist
     gets, OPTIONS included, so a browser's preflight is never answered. */
  function handle(req, res, pathname, q) {
    const respond = (handler) => post(req, res, handler);
    if (req.method === 'POST') {
      if (pathname === '/record/start') return respond(start);
      if (pathname === '/record/chunk') return chunk(req, res, q);
      if (pathname === '/record/marks') return respond(marks);
      if (pathname === '/record/finish') return respond(finish);
    }
    const text = 'not found';
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    return res.end(text);
  }

  /* With the server: every take still open is left unfinished, its file
     closed, so nothing holds the process open after it. */
  function close() { for (const t of [...open.values()]) end(t); }

  return { handle, close, open: () => [...open.keys()] };
}

// ----------------------------------------------------------- the takes

/** Every take kept for a deck, oldest first, finished or not: `{ id,
 *  kind, source, length, marks }`. `kind` is the take's own (`live`
 *  unless it says otherwise) or `unfinished` for one a recording left
 *  without its `take.json`. */
function describeTakes(key, root = dataDir()) {
  const dir = video().takesDir(key, root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((id) => {
    const done = readJson(path.join(dir, id, 'take.json'));
    if (done) {
      return { id, kind: done.kind || 'live', source: done.source || null,
               length: typeof done.length === 'number' ? done.length : null,
               marks: Array.isArray(done.marks) ? done.marks.length : 0 };
    }
    const part = readJson(path.join(dir, id, PARTIAL));
    if (part) return { id, kind: 'unfinished', source: null, length: null, marks: Array.isArray(part.marks) ? part.marks.length : 0 };
    return null;
  }).filter(Boolean);
}

/** Finish a take a recording left unfinished, from what reached the disk:
 *  the audio as far as it arrived, and every step marked. Refused for a
 *  take that is finished, has no audio or no steps, or was written to so
 *  lately that it may still be recording. */
function recoverTake(key, id, { root = dataDir(), now = Date.now() } = {}) {
  const all = describeTakes(key, root);
  const found = all.find((t) => t.id === id);
  if (!found) {
    throw new Error(`there is no take "${id}"${all.length ? `; the takes kept are ${all.map((t) => t.id).join(', ')}` : ''}`);
  }
  if (found.kind !== 'unfinished') throw new Error(`take ${id} is finished already`);
  const dir = path.join(video().takesDir(key, root), id);
  const part = readJson(path.join(dir, PARTIAL));
  if (!Array.isArray(part.marks) || !part.marks.length) {
    throw new Error(`take ${id} stopped before a step was marked, so there is nothing to pair its audio with`);
  }
  if (!part.audio || part.audio !== path.basename(part.audio)) {
    throw new Error(`take ${id} names its audio as ${JSON.stringify(part.audio)}, not a file beside it`);
  }
  const audio = path.join(dir, part.audio);
  let stat;
  try { stat = fs.statSync(audio); } catch { stat = null; }
  if (!stat || !stat.size) throw new Error(`take ${id} has no audio: ${audio} is ${stat ? 'empty' : 'not there'}`);
  const last = Math.max(stat.mtimeMs, fs.statSync(path.join(dir, PARTIAL)).mtimeMs);
  if (now - last < LIMITS.stale) {
    throw new Error(`take ${id} was written to ${Math.round((now - last) / 1000)}s ago and may still be recording; ` +
      'finish it in the notes window, or run this again in half a minute');
  }
  const record = { ...part, recovered: new Date(now).toISOString() };
  writeJson(path.join(dir, 'take.json'), record);
  fs.rmSync(path.join(dir, PARTIAL), { force: true });
  return { id, marks: record.marks.length, audio, bytes: stat.size };
}

module.exports = { createRecorder, sameOrigin, nameTake, describeTakes, recoverTake, LIMITS };
