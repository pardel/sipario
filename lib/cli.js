'use strict';

/* The commands, once, behind whichever name was typed.
 *
 * There is one bin, `sipario`, with `new`, `serve`, `renumber`, `export`,
 * `results`, `takes` and `voice` under it, because the first thing a stranger types is
 * `npx sipario new` and npx resolves a bare package name without being
 * told a binary.
 *
 * `new` and `serve` both default their folder to `./talk`, so the two
 * commands that get a stranger to a rendered deck take no argument at
 * all. An explicit folder still wins wherever one is given. `sipario-serve` and `sipario-renumber` stay as bins of their
 * own: talks already have them in their npm scripts, and an alias is two
 * lines against a rename in every consumer.
 *
 * A command is `(args, as) => void`, where `as` is how it was invoked, so
 * a usage line names what the reader typed rather than a canonical form
 * they did not use. Anything that throws `Usage` exits 2; anything else
 * exits 1 with its message.
 */

const fs = require('fs');
const path = require('path');
const { serve } = require('./server.js');
const { renumber } = require('./renumber.js');
const { scaffold } = require('./scaffold.js');
const { exportPdf, exportPptx } = require('./export.js');
const { exportVideo, takesDir } = require('./video.js');
const { exportResults } = require('./results.js');
const { describeTakes, recoverTake } = require('./record.js');
const { voice } = require('./voice.js');
const { talk } = require('./talk.js');
const { identity } = require('./render.js');

class Usage extends Error {}

/* Both folder-taking commands answer to the same bare name, so `new`
   followed by `serve` needs nothing typed between them. */
const DEFAULT_DIR = 'talk';

const commands = {
  new(args, as) {
    const dir = args[0] || DEFAULT_DIR;
    const t = scaffold(dir);
    /* The folder is only worth naming back if it was chosen. Defaulted,
       the next step is the bare command, which is the whole point of it. */
    const next = args[0] ? `npx sipario serve ${dir}` : 'npx sipario serve';
    const rows = [
      [next, 'and open http://localhost:9999'],
      [`${dir}/deck.md`, 'the words, and the script under each step'],
      [`${dir}/templates/`, 'what a slide of each template looks like'],
      [`${dir}/deck.css`, 'its typefaces, its colours, its shared vocabulary'],
    ];
    /* Padded from the longest row rather than a guess, because the folder
       a talk is started in can be any length. */
    const w = Math.max(...rows.map(([left]) => left.length));
    console.log(`[new] a talk named "${t.name}", in ${dir}\n`);
    for (const [left, right] of rows) console.log(`  ${left.padEnd(w)}   ${right}`);
  },

  serve(args, as) {
    const dir = args[0] || DEFAULT_DIR;
    /* Only the defaulted folder earns a usage line. A folder the reader
       typed and got wrong is their path to fix, and `serve` names it. */
    if (!args[0] && !fs.existsSync(dir)) {
      throw new Usage(
        `usage: ${as} [path/to/talk]   (the folder holding deck.md; ./${DEFAULT_DIR} by default)`);
    }
    const server = serve(dir);
    /* Stopped with Ctrl-C, the room is closed first, which writes its
       last second of answers to disk. Closing the server itself would wait
       on every phone's open stream, so the relay is closed directly. */
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => { if (server.room) server.room.relay.close(); process.exit(0); });
    }
  },

  renumber(args, as) {
    const file = args[0];
    if (!file) throw new Usage(`usage: ${as} <path/to/deck.md>`);
    const r = renumber(file);
    const notes = [];
    if (r.changed) notes.push(`${r.changed} renumbered`);
    if (r.reprefixed) notes.push(`${r.reprefixed} id prefixes fixed`);
    console.log(`[renumber] ${r.slides} slides, ${r.sections} movements, ` +
      (notes.length ? notes.join(', ') : 'all already correct'));
  },
};

const FORMATS = { pdf: exportPdf, pptx: exportPptx, video: exportVideo };

commands.export = function (args, as) {
  const usage = `usage: ${as} <pdf|pptx|video> [path/to/talk] [-o file] [--take id]   ` +
    `(./${DEFAULT_DIR} by default; the file is named after the deck, in the current folder; ` +
    `a video is made from the latest take unless one is named)`;
  const [format, ...rest] = args;
  if (!format || !Object.prototype.hasOwnProperty.call(FORMATS, format)) throw new Usage(usage);
  let out = null;
  let take = null;
  const free = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-o' || rest[i] === '--out') {
      out = rest[++i];
      if (!out) throw new Usage(usage);
    } else if (rest[i] === '--take' && format === 'video') {
      take = rest[++i];
      if (!take) throw new Usage(usage);
    } else {
      free.push(rest[i]);
    }
  }
  const dir = free[0] || DEFAULT_DIR;
  if (!free[0] && !fs.existsSync(dir)) throw new Usage(usage);
  return FORMATS[format](dir, { out, take }).then((r) => {
    const rel = path.relative(process.cwd(), r.file) || r.file;
    const size = `${r.width}x${r.height}`;
    if (format === 'video') {
      const m = Math.floor(r.duration / 60);
      const sec = String(Math.round(r.duration % 60)).padStart(2, '0');
      console.log(`[export] ${rel}: ${m}:${sec} at ${size} from take ${r.take} ` +
        `(${r.kind}${r.source ? ` from ${r.source}` : ''}), ${r.stills} stills of ${r.steps} steps`);
      /* The latest finished take, when a newer one was left unfinished,
         is not the take the speaker has just made; said, not guessed at. */
      const left = (r.unfinished || []).slice(-1)[0];
      if (left) {
        console.warn(`[export] take ${left} is newer, and was left unfinished, so it is not the one exported: ` +
          `sipario takes recover ${left} finishes it, and --take ${left} exports it`);
      }
      return undefined;
    }
    console.log(format === 'pdf'
      ? `[export] ${rel}: ${r.pages} pages at ${size}, one per step (${r.slides} slides)`
      : `[export] ${rel}: ${r.slides} slides at ${size}, one per step, the script in each one's notes`);
  });
};

/* What the room said in a session, as JSON and CSV in the folder the
   command ran from and never in the talk: the talk is versioned, and an
   audience's answers are neither its source nor a thing to commit. */
commands.results = function (args, as) {
  const usage = `usage: ${as} [path/to/talk] [--session id]   ` +
    `(./${DEFAULT_DIR} by default; the latest session unless one is named)`;
  let session = null;
  const free = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session') {
      session = args[++i];
      if (!session) throw new Usage(usage);
    } else {
      free.push(args[i]);
    }
  }
  const dir = free[0] || DEFAULT_DIR;
  if (!free[0] && !fs.existsSync(dir)) throw new Usage(usage);
  const r = exportResults(dir, { session });
  const rel = (f) => path.relative(process.cwd(), f) || f;
  const rec = r.record;
  const reactions = Object.values(rec.reactions || {}).reduce((a, n) => a + n, 0);
  const forms = rec.feedback ? rec.feedback.responses.length : 0;
  console.log(`[results] ${rel(r.json)}, ${rel(r.csv)}: ${rec.joined} phone${rec.joined === 1 ? '' : 's'}, ` +
    `${rec.polls.length} poll${rec.polls.length === 1 ? '' : 's'}, ${reactions} reactions, ` +
    `${forms} feedback form${forms === 1 ? '' : 's'}`);
  if (r.sessions.length > 1) {
    console.log(`          session ${rec.session}, one of ${r.sessions.length}; --session names another`);
  }
};

/* The takes recorded of a deck, which live outside the talk (lib/video.js
   says where), so this is how they are seen without going to look; and
   the one way to finish a take a recording left unfinished, from the
   audio and the steps that reached the disk before it stopped. */
commands.takes = function (args, as) {
  const usage = `usage: ${as} [path/to/talk]   or   ${as} recover <take> [path/to/talk]   ` +
    `(./${DEFAULT_DIR} by default)`;
  const free = args.slice();
  let recover = null;
  if (free[0] === 'recover') {
    free.shift();
    recover = free.shift();
    if (!recover) throw new Usage(usage);
  }
  if (free.length > 1 || (free[0] && free[0].startsWith('-'))) throw new Usage(usage);
  const dir = free[0] || DEFAULT_DIR;
  if (!free[0] && !fs.existsSync(dir)) throw new Usage(usage);
  const t = talk(dir);
  if (!fs.existsSync(t.deck)) throw new Error(`no deck.md in ${t.dir}`);
  const deck = identity(fs.readFileSync(t.deck, 'utf8'));
  if (recover) {
    const r = recoverTake(deck.key, recover);
    return console.log(`[takes] ${r.id} finished from what reached the disk: ${r.marks} steps, ` +
      `${r.bytes} bytes of audio`);
  }
  const list = describeTakes(deck.key);
  if (!list.length) {
    return console.log(`[takes] no takes of "${deck.name}" are kept in ${takesDir(deck.key)}. ` +
      "Record one with V in the notes' own window.");
  }
  console.log(`[takes] ${list.length} take${list.length === 1 ? '' : 's'} of "${deck.name}", oldest first, ` +
    `in ${takesDir(deck.key)}\n`);
  const len = (s) => (s === null ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const rows = list.map((k) => [k.id, k.kind + (k.source ? ` from ${k.source}` : ''), len(k.length),
    `${k.marks} step${k.marks === 1 ? '' : 's'}`, k.kind === 'unfinished' ? `sipario takes recover ${k.id}` : '']);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) {
    console.log(`  ${r[0].padEnd(w[0])}   ${r[1].padEnd(w[1])}   ${r[2].padStart(w[2])}   ${r[3].padEnd(w[3])}   ${r[4]}`.trimEnd());
  }
};

/* The talk read in the speaker's own voice, by a voice engine on this
   machine (docs/VOICE.md), from a live take's few seconds of it: a new
   take, which `export video` then makes a video of. The engine's progress
   is said on stderr, a step a line, and the take on stdout. */
commands.voice = function (args, as) {
  const usage = `usage: ${as} [path/to/talk] [--from <live take>] [--hold <seconds>]   ` +
    `(./${DEFAULT_DIR} by default; the voice is cloned from the latest live take unless one is named, ` +
    'and a step with no script is held silent for --hold seconds, 2 by default)';
  let from = null;
  let hold = 2;
  const free = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') {
      from = args[++i];
      if (!from) throw new Usage(usage);
    } else if (args[i] === '--hold') {
      const said = args[++i];
      if (said === undefined) throw new Usage(usage);
      hold = Number(said);
      if (!(Number.isFinite(hold) && hold > 0)) {
        throw new Error(`--hold is ${said}: it is the seconds a step with no script is held silent, a number above 0`);
      }
    } else if (args[i].startsWith('-')) {
      throw new Usage(usage);
    } else {
      free.push(args[i]);
    }
  }
  if (free.length > 1) throw new Usage(usage);
  const dir = free[0] || DEFAULT_DIR;
  if (!free[0] && !fs.existsSync(dir)) throw new Usage(usage);
  return voice(dir, { from, hold }).then((r) => {
    const len = `${Math.floor(r.length / 60)}:${String(Math.round(r.length % 60)).padStart(2, '0')}`;
    console.log(`[voice] take ${r.take}: ${len}, ${r.steps} steps, ${r.synthetic.length} voiced by ${r.engine} ` +
      `(${r.made} new, ${r.cached} cached)${r.held.length ? `, ${r.held.length} with no script held ${hold}s` : ''}, ` +
      `in the voice of take ${r.source} (${r.sample.length.toFixed(1)}s from ${r.sample.offset}s)`);
  });
};

const HELP = `usage: sipario <command>

  new [dir]              start a talk, copied from the example (./talk by default)
  serve [path/to/talk]   render the folder holding deck.md, and reload on save
                         (./talk by default)
  renumber <deck.md>     rewrite slide numbers and id prefixes from position
  export pdf [dir]       the deck as a PDF, one page per step, at the stage's size
  export pptx [dir]      the deck as PowerPoint, a picture per step, the script in its notes
                         (./talk by default; -o names the file, else the deck does)
  results [dir]          what the room said in the latest session, as JSON and CSV here
                         (--session names another)
  takes [dir]            the takes recorded of the deck, oldest first;
                         \`takes recover <take>\` finishes one a recording left unfinished
  voice [dir]            the script read in your voice, cloned from your latest live take,
                         as a new take (SIPARIO_TTS names the engine: docs/VOICE.md)

PORT=8080 moves the server off 9999. SIPARIO_BROWSER names the browser export
prints with, when Chrome, Chromium, Brave or Edge is somewhere unusual.

the format: docs/AUTHORING.md   a template: docs/TEMPLATES.md`;

/** Run one command and exit on failure. `as` is the name it was invoked by.
 *  A command may return a promise, and a rejection fails the same way a
 *  throw does. */
function run(name, args, as) {
  const fail = (err) => {
    if (err instanceof Usage) { console.error(err.message); process.exit(2); }
    console.error(`[${name}] ${err.message}`);
    process.exit(1);
  };
  try {
    const r = commands[name](args, as);
    if (r && typeof r.then === 'function') r.catch(fail);
  } catch (err) {
    fail(err);
  }
}

module.exports = { run, commands, HELP, Usage };
