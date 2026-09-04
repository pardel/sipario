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
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let fenced = false;
  let section = 0, inSection = 0, slides = 0, changed = 0, reprefixed = 0;

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

    /* The id sits in the run of key lines under the header. */
    let k = i + 1;
    while (k < lines.length && lines[k].trim()) {
      const id = lines[k].match(/^id:\s*(?:\d+-)?(.*)$/);
      if (id) {
        const wantId = `id: ${section}-${id[1]}`;
        if (lines[k] !== wantId) { lines[k] = wantId; reprefixed++; }
        break;
      }
      k++;
    }
  }

  fs.writeFileSync(file, out.join('\n'));
  return { slides, sections: section, changed, reprefixed };
}

module.exports = { renumber };
