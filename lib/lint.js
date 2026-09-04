'use strict';

/* What is true of any talk, checked once.
 *
 * A talk is a folder: its words, its type, its images, its templates and
 * its stylesheet. None of that is this library's, but the
 * rules it has to keep are — every template compiles, every class has a rule,
 * every figure it names is on disk, every step has a script. Those rules
 * were written against one talk and would have been copied into the next
 * one; a copy in two repos is the first of them going stale.
 *
 * So they live here, as a list of named checks a talk's own suite runs
 * over its own folder:
 *
 *   const { talkChecks } = require('sipario');
 *   for (const { name, fn } of talkChecks(talk('./talk'))) check(name, fn);
 *
 * Each `fn` throws with a message naming what is wrong, or returns.
 */

const fs = require('fs');
const path = require('path');
const { render } = require('./render.js');
const { load } = require('./templates.js');

const THEME = path.join(__dirname, '..', 'css', 'theme.css');

/* The filters a template may name. Compiling needs them present; what
   they do to the text is the renderer's business, not this file's. */
const FILTERS = { inline: String, br: String, raw: String };

const read = (f) => fs.readFileSync(f, 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* Classes the frame and the runtime own, which any template may write.
   Everything else a template writes is prefixed with the template's own
   name, so a rule in a talk's stylesheet can be traced to the file that
   emits it and two templates cannot collide over a name. */
const SHARED = new Set(['rule', 'wide', 'hidden-step', 'first', 'last', 'ghost', 'over',
                        'slide', 'stage', 'stack', 'group', 'group-name', 'notes', 'cue',
                        'layer', 'current', 'is-dark']);

/* State the runtime sets, and the `template-` hooks a talk may leave
   unstyled. Neither is written by a template, so neither needs a rule. */
const RUNTIME = /^(overview|docked|asking|asked|help|audit|current|current-stack|live|on|cdir|shot|empty|running|align-|is-dark|template-|cue|layer)/;

/** Every top-level selector in a sheet, normalised. */
function selectors(css) {
  return new Set([...strip(css).matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)]
    .map((m) => m[2].replace(/\s+/g, ' ').trim()));
}

/** Every class a stylesheet writes a rule for. */
function styled(css) {
  const bare = strip(css);
  const out = new Set();
  let depth = 0, start = 0;
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === '{') {
      if (depth === 0) {
        for (const m of bare.slice(start, i).matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1]);
      }
      depth++;
    } else if (bare[i] === '}') { depth--; if (depth === 0) start = i + 1; }
  }
  return out;
}

const declarations = (css) =>
  [...css.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);

/** The checks any talk has to pass. `t` is what `talk('<folder>')` returns. */
function talkChecks(t) {
  const sheet = t.deckCss;
  /* Every stylesheet the talk owns: its own, then one per template that
     has rules of its own. The checks below read the set, not one file,
     so moving a rule from the talk's sheet to a template's cannot make a
     check quietly stop covering it. */
  const templateSheets = () => fs.readdirSync(t.templateRoot)
    .filter((f) => f.endsWith('.css')).sort().map((f) => path.join(t.templateRoot, f));
  const talkSheets = () => [sheet].concat(templateSheets());
  const allTalkCss = () => talkSheets().map(read).join('\n');
  const at = (...p) => path.join(t.dir, ...p);

  /* Read once, lazily, so a folder that is missing something fails in the
     check that names it rather than on the way in. */
  let cache = null;
  const talkFiles = () => {
    if (!cache) {
      const src = read(t.deck);
      const r = render(src, t);
      const { templates, names } = load(t.templateRoot, FILTERS);
      cache = { src, r, templates, names };
    }
    return cache;
  };

  return [

    { name: 'every template is an .html file, and compiles', fn: () => {
      const { templates, names } = talkFiles();
      if (!names.length) throw new Error('the talk defines no templates');
      for (const k of names) {
        if (typeof templates[k].fill !== 'function') throw new Error(`${k} did not compile`);
        if (!fs.existsSync(path.join(t.templateRoot, `${k}.html`))) {
          throw new Error(`${k} has no .html`);
        }
      }
    } },

    { name: 'a template that is only markup has no JavaScript beside it', fn: () => {
      /* The split is the point: data that has to be worked out lives in
         <name>.js, and one with nothing to work out has no .js at all. If
         every template grew one, the markup would have drifted back into
         code. */
      const { templates, names } = talkFiles();
      if (!names.some((k) => !templates[k].data)) {
        throw new Error('every template has a data function, so the split buys nothing');
      }
    } },

    { name: 'a data function takes one context and returns fields', fn: () => {
      const { templates, names } = talkFiles();
      for (const k of names) {
        const { data } = templates[k];
        if (data && data.length > 1) {
          throw new Error(`${k}.data takes ${data.length} arguments, not one context`);
        }
      }
    } },

    { name: 'every template is laid out for reading', fn: () => {
      /* The rule this format is built on: a template is markup a person
         edits. A wall of markup with indentation smuggled into it, which
         is what these were before the engine took the layout over, is
         not. */
      const { names } = talkFiles();
      for (const k of names) {
        const src = read(path.join(t.templateRoot, `${k}.html`));
        for (const l of src.split('\n')) {
          if (!l.trim() || l.trim().startsWith('{{!')) continue;
          if (/\{\{\/[a-z.]+\}\}\s*<[a-z]/.test(l)) {
            throw new Error(`templates/${k}.html closes a section and opens markup on one ` +
              'line, which is the layout trick the engine makes unnecessary');
          }
        }
        if (!/\n\n/.test(src)) {
          throw new Error(`templates/${k}.html has no blank line in it; it is one block of markup`);
        }
      }
    } },

    { name: 'every class a template writes is prefixed with its template', fn: () => {
      const { names } = talkFiles();
      for (const k of names) {
        const src = read(path.join(t.templateRoot, `${k}.html`));
        for (const m of src.matchAll(/class="([^"{}]*)"/g)) {
          for (const c of m[1].split(/\s+/).filter(Boolean)) {
            if (SHARED.has(c) || c.startsWith(`${k}-`)) continue;
            throw new Error(`templates/${k}.html writes "${c}", which neither starts with ` +
              `"${k}-" nor is shared`);
          }
        }
      }
    } },

    { name: 'the deck exercises every template the talk defines', fn: () => {
      /* A template nothing renders can break without saying so, and a
         name with no file behind it is a slide that will not render at
         all. */
      const { r, names } = talkFiles();
      const used = new Set([...r.html.matchAll(/class="slide template-([a-z-]+)/g)].map((m) => m[1]));
      const unused = names.filter((k) => !used.has(k));
      if (unused.length) throw new Error(`deck.md never uses: ${unused.join(', ')}`);
      const unknown = [...used].filter((k) => !names.includes(k));
      if (unknown.length) throw new Error(`deck.md uses names with no template: ${unknown.join(', ')}`);
    } },

    { name: 'every asset the deck references exists', fn: () => {
      /* `src` is the URL the markup writes. Each of the talk's folders is
         mounted at the URL of its own name, so the URL resolves against
         the talk folder unchanged and can be tested on disk. */
      const { r } = talkFiles();
      const missing = [...new Set([...r.html.matchAll(/ src="([^"]+)"/g)].map((m) => m[1]))]
        .filter((src) => !/^(data:|https?:|\/\/)/.test(src) && !fs.existsSync(at(src)));
      if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
    } },

    { name: 'every step has a spoken script', fn: () => {
      const { r } = talkFiles();
      const empty = [...r.html.matchAll(
        /<section class="slide[^"]*" id="([^"]+)"[\s\S]*?<aside class="notes">([\s\S]*?)<\/aside>/g)]
        .filter((m) => !m[2].trim()).map((m) => m[1]);
      if (empty.length) throw new Error(`no script: ${empty.join(', ')}`);
    } },

    { name: 'the talk carries its own look, typefaces included', fn: () => {
      /* Type, and the rules for what a template puts on the stage, are
         design, and design travels with the talk. A copied folder that
         renders in a system font with unstyled rows is a talk that did
         not bring its stylesheet. */
      if (!fs.existsSync(sheet)) throw new Error(`${t.dir} has no deck.css`);
      const css = read(sheet);
      for (const token of ['--head:', '--body:', '@font-face']) {
        if (!css.includes(token)) throw new Error(`deck.css has no ${token}`);
      }
    } },

    { name: "a template's sheet styles only that template's own slides", fn: () => {
      /* The reason its rules may sit beside it. A sheet reaching for
         another template's classes is a shared rule in a private file,
         and the next person to delete that template takes the other one's
         styling with it. Shared rules belong in deck.css. */
      const { names } = talkFiles();
      for (const f of templateSheets()) {
        const own = path.basename(f, '.css');
        if (!names.includes(own)) {
          throw new Error(`templates/${own}.css has no templates/${own}.html beside it`);
        }
        for (const c of styled(read(f))) {
          if (SHARED.has(c) || RUNTIME.test(c) || c === `template-${own}` || c.startsWith(`${own}-`)) continue;
          throw new Error(`templates/${own}.css styles "${c}", which is not its own`);
        }
      }
    } },

    { name: "every url() in the talk's stylesheet resolves to a file", fn: () => {
      /* A `url()` that points nowhere is the quietest failure in CSS: the
         property is dropped and the page renders as though nobody had
         asked for it. */
      const missing = [];
      for (const f of talkSheets()) {
        for (const m of strip(read(f)).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
          const ref = m[1].trim();
          if (/^(data:|https?:|\/\/)/.test(ref)) continue;
          /* Resolved from beside the sheet that wrote it, the way a browser
             resolves it: `fonts/inter.woff2` from deck.css at the talk root
             and `../images/bg-grid.svg` from a sheet in templates/. */
          const target = path.resolve(path.dirname(f), ref.split('?')[0]);
          if (!fs.existsSync(target)) {
            missing.push(`${path.relative(t.dir, f)} asks for ${ref}, which is not a file in the talk`);
          }
        }
      }
      if (missing.length) throw new Error(missing.join('\n        '));
    } },

    { name: 'no class is written without a rule, and no rule without a class', fn: () => {
      /* This is what catches a rename that landed on one side only: a
         double-prefixed selector matches nothing and looks like a styling
         choice rather than a mistake. */
      const { r } = talkFiles();
      const written = new Set();
      for (const m of r.html.matchAll(/class="([^"]*)"/g)) {
        for (const c of m[1].split(/\s+/)) if (c) written.add(c);
      }
      const rules = styled(read(THEME) + allTalkCss());
      const unstyled = [...written].filter((c) => !rules.has(c) && !RUNTIME.test(c));
      if (unstyled.length) throw new Error(`written but never styled: ${unstyled.join(', ')}`);
      const unwritten = [...styled(allTalkCss())]
        .filter((c) => !written.has(c) && !RUNTIME.test(c));
      if (unwritten.length) throw new Error(`styled but never written: ${unwritten.join(', ')}`);
    } },

    { name: 'every token a rule reaches for is declared', fn: () => {
      /* A var() nothing defines falls back to nothing and the property is
         dropped, which looks like a styling choice rather than a typo. */
      const sheets = [read(THEME), read(path.join(__dirname, '..', 'css', 'presenter.css')),
                      allTalkCss()];
      const declared = new Set(sheets.flatMap(declarations));
      const missing = new Set();
      for (const text of sheets) {
        for (const m of text.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
          if (!declared.has(m[1]) && !m[2]) missing.add(m[1]);
        }
      }
      /* Set on the element that uses it, by a template or by the runtime,
         rather than declared in a sheet. */
      for (const ok of ['--label', '--steps-ink', '--compass-ink']) missing.delete(ok);
      if (missing.size) throw new Error(`used but never declared: ${[...missing].join(', ')}`);
    } },

    { name: "the talk's sheet claims no selector the frame also claims", fn: () => {
      /* Which file loads first then cannot decide a tie, so rules stay
         safe to move across the split. */
      const frame = selectors(read(THEME));
      const both = [...selectors(allTalkCss())].filter((s) => frame.has(s) && s !== ':root');
      if (both.length) throw new Error(`in both sheets: ${both.join(', ')}`);
    } },

    { name: 'colours are named for their purpose, not their value', fn: () => {
      /* A rule asking for --slate-500 says a shade and leaves the reader
         to guess where it belongs, and a talk restyling itself has to
         know the scale to know what it is changing. Names say the job. */
      const SCALES = /var\(--(slate|teal|gray|zinc|neutral|stone|indigo|sky|blue|amber)-?\d*\)/;
      const VALUES = /var\(--(white|black|green|red|blue|indigo|purple|orange)\)/;
      const files = talkSheets().concat(fs.readdirSync(t.templateRoot)
        .filter((f) => f.endsWith('.js')).map((f) => path.join(t.templateRoot, f)));
      for (const f of files) {
        for (const line of read(f).split('\n')) {
          const m = line.match(SCALES) || line.match(VALUES);
          if (m) {
            throw new Error(`${path.relative(t.dir, f)} asks for ${m[0]}, which names a ` +
              'colour rather than a job');
          }
        }
      }
    } },

  ];
}

module.exports = { talkChecks };
