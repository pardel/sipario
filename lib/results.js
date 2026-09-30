'use strict';

/* What the room said, kept, and handed back.
 *
 * The relay writes each session to a file of its own, outside the talk,
 * as it goes: a talk folder is watched and versioned, and neither an
 * audience's answers nor a file that changes on every vote belongs in
 * one. `sipario results` reads a session back and writes it out as JSON
 * and as CSV in the folder the command ran from, the way an export does.
 *
 * Where sessions live:
 *
 *   $SIPARIO_DATA/sessions/<deck>/<session>.json        when that is set
 *   ~/Library/Application Support/sipario/sessions/…    on a Mac
 *   %APPDATA%\sipario\sessions\…                        on Windows
 *   $XDG_DATA_HOME/sipario/sessions/… (~/.local/share)  elsewhere
 *
 * `<deck>` is the slug of the talk's `name:`, the same one its bookmarks
 * are kept under, and `<session>` is when the session began. What is
 * written is counts and the text of feedback, never a token or an
 * address: the file says what the room thought, not who thought it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function dataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.SIPARIO_DATA) return path.resolve(env.SIPARIO_DATA);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'sipario');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'sipario');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'sipario');
}

/* `key` is the deck's, `sipario:<slug>`; the folder is the slug. */
const sessionsDir = (key, root = dataDir()) =>
  path.join(root, 'sessions', String(key).replace(/^sipario:/, ''));

/** Write one session, whole. Written beside itself and renamed over, so
 *  a `results` run in the middle of a talk never reads half a file. */
function saveSession(key, record, root = dataDir()) {
  const dir = sessionsDir(key, root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.session}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

/** The sessions kept for a deck, oldest first. A session is named for
 *  when it began, so the names sort by time. */
function listSessions(key, root = dataDir()) {
  const dir = sessionsDir(key, root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

// ------------------------------------------------------------------- CSV

/* A cell, quoted where it has to be. Text an audience typed is the one
   thing here nobody on the speaker's side wrote, so a cell that opens as
   a spreadsheet would read a formula is opened with a quote mark, and
   stays text when it is opened. */
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per thing counted: `kind, id, question, answer, count`. Long
 *  rather than wide, so polls, reactions, the pace by slide and the
 *  feedback sit in one table a spreadsheet can pivot. */
function toCsv(record) {
  const rows = [['kind', 'id', 'question', 'answer', 'count']];
  for (const p of record.polls || []) {
    for (const o of p.options) rows.push(['poll', p.id, p.question, o.text, o.votes]);
  }
  for (const [kind, n] of Object.entries(record.reactions || {})) rows.push(['reaction', '', '', kind, n]);
  for (const sl of record.slides || []) {
    for (const [kind, n] of Object.entries(sl.reactions)) if (n) rows.push(['slide-reaction', sl.id, '', kind, n]);
    for (const [said, n] of Object.entries(sl.pace)) if (n) rows.push(['slide-pace', sl.id, '', said, n]);
  }
  const f = record.feedback;
  if (f) {
    f.questions.forEach((q, i) => {
      const id = `q${i + 1}`;
      const answers = f.responses.map((r) => r[i]).filter((a) => a !== null && a !== undefined && a !== '');
      if (q.kind === 'rate') {
        for (let score = 1; score <= 5; score++) {
          rows.push(['rating', id, q.text, score, answers.filter((a) => a === score).length]);
        }
      } else {
        for (const a of answers) rows.push(['answer', id, q.text, a, 1]);
      }
    });
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

// ---------------------------------------------------------------- export

/** Write a session's results as JSON and CSV into the current folder, or
 *  into `into`. The latest session of the talk in `dir` unless `session`
 *  names another. Returns `{ json, csv, record, sessions }`. */
function exportResults(dir, { session, into = process.cwd(), root = dataDir() } = {}) {
  const { talk } = require('./talk.js');
  const { identity } = require('./render.js');
  const t = talk(dir);
  if (!fs.existsSync(t.deck)) throw new Error(`no deck.md in ${t.dir}`);
  const deck = identity(fs.readFileSync(t.deck, 'utf8'));
  const sessions = listSessions(deck.key, root);
  if (!sessions.length) {
    throw new Error(`no sessions of "${deck.name}" are kept in ${sessionsDir(deck.key, root)}. A session ` +
      'is written there once a phone in the room has said something.');
  }
  const which = session || sessions[sessions.length - 1];
  if (!sessions.includes(which)) {
    throw new Error(`no session ${which} of "${deck.name}"; there are: ${sessions.join(', ')}`);
  }
  const record = JSON.parse(fs.readFileSync(path.join(sessionsDir(deck.key, root), `${which}.json`), 'utf8'));
  const base = path.join(path.resolve(into), `${deck.key.replace(/^sipario:/, '')}-${which}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(record, null, 2) + '\n');
  fs.writeFileSync(`${base}.csv`, toCsv(record));
  return { json: `${base}.json`, csv: `${base}.csv`, record, sessions };
}

module.exports = { dataDir, sessionsDir, saveSession, listSessions, toCsv, exportResults };
