'use strict';

/* Starting a second talk.
 *
 * `starters/minimal` is the shortest complete talk and the fixture this
 * repo's suite renders, so it is also the only sensible thing to copy: a
 * folder the suite proves works, rather than a skeleton written once and
 * left to rot beside a deck nobody renders. Copying it is what the README
 * told a stranger to do by hand; this does the one part of that a `cp`
 * cannot.
 *
 * That part is the name. `name:` is required precisely so two decks never
 * share a bookmark key or a presenter channel, and a plain copy stamps
 * every new talk with the fixture's, which is the collision the key was
 * introduced to prevent. So the name is rewritten from the folder the
 * talk is being started in, and the rewrite is read back before this
 * returns.
 */

const fs = require('fs');
const path = require('path');
const { identity } = require('./render.js');

/* The folder a new talk is copied from. It ships in the package for this
   reason as much as for being an example. */
const EXAMPLE = path.join(__dirname, '..', 'starters', 'minimal');

/* Finder leaves these on the volume this repo lives on. A new talk should
   not inherit one. */
const NOISE = new Set(['.DS_Store']);

/** A talk's name, from the folder it is being started in. */
function nameFrom(dir) {
  const words = path.basename(path.resolve(dir)).replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!words) {
    throw new Error(`no name can be read from the folder "${dir}". ` +
      `A talk is named after the folder it lives in, so name the folder after the talk.`);
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* The same run of `key: value` lines `identity()` reads: from the top,
   ending at the first blank line or the first line that is not one. A
   `name:` further down the deck belongs to a slide, not to the talk.
   This is a second copy of that rule, and the read-back at the foot of
   `scaffold()` is what stops the copy drifting: a rule that widened over
   there and not here shows up as a deck still called "Minimal". */
function rename(src, name) {
  const lines = src.split('\n');
  let started = false;
  const drop = new Set();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { if (started) break; continue; }
    const m = t.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) break;
    started = true;
    if (m[1] === 'name') lines[i] = `name: ${name}`;
    /* The example's title describes the example. A new talk is not that
       talk, so it is given none: `title:` is optional and falls back to
       `name:`, which leaves the author a subtitle to write rather than
       one of somebody else's to notice and delete. */
    if (m[1] === 'title') drop.add(i);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

/**
 * Copy a talk folder into `dir` and name it after that folder.
 * Returns `{ dir, name, key, deck }`. Throws rather than overwriting.
 */
function scaffold(dir, { from = EXAMPLE } = {}) {
  const target = path.resolve(dir);

  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error(`${target} is a file, not a folder to start a talk in.`);
    const held = fs.readdirSync(target);
    if (held.length) {
      throw new Error(`${target} is not empty (it holds ${held.slice(0, 3).join(', ')}` +
        `${held.length > 3 ? `, and ${held.length - 3} more` : ''}). ` +
        `A talk is started in a new folder, so nothing here is overwritten.`);
    }
  }

  const name = nameFrom(target);          // before the copy, so a bad name writes nothing

  fs.cpSync(from, target, { recursive: true, errorOnExist: true, force: false,
                            filter: (src) => !NOISE.has(path.basename(src)) });

  const deck = path.join(target, 'deck.md');
  fs.writeFileSync(deck, rename(fs.readFileSync(deck, 'utf8'), name));

  /* Read back, because a rewrite that silently did nothing is the whole
     failure this function exists to prevent. */
  const written = identity(fs.readFileSync(deck, 'utf8'));
  if (written.name !== name) {
    throw new Error(`the copied deck is still named "${written.name}", not "${name}".`);
  }

  return { dir: target, name, key: written.key, deck };
}

module.exports = { scaffold, EXAMPLE };
