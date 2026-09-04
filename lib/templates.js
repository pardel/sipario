'use strict';

/* Loading a talk's templates.
 *
 * They belong to the talk, not to this engine. What a slide rendered by a
 * given template looks like is a design decision the talk owns the same
 * way it owns its words and its figures, so every talk carries its own
 * `templates/` folder beside its `deck.md` and its images. Nothing
 * here ships a default set: a talk with no templates has not said what
 * its slides look like, and guessing on its behalf would be the engine
 * deciding the design.
 *
 * A template is `<name>.html`: the markup, with placeholders, read exactly
 * as written. Beside it, optionally, `<name>.js` exporting `data(ctx)`,
 * for the templates whose values have to be worked out rather than looked
 * up.
 *
 * Discovered rather than listed, so nothing in render.js names one.
 * Discovery is not a build step: nothing is generated and nothing is
 * written to disk, a folder is read once per talk.
 *
 * What a template is handed, and the placeholder syntax: docs/TEMPLATES.md.
 */

const fs = require('fs');
const path = require('path');
const { compile } = require('./engine.js');

/* One talk's templates are read and compiled once, however many times it
   is rendered. Keyed by folder, so serving two talks at once is fine. */
const cache = new Map();

/* A template of the wrong shape is a slide that renders plausibly and
 * wrongly, which is the failure this dialect was hand-parsed to avoid. So
 * every file is compiled at load, not at the moment a deck happens to use
 * that one: an unclosed section in a template nobody reached would
 * otherwise surface in a room. */
function read(dir, filters, indent) {
  if (!fs.existsSync(dir)) {
    throw new Error(`no templates/ folder at ${dir}. A talk carries its own; ` +
      `\`sipario new\` starts one that has them.`);
  }
  const templates = {};

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.html')) continue;
    const name = path.basename(file, '.html');
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const js = path.join(dir, `${name}.js`);

    let data = null;
    if (fs.existsSync(js)) {
      const mod = require(js);
      if (typeof mod.data !== 'function') {
        throw new Error(`templates/${name}.js exports no data function`);
      }
      data = mod.data;
    }

    const fill = compile(src, `templates/${file}`, filters, indent);
    templates[name] = { name, data, fill, uses: fill.uses };
  }

  const names = Object.keys(templates).sort();

  /* A .js with no .html beside it is a template that will never render,
     and
     the likeliest cause is a renamed template, so it is named rather than
     ignored. */
  const orphan = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.basename(f, '.js'))
    .filter((k) => !names.includes(k));
  if (orphan.length) {
    throw new Error(`${dir}: ${orphan.map((k) => `${k}.js`).join(', ')} ` +
      `${orphan.length > 1 ? 'have' : 'has'} no matching .html`);
  }

  /** The one place a template this talk has no file for is refused, so the
      message names what it does have. */
  function templateFor(name) {
    const t = templates[name];
    if (!t) {
      throw new Error(`no template named "${name}" (this talk has: ${names.join(', ')})`);
    }
    return t;
  }

  return { templates, names, templateFor };
}

/** A talk's templates, compiled. `filters` is the deck's own text handling. */
function load(dir, filters = {}, indent = '') {
  const key = path.resolve(dir);
  if (!cache.has(key)) cache.set(key, read(key, filters, indent));
  return cache.get(key);
}

module.exports = { load };
