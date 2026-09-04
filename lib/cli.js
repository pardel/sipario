'use strict';

/* The commands, once, behind whichever name was typed.
 *
 * There is one bin, `sipario`, with `new`, `serve` and `renumber` under
 * it, because the first thing a stranger types is `npx sipario new` and
 * npx resolves a bare package name without being told a binary.
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
const { serve } = require('./server.js');
const { renumber } = require('./renumber.js');
const { scaffold } = require('./scaffold.js');

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
    serve(dir);
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

const HELP = `usage: sipario <command>

  new [dir]              start a talk, copied from the example (./talk by default)
  serve [path/to/talk]   render the folder holding deck.md, and reload on save
                         (./talk by default)
  renumber <deck.md>     rewrite slide numbers and id prefixes from position

PORT=8080 moves the server off 9999.

the format: docs/AUTHORING.md   a template: docs/TEMPLATES.md`;

/** Run one command and exit on failure. `as` is the name it was invoked by. */
function run(name, args, as) {
  try {
    commands[name](args, as);
  } catch (err) {
    if (err instanceof Usage) { console.error(err.message); process.exit(2); }
    console.error(`[${name}] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { run, commands, HELP, Usage };
