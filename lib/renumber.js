'use strict';

/* Rewrites the number on each `## ` line and the section prefix of `id:`
 * in a deck, to match where each slide actually sits.
 *
 * This edits the source in place; it generates nothing. It exists because
 * the alternative to a verified number is an unverified one, and the
 * alternative to renumbering by hand is not renumbering at all.
 *
 * The rest of an id is left alone: it is the name the author gave the
 * slide, and only the prefix is this file's business. So is the title on
 * the `## ` line.
 *
 * Where a movement begins is read off the `# ` lines, the same place the
 * renderer reads it. There used to be two ways to open one and this file
 * carried its own copy of both; the copy went stale at the `kind:` ->
 * `template:` rename and quietly renumbered thirty-five slides.
 */

const fs = require('fs');

const GROUP = /^#\s+\S/;
const SLIDE = /^##\s+(\d+\.\d+)(\s.*)?$/;

/** Renumber one deck in place. Returns what it counted and what it moved. */
function renumber(file) {
  const text = fs.readFileSync(file, 'utf8');
  /* The renderer ignores a comment at the head of the file, and so must
     this: a `# ` line inside one is prose, and counted as a movement it
     shifts every number in the deck by one and renumbers a deck that was
     right. The `number-from:` line below it goes the same way, since the
     scan for it stops at the first movement. The comment is set aside
     whole and put back untouched; only the deck under it is renumbered. */
  const head = (text.match(/^<!--[\s\S]*?-->\s*/) || [''])[0];
  const lines = text.slice(head.length).split('\n');
  const out = [];
  let fenced = false;
  /* The deck's head may say the movements count from 0; the renderer
     reads the same key. */
  let from = 1;
  for (const line of lines) {
    const t = line.trim();
    if (GROUP.test(t)) break;
    const m = t.match(/^number-from:\s*(\d+)\s*$/);
    if (m) { from = Number(m[1]); break; }
  }
  let section = from - 1, inSection = 0, slides = 0, changed = 0, reprefixed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith('```')) { fenced = !fenced; out.push(line); continue; }
    if (fenced) { out.push(line); continue; }

    if (GROUP.test(t) && !t.startsWith('##')) {
      section++;
      inSection = 0;
      out.push(line);
      continue;
    }

    const m = t.match(SLIDE);
    if (!m) { out.push(line); continue; }

    slides++;
    inSection++;
    const want = `${section}.${inSection}`;
    if (m[1] !== want) changed++;
    out.push(`## ${want}${m[2] || ''}`);

    /* The id sits in the run of key lines under the header.
       Front matter may quote a value, and the quotes are the parser's
       rather than the id's: read through them and put them back, or
       `id: '1-x'` gains a second prefix and becomes `id: 1-'1-x'`, which
       renders as a different anchor and breaks every link to it. */
    let k = i + 1;
    while (k < lines.length && lines[k].trim()) {
      const id = lines[k].match(/^id:\s*(.*)$/);
      if (id) {
        const v = id[1].trim();
        const quoted = /^'.*'$/.test(v);
        const name = (quoted ? v.slice(1, -1) : v).replace(/^\d+-/, '');
        const want = `${section}-${name}`;
        const wantId = `id: ${quoted ? `'${want}'` : want}`;
        if (lines[k] !== wantId) { lines[k] = wantId; reprefixed++; }
        break;
      }
      k++;
    }
  }

  fs.writeFileSync(file, head + out.join('\n'));
  return { slides, sections: section - from + 1, changed, reprefixed };
}

module.exports = { renumber };
