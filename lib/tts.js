'use strict';

/* A voice engine, borrowed from the machine the way ffmpeg and the
 * browser are: sipario ships no model and depends on none. `SIPARIO_TTS`
 * names one executable, which speaks a small protocol over its stdin and
 * stdout (docs/VOICE.md says it in full, so any engine can implement it):
 *
 *   engine:  {"ready":true,"engine":"<name>",...}        once, when it can serve
 *   sipario: {"id","text","sample","out"}                 one request per line
 *   engine:  {"id","ok":true,"out"} | {"id","ok":false,"error"}   one reply each
 *   sipario: closes stdin                                 the engine exits
 *
 * One process for the whole run, not one per step: a model takes seconds
 * to load and a deck has dozens of steps. Requests go one at a time, in
 * order, so a reply is always the answer to the request before it.
 *
 * Stdout is the protocol and nothing else. A line on it that is not JSON
 * is a library printing where it should not, and is named rather than
 * skipped: an engine that leaks one line may leak half a reply. Stderr is
 * the engine's own, shown while it gets ready (the first run downloads a
 * model of a few gigabytes, and minutes of silence look like a hang) and
 * kept after, so an engine that dies is named with the last it said.
 *
 * The engine writes each clip to a name sipario chose, beside the place
 * the clip is kept, and sipario renames it into place only once the reply
 * says it is done and the file reads as a whole WAV. An engine killed half
 * way through a clip leaves nothing at the kept name, so a clip that is
 * there is a clip that is complete.
 *
 * Stopping an engine stops all of it. The executable named is often a
 * script that starts the real engine (a venv's Python, say), and a script
 * that does so without `exec` is a shell with the engine as its child.
 * Killed alone, the shell would die and the engine would carry on: a
 * stuck model holding the GPU, a slow one writing its clip after the name
 * it was handed had been cleared away. So the engine is started as the
 * leader of a process group of its own, and the whole group is killed.
 * The cost is that Ctrl-C at the terminal no longer reaches the engine
 * directly, since it is out of the terminal's group; sipario's own handler
 * passes it on. (Windows has no process groups; there the engine alone is
 * killed.)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { onPath } = require('./video.js');
const { readWav } = require('./wav.js');

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const secs = (ms) => `${Number((ms / 1000).toFixed(1))}s`;

/* How long an engine is waited on. Ready: ten minutes, since the first
   run of Chatterbox downloads about 3 GB before it says anything on
   stdout. A request: two minutes and half a second a character, which is
   several times what Chatterbox takes on a laptop's CPU and covers the
   first request's warm-up. Closing: what an engine needs to let go of a
   model. The suite lowers these. */
const LIMITS = {
  ready: 10 * 60 * 1000,
  request: (text) => 120 * 1000 + 500 * String(text).length,
  close: 30 * 1000,
};

/** The voice engine: SIPARIO_TTS, absolute or a name on PATH. Unset is an
 *  error that says how to set one up; there is no default, since no
 *  engine comes with the machine. */
function findTts(env = process.env) {
  if (!env.SIPARIO_TTS) {
    throw new Error('no voice engine: set SIPARIO_TTS to an executable that speaks sipario\'s voice protocol. ' +
      'docs/VOICE.md says how to set up Chatterbox, a local model, as one.');
  }
  const named = path.isAbsolute(env.SIPARIO_TTS) ? env.SIPARIO_TTS : onPath(env.SIPARIO_TTS, env);
  if (named && isFile(named)) return named;
  throw new Error(`SIPARIO_TTS is ${env.SIPARIO_TTS}, which is not a file here`);
}

/** Start the engine and wait for its ready line. Resolves to a session,
 *  `{ ready, say, close, kill }`: `ready` is the ready line as the engine
 *  sent it; `say(request)` sends one request and resolves to its reply,
 *  rejecting with the engine's own error for `ok: false`; `close()` ends
 *  the engine by closing its stdin, stops it with a line on `log` if it
 *  has not exited by LIMITS.close, and rejects only for a signal that
 *  came while it waited. Anything that breaks the protocol, a line that
 *  is not JSON, a reply to the wrong request, an engine that exits or goes
 *  quiet past its time, ends the session: the engine is killed and the
 *  request waiting, or the next one, is refused with what went wrong. So
 *  is SIGINT or SIGTERM to this process while it runs. */
function startEngine(bin, { env = process.env, log = process.stderr, readyTimeout = LIMITS.ready } = {}) {
  return new Promise((resolve, reject) => {
    /* An argument array and no shell, like ffmpeg: SIPARIO_TTS names an
       executable, never a command line. */
    const group = process.platform !== 'win32';
    const child = spawn(bin, [], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: group });
    const tail = [];
    let partial = '';
    let out = '';
    let ready = null;
    let pending = null;               // { req, resolve, reject, timer }
    let dead = null;
    let closing = null;

    const lastWords = () => (tail.length ? `; it last said: ${tail.slice(-5).join(' / ')}` : '');
    const signals = ['SIGINT', 'SIGTERM'];
    const onSignal = (sig) => fail(Object.assign(new Error(`stopped by ${sig}`), { signal: sig }));
    for (const s of signals) process.on(s, onSignal);
    const off = () => { for (const s of signals) process.removeListener(s, onSignal); };

    /* The session is over: said once, to whoever is waiting. The engine's
       pipes are let go of as well as the engine killed: a process of its
       own that left the group could otherwise hold them open, and this
       process would never end. While closing, every clip is in and checked,
       so an engine that will not exit is no reason to lose the take; a
       signal is, since the speaker asked for the run to stop. */
    function fail(err) {
      if (dead) return;
      dead = err;
      clearTimeout(readyTimer);
      off();
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* gone already */ }
      for (const s of [child.stdin, child.stdout, child.stderr]) s.destroy();
      if (!ready) return reject(err);
      if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(err); }
      if (closing) closing(err.signal ? err : null);
    }

    const readyTimer = setTimeout(() => fail(new Error(`the voice engine ${bin} did not say it was ready within ` +
      `${secs(readyTimeout)}, and was stopped${lastWords()}`)), readyTimeout);

    child.on('error', (err) => fail(new Error(`the voice engine ${bin} could not be started: ${err.message}`)));
    child.stdin.on('error', () => { /* an engine gone; its close says how */ });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      if (!ready && log) log.write(c);
      partial += c;
      const lines = partial.split(/\r?\n|\r/);
      partial = lines.pop();
      for (const l of lines) if (l.trim()) tail.push(l.trim());
      tail.splice(0, Math.max(0, tail.length - 20));
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
      let i;
      while (!dead && (i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i).replace(/\r$/, '');
        out = out.slice(i + 1);
        if (line.trim()) heard(line);
      }
    });

    child.on('close', (code, signal) => {
      if (partial.trim()) tail.push(partial.trim());
      if (closing && !pending) { off(); dead = dead || new Error('closed'); return closing(); }
      const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
      fail(new Error(`the voice engine ${bin} ${how} ` +
        `${pending ? `while voicing ${pending.req.id}` : ready ? 'between requests' : 'before it was ready'}${lastWords()}`));
    });

    function heard(line) {
      let msg;
      try { msg = JSON.parse(line); } catch { msg = null; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return fail(new Error(`the voice engine ${bin} wrote ${JSON.stringify(line.slice(0, 200))} on stdout, ` +
          'which is not a line of the protocol: stdout carries JSON lines only, and anything else belongs on stderr'));
      }
      if (!ready) {
        if (msg.ready !== true) {
          return fail(new Error(`the voice engine ${bin} began with ${JSON.stringify(line.slice(0, 200))}; ` +
            `its first line must be {"ready":true,...}${lastWords()}`));
        }
        ready = msg;
        clearTimeout(readyTimer);
        return resolve(session);
      }
      if (!pending) return fail(new Error(`the voice engine ${bin} said ${JSON.stringify(line.slice(0, 200))} when nothing was asked of it`));
      if (msg.id !== pending.req.id) {
        return fail(new Error(`the voice engine ${bin} answered for ${JSON.stringify(msg.id)} when it was asked for ${pending.req.id}`));
      }
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      if (msg.ok === true) return p.resolve(msg);
      return p.reject(new Error(`the voice engine could not voice ${p.req.id}: ${msg.error || JSON.stringify(msg)}`));
    }

    function say(req, { timeout = LIMITS.request(req.text) } = {}) {
      if (dead) return Promise.reject(dead);
      if (pending) return Promise.reject(new Error(`asked for ${req.id} while ${pending.req.id} is still being voiced`));
      return new Promise((ok, no) => {
        pending = { req, resolve: ok, reject: no, timer: setTimeout(() => fail(new Error(
          `the voice engine ${bin} did not answer for ${req.id} within ${secs(timeout)}, and was stopped${lastWords()}`)), timeout) };
        child.stdin.write(JSON.stringify(req) + '\n');
      });
    }

    function close() {
      if (dead) return Promise.resolve();
      return new Promise((ok, no) => {
        const timer = setTimeout(() => {
          if (log) log.write(`[voice] the voice engine ${bin} did not exit within ${secs(LIMITS.close)} of its input closing, and was stopped\n`);
          fail(new Error('did not exit'));
        }, LIMITS.close);
        closing = (err) => { clearTimeout(timer); if (err) no(err); else ok(); };
        child.stdin.end();
      });
    }

    const session = { get ready() { return ready; }, say, close, kill: (why = 'stopped') => fail(new Error(why)) };
  });
}

/** One clip, kept at `out` only once it is whole. The engine is handed a
 *  name of sipario's beside `out`, ending .wav because an engine may
 *  choose the format from the name; the reply has to say ok and the file
 *  has to read as a WAV with audio in it before it is renamed into place.
 *  Whatever goes wrong, the name handed out is cleared away. Resolves to
 *  what the WAV holds (lib/wav.js). */
async function clip(engine, { id, text, sample, out }, opts) {
  const tmp = path.join(path.dirname(out), `${path.basename(out, '.wav')}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.wav`);
  try {
    await engine.say({ id, text, sample, out: tmp }, opts);
    let info;
    try { info = readWav(tmp); } catch (err) {
      throw new Error(`the voice engine said ${id} was voiced, but ${err.message}`);
    }
    if (!info.frames) throw new Error(`the voice engine said ${id} was voiced, and wrote no audio for it`);
    fs.renameSync(tmp, out);
    return info;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { findTts, startEngine, clip, LIMITS };
