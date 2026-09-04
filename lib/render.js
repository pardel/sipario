'use strict';

/* deck.md -> the deck's HTML.
 *
 * The dialect is small and specific, so this parses it directly rather
 * than reaching for a markdown library: a general parser would have to be
 * fought back into these nine templates, and the failure mode of fighting it
 * is a slide that renders plausibly and wrongly.
 *
 * Shape:
 *   name: My talk   the talk names itself, above everything
 *   title: ...      what the browser tab says (optional)
 *                   (a blank line)
 *   # Movement      a group opens, named
 *   ## 3.1 Title    a slide opens, numbered and named
 *   key: value      its front matter, `template` required
 *                   (a blank line)
 *   body            the first step
 *   --              the next step of the same slide
 *   body
 *
 * Headers rather than `---` because `---` could not say which of the two
 * things it was: it opened a slide and it closed front matter, and one of
 * the terminal slides prints a markdown file whose own `---` front matter
 * is byte-identical to both. `## 3.1` is a shape nothing else in a deck
 * has. The number is on every slide where a title is on only some, so the
 * header is never left empty.
 *
 * A step states what it adds. Everything the slide has already shown is
 * still shown, so a build is written once rather than restated at every
 * step. A `>` standfirst is the exception: a slide may reword its
 * standfirst as it builds, so a new one replaces the one before it.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

const fs = require('fs');
const path = require('path');

/* `render` takes a talk's three paths and has no talk of its own to fall
 * back on. A default here would be this library carrying a deck around,
 * and the failure it produces is the worst kind: a render that succeeds
 * against somebody else's slides. So a missing option is named. */
class MissingTalkOption extends Error {
  constructor(key) {
    super(`render() was given no \`${key}\`. A talk says where it lives: ` +
      `pass talk('<folder>') from sipario, or the three paths yourself.`);
    this.name = 'MissingTalkOption';
    this.key = key;
  }
}

function need(opts, key) {
  if (!opts || !opts[key]) throw new MissingTalkOption(key);
  return opts[key];
}

const br = (s) => String(s).split('\n').map(esc).join('<br>');

// ------------------------------------------------------------------ parse

/* A `#` line opens a movement, a `##` line opens a slide. Neither can be
 * confused with a `---`, and only the slide header is self-identifying:
 * `^## \d+\.\d+` matches nothing else a deck contains, while `# ` still
 * has to be told apart from a shell comment in a transcript, so fences
 * are tracked either way. */
const GROUP = /^#\s+(\S.*?)\s*$/;
const SLIDE = /^##\s+(\d+\.\d+)(?:\s+(\S.*?))?\s*$/;
const KEY = /^([A-Za-z_][\w-]*):\s*(.*)$/;
const HEADING = /^#{1,6}\s/;

/* Keys the headers took over, and where each one went. Left unchecked, a
   `slide:` line would be read as front matter and silently ignored, and a
   `group:` line would leave the slide in whatever movement preceded it. */
const MOVED = {
  slide: 'the number on the `##` line',
  title: 'the rest of the `##` line',
  group: 'a `# ` line above the slide',
  word: 'the `# ` line the section opens',
};

/* A talk says its own name.
 *
 * deck.md opens with a run of `key: value` lines above its first `# `
 * line. `name` is the talk, short; `title` is what the browser tab says.
 *
 * Required rather than defaulted. The name is what keeps two decks served
 * from one origin from sharing a set of bookmarks and a presenter
 * channel, and a default is precisely how both of them come to be called
 * the same thing.
 */
const IDENTITY = ['name', 'title'];

function identity(src) {
  const front = {};
  let started = false;
  for (const line of src.replace(/^<!--[\s\S]*?-->\s*/, '').split('\n')) {
    const t = line.trim();
    if (!t) { if (started) break; continue; }       // the blank line ends the run
    const m = t.match(KEY);
    if (!m) break;                                  // the deck itself has begun
    front[m[1]] = m[2].trim();
    started = true;
  }

  const unknown = Object.keys(front).filter((k) => !IDENTITY.includes(k));
  if (unknown.length) {
    throw new Error(`deck.md opens with keys nothing reads: ${unknown.join(', ')}\n  ` +
      `a deck declares ${IDENTITY.join(' and ')}, above its first \`# \` line.`);
  }
  if (!front.name) {
    throw new Error('deck.md declares no `name:`. A talk names itself in a `name: ` line ' +
      'above its first `# ` line, so two decks served from one origin keep their ' +
      'bookmarks and their presenter channel apart.');
  }

  return { name: front.name, title: front.title || front.name, key: `sipario:${slug(front.name)}` };
}

function parse(src) {
  const lines = src.replace(/^<!--[\s\S]*?-->\s*/, '').split('\n');
  const slides = [];
  const malformed = [];               // a heading that is neither
  let pending = null;                 // a `# ` line waiting for its slide
  let fenced = false;
  let i = 0;

  const header = (t) => !fenced && (SLIDE.test(t) || (GROUP.test(t) && !t.startsWith('##')));

  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith('```')) { fenced = !fenced; i++; continue; }

    if (!fenced && GROUP.test(t) && !t.startsWith('##')) {
      pending = t.match(GROUP)[1];
      i++;
      continue;
    }

    const head = !fenced && t.match(SLIDE);
    if (!head) {
      /* A heading that opens neither a movement nor a slide. `## A title`
         with the number left off is the one that matters: it is not a
         slide header, so the slide it meant to open would be swallowed
         into the body of the one above it and simply never appear. */
      if (!fenced && HEADING.test(t)) malformed.push(t);
      i++;
      continue;
    }
    i++;

    const meta = { slide: head[1] };
    if (head[2]) meta.title = head[2];
    if (pending) { meta.group = pending; pending = null; }

    /* Front matter is the run of `key: value` lines directly under the
       header, ending at the blank line that separates it from the body.
       No fence: the header already said a slide had opened, so a second
       delimiter would only be there to close something. Anything in that
       run which is not a key is kept and named rather than swallowed,
       because a body that started one line early would render. */
    const stray = [];
    const declared = [];
    while (i < lines.length && lines[i].trim() && !header(lines[i].trim())) {
      const m = lines[i].match(KEY);
      if (!m) { stray.push(lines[i].trim()); i++; continue; }
      let v = m[2].trim();
      if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      declared.push(m[1]);
      meta[m[1]] = v;
      i++;
    }

    const steps = [];
    let buf = [];
    const flush = () => { steps.push(step(buf)); buf = []; };

    while (i < lines.length) {
      const t2 = lines[i].trim();
      /* Delimiters inside a fence are content, not structure. One of the
         terminal slides prints a markdown file with its own `---` front
         matter and its own `##` heading; reading either as structure
         splits the fence in half and loses the rest of the deck. */
      if (t2.startsWith('```')) fenced = !fenced;
      if (!fenced) {
        if (header(t2)) break;                        // next slide or movement
        if (HEADING.test(t2)) malformed.push(t2);     // and one that is neither
        if (t2 === '--') { flush(); i++; continue; }  // next step
      }
      buf.push(lines[i]);
      i++;
    }
    flush();
    slides.push({ meta, declared, stray, steps: accumulate(steps) });
  }
  slides.malformed = malformed;
  return slides;
}

/* A deck in the shape this format used to have. `---` opened a slide and
   `slide:`/`group:` carried what the headers now carry, so an old deck
   would parse to no slides at all and fail as though the file were
   empty. */
function checkShape(src, slides) {
  const body = src.replace(/^<!--[\s\S]*?-->\s*/, '');
  if (slides.length) return;
  const why = /^---\s*$/m.test(body) ? '`---` opened a slide; it is now `## <number> <title>`'
    : 'no `## <number>` line, so no slide opens';
  throw new Error(`deck.md has no slides in it: ${why}.`);
}

/* Both halves of the front-matter rule, named. A key the headers took
   over is silently ignored otherwise; a stray line means the body began
   one line early and the slide would render with it missing. */
/* A heading the format does not recognise. `## A title` with the number
   left off is the one that matters: it opens no slide, so the slide it
   meant to open is read as more body for the slide above it and never
   appears at all. */
function checkHeadings(slides) {
  const bad = (slides.malformed || []).map((t) =>
    `"${t.slice(0, 52)}" opens neither a movement nor a slide   ` +
    `->   \`# <movement>\` or \`## <number> <title>\``);
  if (bad.length) throw new Error(`deck.md has headings nothing would read:\n  ` + bad.join('\n  '));
}

function checkFrontMatter(slides) {
  const bad = [];
  for (const sl of slides) {
    for (const k of sl.declared) {
      if (MOVED[k]) bad.push(`${sl.meta.slide}: \`${k}:\` is now ${MOVED[k]}`);
    }
    for (const l of sl.stray) {
      bad.push(`${sl.meta.slide}: front matter has a line that is not \`key: value\`: ` +
        `"${l.slice(0, 48)}"   (a blank line separates it from the body)`);
    }
  }
  if (bad.length) throw new Error(`deck.md front matter:\n  ` + bad.join('\n  '));
}

/* A step's spoken script is a ```notes block.
 *
 * Fenced because a script has to end as well as begin. `Note:` was a
 * prefix on one line and ran to the end of the step, so the body had to
 * come first, a continuation line was indistinguishable from body, and
 * the script's end was wherever the step happened to stop.
 *
 * A step may carry more than one block; they are joined as paragraphs.
 * A plain fence in the body is a terminal transcript and is left alone,
 * which is also what stops a ``` inside one being read as a script. */
const NOTES = /^```\s*notes\s*$/;
const FENCE = /^```/;

/** Split one step's raw lines into its body and its spoken script. */
function step(raw) {
  const body = [];
  const note = [];
  let inNotes = false;
  let inFence = false;

  for (const line of raw) {
    const t = line.trim();
    if (inNotes) {
      if (FENCE.test(t)) { inNotes = false; continue; }
      note.push(line);
      continue;
    }
    if (!inFence && NOTES.test(t)) {
      if (note.length) note.push('');              // a second block is a paragraph
      inNotes = true;
      continue;
    }
    if (FENCE.test(t)) inFence = !inFence;
    body.push(line);
  }

  return { body: body.join('\n').trim(), note: note.join('\n').trim(), unclosed: inNotes };
}

/* Each step carries what the slide has shown so far, so the deck states a
   line once and the build is the order it arrives in. `own` is kept: it is
   what the author wrote, and the only thing that can say whether a step
   repeated something already on the stage. */
function accumulate(steps) {
  let shown = [];
  let sub = '';
  return steps.map((st) => {
    const bs = blocks(st.body);
    const declared = bs.find((b) => b.trim().startsWith('>'));
    if (declared) sub = declared;
    shown = shown.concat(bs.filter((b) => !b.trim().startsWith('>')));
    return { ...st, own: st.body, body: (sub ? [sub] : []).concat(shown).join('\n\n') };
  });
}

/* A body is blocks separated by blank lines. `>` is the standfirst, `-`
 * opens a list, ``` fences a terminal, anything else is a paragraph. */
function blocks(body) {
  const out = [];
  let cur = [];
  let fence = false;
  for (const line of body.split('\n')) {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      cur.push(line);
      if (!fence) { out.push(cur.join('\n')); cur = []; }
      continue;
    }
    if (!fence && !line.trim()) {
      if (cur.length) { out.push(cur.join('\n')); cur = []; }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const standfirst = (bs) => {
  const b = bs.find((x) => x.trim().startsWith('>'));
  return b ? b.split('\n').map((l) => l.replace(/^\s*>\s?/, '')).join(' ').trim() : '';
};

/** The first fenced block's content, fence removed and nothing else
    touched. A terminal transcript is the only thing that uses it today,
    but a fence is markdown rather than one template's private business. */
function fenced(bs) {
  const b = bs.find((x) => x.trim().startsWith('```'));
  if (!b) return '';
  return b.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '').replace(/\n$/, '');
}

/* A `- line` with an indented line under it, taken in pairs. The close
   slide's links read this way, and a link without a note is still a link
   rather than half a row, so the note is optional per pair. */
function pairs(body) {
  const parts = body.split('\n')
    .filter((l) => l.trim().startsWith('-') || /^\s{2,}\S/.test(l));
  const out = [];
  for (let k = 0; k < parts.length; k += 2) {
    out.push({ lead: parts[k].replace(/^-\s*`?|`?\s*$/g, ''),
               note: parts[k + 1] ? parts[k + 1].trim() : '' });
  }
  return out;
}

/** `- (icon) **Head**` + an indented body line, or a bare paragraph. */
function items(bs) {
  const out = [];
  for (const b of bs) {
    const t = b.trim();
    if (t.startsWith('>')) continue;
    if (!t.startsWith('-')) { out.push({ lead: t.replace(/\n\s*/g, ' ') }); continue; }
    for (const chunk of b.split(/\n(?=\s*-\s)/)) {
      const [first, ...rest] = chunk.split('\n');
      const m = first.trim().match(/^-\s*\(([^)]+)\)\s*(.*)$/);
      if (!m) { out.push({ lead: chunk.trim().replace(/^-\s*/, '') }); continue; }
      /* `**Head**` is the convention that marks the heading, not emphasis
         inside it, so the markers are consumed rather than rendered. */
      const head = m[2].trim().replace(/^\*\*([\s\S]*)\*\*$/, '$1');
      out.push({ tag: m[1], head, body: rest.join(' ').trim() });
    }
  }
  return out;
}

// ----------------------------------------------------------------- render

/* ---- layered figures
 *
 * `layers: capture, trust` on an image slide names the groups in the SVG
 * to reveal, in order, one per step, with the caption arriving last. The
 * SVG marks them with `<g class="layer" data-layer="name">`.
 *
 * Both halves of that contract are checked at render time rather than
 * trusted. A misspelt layer name is the failure worth guarding: nothing
 * would throw, the group would simply never be hidden, and the slide
 * would show the whole figure at step one while looking entirely normal.
 */
function layerNames(meta) {
  return meta.layers.split(',').map((x) => x.trim()).filter(Boolean);
}

const figureCache = new Map();

function readFigure(name, root) {
  const file = path.join(root, `${name}.svg`);
  if (!figureCache.has(file)) {
    figureCache.set(file, fs.readFileSync(file, 'utf8').trim());
  }
  return figureCache.get(file);
}

function align(svg) {
  return /preserveAspectRatio=/.test(svg)
    ? svg.replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="xMinYMid meet"')
    : svg.replace(/<svg\b/, '<svg preserveAspectRatio="xMinYMid meet"');
}

function checkLayers(slides, root) {
  const bad = [];
  slides.filter((sl) => sl.meta.layers).forEach((sl) => {
    const names = layerNames(sl.meta);
    let svg;
    try {
      svg = readFigure(sl.meta.figure, root);
    } catch (err) {
      bad.push(`${sl.meta.id}: cannot read images/${sl.meta.figure}.svg`);
      return;
    }
    const have = [...svg.matchAll(/data-layer="([^"]+)"/g)].map((m) => m[1]);
    names.filter((n) => !have.includes(n)).forEach((n) => {
      bad.push(`${sl.meta.id}: layer "${n}" is not in ${sl.meta.figure}.svg ` +
               `(it has ${have.length ? have.map((h) => `"${h}"`).join(', ') : 'none'})`);
    });
    /* One step per layer, plus one for the caption where there is one.
       A slide with fewer steps than layers would never reach its last
       one, and nothing else would say so. */
    const want = names.length + (sl.meta.caption ? 1 : 0);
    if (sl.steps.length !== want) {
      bad.push(`${sl.meta.id}: ${names.length} layers` +
               (sl.meta.caption ? ' and a caption' : '') +
               ` need ${want} steps, but the slide has ${sl.steps.length}`);
    }
  });
  if (bad.length) throw new Error(`deck.md has bad layer builds:\n  ${bad.join('\n  ')}`);
}

/* ---- the templates
 *
 * A template is templates/<name>.html: the markup, with placeholders,
 * read exactly as written. Beside it, for the templates whose values have
 * to be worked out rather than looked up, templates/<name>.js exporting
 * `data(ctx)`. Nothing here names one, so a new talk can add its own
 * without editing this file.
 *
 * The filters are the deck's own text handling, injected rather than
 * imported, so a template can say `{{sub|inline}}` without every template
 * reaching back into this module. The contract is docs/TEMPLATES.md.
 */
const { load } = require('./templates.js');

/* The templates belong to the talk, so they are looked up per render
   rather than once when this module loads. `load` caches by folder, so
   the cost of asking again is a Map hit. */
const FILTERS = { inline, br };

/* Where a stage's content sits in the page this file writes. Templates are
   laid out to it, which is what frees a template's own indentation. */
const INDENT = ' '.repeat(8);

const templatesFor = (opts) =>
  load(need(opts, 'templateRoot'), FILTERS, INDENT);

/* `imagePath` is the URL prefix the deck's own markup uses; `imageRoot`
   is the directory layered figures are read from. They are separate
   because one is served to a browser and the other is read off disk, and
   a talk kept somewhere other than beside this file needs to move them
   independently. */
const toolkit = (opts = {}) => ({
  esc, inline, br,
  blocks, standfirst, items, fenced, pairs,
  imagePath: opts.imagePath || 'images',
  figure: {
    read: (name) => readFigure(name, opts.imageRoot),
    align,
    names: layerNames,
  },
});

function renderStep(meta, s, lastStep, step, allSteps, t, templateFor) {
  const bs = blocks(s.body);
  const ctx = {
    meta,
    body: s.body,
    note: s.note,
    step,
    steps: allSteps,
    lastStep,
    bs,
    sub: standfirst(bs),
    fenced: fenced(bs),
    pairs: pairs(s.body),
    imagePath: t.imagePath,
    t,
  };

  const tpl = templateFor(meta.template);
  /* A template with no .js is markup and nothing else, which is most of the
     point of keeping the two apart. */
  return tpl.fill(tpl.data ? { ...ctx, ...tpl.data(ctx) } : ctx);
}

/* Keys this format used to have, and what they are called now. A deck
   written against an old name would otherwise fail as though the slide
   had declared nothing, or worse render a slide with a silently empty
   line on it, and neither says what is actually wrong. */
const RENAMED = { kind: 'template', meta: 'author' };

function checkRenamed(slides) {
  const bad = [];
  for (const sl of slides) {
    for (const [was, now] of Object.entries(RENAMED)) {
      if (sl.meta[was] !== undefined && sl.meta[now] === undefined) {
        bad.push(`${sl.meta.id || sl.meta.slide}: ${was}: ${sl.meta[was]}   ->   ${now}:`);
      }
    }
  }
  if (bad.length) {
    throw new Error(`deck.md uses keys this format has renamed:\n  ` + bad.join('\n  '));
  }
}

/* Restating a line the slide has already shown used to be how a build was
   written; now it puts the line on the stage twice. A deck in the old
   form is refused rather than rendered double. */
function checkSteps(slides) {
  const bad = [];
  for (const sl of slides) {
    const seen = new Set();
    sl.steps.forEach((st, k) => {
      for (const b of blocks(st.own)) {
        const t = b.trim();
        if (t.startsWith('>')) continue;
        if (seen.has(t)) {
          bad.push(`${sl.meta.id || sl.meta.slide} step ${k + 1}: ` +
                   `restates "${t.split('\n')[0].slice(0, 52)}"`);
        }
        seen.add(t);
      }
    });
  }
  if (bad.length) {
    throw new Error(`deck.md restates content a step already shows. A step ` +
      `states what it adds:\n  ` + bad.join('\n  '));
  }
}

/* A script that never closes swallows the rest of its step, and a deck
   written when notes were a `Note:` prefix would lose every one of them
   without a word. Both are named rather than rendered around. */
function checkNotes(slides) {
  const bad = [];
  for (const sl of slides) {
    sl.steps.forEach((st, k) => {
      const at = `${sl.meta.id || sl.meta.slide}${k ? ` step ${k + 1}` : ''}`;
      if (st.unclosed) bad.push(`${at}: a \`\`\`notes block is never closed`);
      const old = st.body.split('\n').find((l) => /^Note:/.test(l.trim()));
      if (old) bad.push(`${at}: \`Note:\` is now a \`\`\`notes block   ->   ${old.trim().slice(0, 48)}`);
    });
  }
  if (bad.length) throw new Error(`deck.md has scripts nothing would read:\n  ` + bad.join('\n  '));
}

/* A `>` line on a slide whose template never prints one would vanish
   without a word, which is the failure this whole format is arranged to
   avoid. Nothing here names a template: it asks the compiled template
   what it reaches for, so a talk's own tenth template is covered too. */
function checkStandfirst(slides, templateFor) {
  const bad = [];
  for (const sl of slides) {
    if (templateFor(sl.meta.template).uses.has('sub')) continue;
    sl.steps.forEach((st, k) => {
      if (standfirst(blocks(st.body))) {
        bad.push(`${sl.meta.id || sl.meta.slide}${k ? ` step ${k + 1}` : ''}: ` +
                 `the ${sl.meta.template} template never prints a standfirst`);
      }
    });
  }
  if (bad.length) {
    throw new Error(`deck.md has \`>\` lines nothing would render:\n  ` + bad.join('\n  '));
  }
}

/* A template no file covers stops the render, and says so once, naming
   every slide that used it rather than the first one reached. */
function checkTemplates(slides, names) {
  const bad = slides.filter((sl) => !names.includes(sl.meta.template));
  if (bad.length) {
    throw new Error(`deck.md names templates that do not exist:\n  ` +
      bad.map((sl) => `${sl.meta.id || sl.meta.slide}: ${sl.meta.template}`).join('\n  ') +
      `\n  templates in this talk: ${names.join(', ')}`);
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60);

/* A slide's id is declared in deck.md and opens with its section number,
 * so the anchor is a name the author chose rather than a slug that moves when
 * a title is rewritten. Steps of one slide take it with a numeric suffix.
 *
 * Ids used to be derived here. Deriving them meant a link went
 * stale the moment a heading was edited, and it hid a real fault: a slide
 * with no title fell back to its template's name, so three statements all answered
 * to `statement`. Declared ids cannot do either quietly. */
function stepId(sl, k) {
  return sl.meta.id + (k ? `-${k + 1}` : '');
}

/* Declared means checkable. Each id must exist, and must open with the
 * number of the section it is actually in, or the prefix is decoration
 * rather than information. */
/* `align:` has two values and an unrecognised one is a typo, not a
 * preference. Left unchecked it would render the slide unchanged and
 * look like the option had no effect. */
const ALIGN = ['spread', 'bottom', 'tight'];

function checkAlign(slides) {
  const wrong = slides
    .filter((sl) => sl.meta.align && !ALIGN.includes(sl.meta.align))
    .map((sl) => `slide ${sl.meta.slide} has align: ${sl.meta.align}`);
  if (wrong.length) {
    throw new Error(`deck.md: unknown align value:\n  ${wrong.join('\n  ')}\n` +
      `\nallowed: ${ALIGN.join(', ')}`);
  }
}

function checkDeclaredIds(groups) {
  const wrong = [];
  groups.forEach((g, gi) => {
    g.slides.forEach((sl) => {
      const n = sl.meta.slide;
      if (!sl.meta.id) wrong.push(`slide ${n} declares no id`);
      else if (!sl.meta.id.startsWith(`${gi + 1}-`)) {
        wrong.push(`slide ${n} has id "${sl.meta.id}" but sits in section ${gi + 1} (${g.name})`);
      }
    });
  });
  if (wrong.length) {
    throw new Error(`deck.md ids are out of step with the sections:\n  ${wrong.join('\n  ')}\n` +
      `\nRun \`npm run renumber\` to reprefix them.`);
  }
}

/* An id that is not unique is a link that goes somewhere else. The deck
 * navigates by hash, so this is checked rather than assumed. */
function checkIds(ids) {
  const seen = new Map();
  const clashes = [];
  ids.forEach((id, i) => {
    if (seen.has(id)) clashes.push(`"${id}" is used by step ${seen.get(id) + 1} and step ${i + 1}`);
    else seen.set(id, i);
  });
  if (clashes.length) throw new Error(`deck.md produces duplicate slide ids:\n  ${clashes.join('\n  ')}`);
}

/* A blank line separates blocks. A block whose first line is a bullet is
 * a list, and any line after it that is not a bullet continues the item
 * above rather than starting a new one, so a bullet can wrap in the file
 * without breaking in the window.
 *
 * Lists earn their place here because the script already had one, four
 * bullets describing what a scheduled pass does, and it was rendering as
 * a single run-on line. A note is read at a glance from a second screen
 * mid-sentence, which is the one place a list beats prose outright. */
const BULLET = /^[-*]\s+/;
const NUMBER = /^\d+[.)]\s+/;

/* Emphasis in the script. Escaping happens first and the markers are
 * applied to the escaped text, so a note can never introduce a tag of its
 * own however it is written.
 *
 * Bold runs before italic, or `**like this**` would be read as an italic
 * inside a pair of stray asterisks.
 *
 * `_underscores_` are deliberately not emphasis. The script names paths
 * constantly, `0_Inbox`, `5_System/tools/status.sh`, and two of those on
 * one line would silently italicise everything between them. Asterisks
 * appear nowhere in the script and underscores appear twice, so the
 * ambiguous marker is the one worth giving up. */
function inline(text) {
  return esc(text)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>');
}

function noteItems(lines, marker) {
  const out = [];
  lines.forEach((l) => {
    if (marker.test(l)) out.push(l.replace(marker, ''));
    else if (out.length) out[out.length - 1] += ' ' + l;
  });
  return out;
}

function notesHtml(note) {
  if (!note) return '';
  return note.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return '';
    for (const [marker, tag] of [[BULLET, 'ul'], [NUMBER, 'ol']]) {
      if (marker.test(lines[0])) {
        const li = noteItems(lines, marker).map((t) => `<li>${inline(t)}</li>`).join('');
        return `<${tag}>${li}</${tag}>`;
      }
    }
    const line = lines.join(' ');
    const cue = line.startsWith('[') && line.endsWith(']') ? ' class="cue"' : '';
    return `<p${cue}>${inline(line)}</p>`;
  }).join('\n          ');
}

/* A slide's number is its section and its place in it: 2.1 opens Opening,
 * 3.1 opens Gates. Declared in deck.md and verified here, never trusted.
 *
 * The number is for the person editing the file, and for the room: it
 * says which movement a slide belongs to rather than how far through 43
 * it happens to sit, so inserting a slide renumbers one movement instead
 * of everything after it. A number written down and not checked goes
 * quietly wrong the first time a slide moves, so a disagreement stops the
 * render. `npm run renumber` rewrites them from position. */
function numberOf(gi, si) {
  return `${gi + 1}.${si + 1}`;
}

function checkNumbers(groups) {
  const wrong = [];
  groups.forEach((g, gi) => {
    g.slides.forEach((sl, si) => {
      const want = numberOf(gi, si);
      /* Never undefined: a `##` line without a number opens no slide at
         all, which checkHeadings refuses by name before this runs. */
      const got = sl.meta.slide;
      if (String(got) !== want) wrong.push(`declared ${got}, is actually ${want}`);
    });
  });
  if (wrong.length) {
    throw new Error(
      `deck.md slide numbering is out of step:\n  ${wrong.join('\n  ')}\n` +
      `\nRun \`npm run renumber\` to rewrite them from position.`);
  }
}

/* Groups are the deck's movements, and a `# ` line opens one. There used
 * to be two ways to do it — a `section` slide named its movement with its
 * `word`, every other movement declared `group:` on its first slide — and
 * anything that needed to know where a movement began had to carry both
 * rules. renumber.js carried a stale copy of one of them for a fortnight.
 * Every slide belongs to exactly one, so the file has to open with a
 * `# ` line or there are slides in no movement at all. */
function grouped(slides) {
  const out = [];
  slides.forEach((sl, i) => {
    if (sl.meta.group) out.push({ name: sl.meta.group, slides: [] });
    if (!out.length) {
      throw new Error(
        `deck.md: slide ${i + 1} is in no movement. A \`# \` line opens one, ` +
        `and the first slide has to sit under one.`);
    }
    out[out.length - 1].slides.push(sl);
  });
  return out;
}

/* `opts` is how a talk says where it lives: `templateRoot` for its slide
   templates, `imageRoot` for its figures on disk, `imagePath` for the URL
   its markup writes. `talk('<folder>')` returns exactly that shape. There
   is no default: this library has no talk. */
function render(src, opts = {}) {
  need(opts, 'templateRoot');
  need(opts, 'imageRoot');
  const slides = parse(src);
  checkShape(src, slides);
  const deck = identity(src);
  checkHeadings(slides);
  checkFrontMatter(slides);
  const groups = grouped(slides);
  checkNumbers(groups);
  checkDeclaredIds(groups);
  checkAlign(slides);
  checkRenamed(slides);
  checkNotes(slides);
  checkSteps(slides);
  const { templateFor, names } = templatesFor(opts);
  checkTemplates(slides, names);
  checkStandfirst(slides, templateFor);
  checkLayers(slides, opts.imageRoot);
  const t = toolkit(opts);
  const blocksOut = groups.map((g, gi) => {
    /* An id opens with its section's number, so a URL says where in the
       talk it lands: `#3-start-with-two` is in Gates, the third movement,
       without having to look. The number is shown on the movement in the
       map for the same reason — a number in a URL that appears nowhere
       else is a puzzle rather than a signpost. */
    const sec = gi + 1;
    const stacks = g.slides.map((sl, si) => {
      const num = numberOf(gi, si);
      /* The slide carries the name of the template that rendered it, so a
         stylesheet can reach every slide of one template without that
         having to mark every element on it. */
      const cls = `template-${sl.meta.template}` +
      (sl.meta.dark === 'true' ? ' is-dark' : '') +
      (sl.meta.align ? ` align-${sl.meta.align}` : '');
      const last = sl.steps[sl.steps.length - 1];
      const secs = sl.steps.map((s, k) => {
        const id = stepId(sl, k);
        const current = gi === 0 && si === 0 && k === 0 ? ' current' : '';
        return `      <section class="slide ${cls}${current}" id="${id}" data-n="${num}">
        <div class="stage">
          ${renderStep(sl.meta, s, last, k, sl.steps, t, templateFor)}
        </div>
        <aside class="notes">
          ${notesHtml(s.note)}
        </aside>
      </section>`;
      }).join('\n');
      return `      <div class="stack" data-steps="${sl.steps.length}" data-n="${num}">\n${secs}\n      </div>`;
    }).join('\n');
    return `    <section class="group" data-group="${esc(g.name)}" data-section="${sec}">\n` +
      `      <h2 class="group-name" data-section="${sec}">${esc(g.name)}</h2>\n${stacks}\n    </section>`;
  });

  const html = blocksOut.join('\n');
  checkIds([...html.matchAll(/<section class="slide[^"]*" id="([^"]+)"/g)].map((m) => m[1]));

  /* A template's rules live beside it, and only the ones that exist are
     linked. Alphabetical because the order has to be the same on every
     render: two templates styling one shared class would otherwise swap
     places between page loads. */
  const sheets = names.filter((n) => fs.existsSync(path.join(opts.templateRoot, `${n}.css`)))
    .sort().map((n) => `/templates/${n}.css`);

  return { html, deck, sheets, slides: slides.length, groups: groups.length,
           steps: slides.reduce((a, s) => a + s.steps.length, 0) };
}

module.exports = { render, parse, identity, checkNumbers, grouped, checkIds, checkDeclaredIds,
                   checkAlign, checkLayers, checkTemplates, checkRenamed, checkNotes, checkSteps,
                   checkStandfirst, toolkit, templatesFor, MissingTalkOption };
