'use strict';

/* The smallest template language the nine templates need.
 *
 * Markup belongs in markup. A template's HTML is templates/<name>.html, read
 * as it is written: nothing is trimmed, re-indented or normalised, so
 * what the file holds is what the slide gets. That matters more here than
 * it usually would, because a build reserves its height from markup that
 * is present and hidden, and whitespace inside a <pre> is the slide.
 *
 * Deliberately not mustache, and deliberately not a dependency. The same
 * reasoning the deck's own dialect was hand-parsed under applies: a
 * general engine would have to be fought back into these nine shapes, and
 * the failure mode of fighting it is a slide that renders plausibly and
 * wrongly.
 *
 * **A template is formatted for whoever reads it.** Indent it, group it,
 * leave blank lines between the parts: none of that reaches the slide. A
 * run of whitespace containing a newline becomes one newline and the
 * output's own indentation, so how the file is laid out and how the HTML
 * comes out are independent, and a template can be made readable without
 * anyone having to check what it did to the markup.
 *
 * A run of spaces with no newline in it is left exactly as written,
 * because that is the whitespace that can matter: the gap between two
 * inline elements is a space, and losing it would run two words together.
 * A newline between block elements never mattered and now says nothing.
 *
 * Values are never touched. A fenced transcript and an inlined SVG go in
 * as they came, which is the whole point of a <pre>: their own newlines
 * are held aside while the layout is settled and put back after, so a
 * blank line in a transcript survives and a blank line left by a section
 * that rendered nothing does not.
 *
 *   {{path}}              a value, escaped
 *   {{path|inline}}       a value through a named filter
 *   {{path|raw}}          a value already HTML, inserted as it is
 *   {{#path}}...{{/path}} once if truthy; once per item if an array
 *   {{^path}}...{{/path}} once if falsy or empty
 *   {{! a comment }}      dropped
 *
 * A section over an array may say how to join its items:
 *
 *   {{#rows join="\n"}}...{{/rows}}
 *
 * which is the one thing plain mustache cannot express and every list on
 * a slide needs, the separator between rows being significant and the one
 * after the last row not being wanted. The `\n` lands the next row where
 * the section tag itself sits, so a list nested two deep needs no count of
 * spaces written into it.
 *
 * Inside a section an object's fields are in scope, and so are the
 * enclosing scopes, innermost first.
 */

const TAG = /\{\{([!#^/&]?)\s*([^}]*?)\s*\}\}/g;

/* A comment with only whitespace either side of it on its line, and the
   newline that ends it. Everything else in the file survives verbatim. */
const LONE_COMMENT = /(^|\n)[ \t]*\{\{![\s\S]*?\}\}[ \t]*\n/g;

/* Only what a template file can legally contain, spelled out, so a typo
   in a filter name stops the render rather than printing "undefined". */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

function unescapeAttr(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

/* Whitespace with a newline in it is the author's formatting; whitespace
   without one may be part of the markup. Only the first is rewritten.
   A run of several newlines is one break: blank lines are for reading. */
const BREAK = /[ \t]*(?:\r?\n[ \t]*)+/g;

/** How far the template as a whole is indented, which is the author's
    business, as against how far one line is indented past that, which is
    the markup nesting and worth keeping. The first line is excluded: it
    sits against the margin by construction and would make the base 0. */
function baseIndent(src) {
  const rest = src.split('\n').slice(1).filter((l) => l.trim());
  return rest.length ? Math.min(...rest.map((l) => l.match(/^[ \t]*/)[0].length)) : 0;
}

/** Lay a run of text out: every break becomes one newline, the output's
    own indentation, and whatever nesting the author had past their own
    base. Spaces without a newline are markup and survive untouched. */
function lay(text, indent, base) {
  return text.replace(BREAK, (run) => {
    const had = run.length - run.lastIndexOf('\n') - 1;
    return `\n${indent}${' '.repeat(Math.max(0, had - base))}`;
  });
}

function parse(raw, where, indent = '') {
  const src = raw.replace(LONE_COMMENT, '$1');
  const base = baseIndent(src);
  const root = { body: [] };
  const stack = [root];
  let at = 0;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src))) {
    const [tag, sigil, rest] = m;
    const top = stack[stack.length - 1];
    if (m.index > at) top.body.push({ t: 'text', v: lay(src.slice(at, m.index), indent, base) });
    at = m.index + tag.length;

    if (sigil === '!') continue;

    if (sigil === '/') {
      if (stack.length === 1) throw new Error(`${where}: {{/${rest}}} closes nothing`);
      const open = stack.pop();
      if (open.key !== rest) {
        throw new Error(`${where}: {{#${open.key}}} is closed by {{/${rest}}}`);
      }
      continue;
    }

    if (sigil === '#' || sigil === '^') {
      const [, key, attrs = ''] = rest.match(/^(\S+)\s*(.*)$/);
      const join = attrs.match(/\bjoin="([^"]*)"/);
      /* A break in the separator is laid out like any other: to where this
         section tag sits, so a nested list does not carry a count of
         spaces that the output's indentation could make wrong. */
      const here = top.body[top.body.length - 1];
      const after = here && here.t === 'text' ? here.v.slice(here.v.lastIndexOf('\n') + 1) : '';
      const at = /^[ \t]*$/.test(after) ? after : '';
      const node = { t: 'sec', key, inverted: sigil === '^',
                     join: join ? unescapeAttr(join[1]).replace(/\n[ \t]*/g, `\n${at}`) : '',
                     body: [] };
      top.body.push(node);
      stack.push(node);
      continue;
    }

    const [key, filter = 'escape'] = rest.split('|').map((x) => x.trim());
    top.body.push({ t: 'var', key, filter, tag, where });
  }
  if (at < src.length) stack[stack.length - 1].body.push({ t: 'text', v: lay(src.slice(at), indent, base) });
  if (stack.length > 1) {
    throw new Error(`${where}: {{#${stack[stack.length - 1].key}}} is never closed`);
  }
  return root.body;
}

/** Innermost scope first, so a row's own field beats the slide's. */
function lookup(key, scopes) {
  if (key === '.') return scopes[scopes.length - 1];
  const parts = key.split('.');
  for (let i = scopes.length - 1; i >= 0; i--) {
    let v = scopes[i];
    let ok = true;
    for (const p of parts) {
      if (v == null || !(typeof v === 'object') || !(p in v)) { ok = false; break; }
      v = v[p];
    }
    if (ok) return v;
  }
  return undefined;
}

/* A value's own newlines are not layout and must survive the tidying
   below, so they are held aside while it happens. */
const HELD = '\u0000';

function run(nodes, scopes, filters) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') { out += n.v; continue; }

    const v = lookup(n.key, scopes);

    if (n.t === 'var') {
      const f = filters[n.filter];
      if (!f) throw new Error(`${n.where}: ${n.tag} names no filter "${n.filter}"`);
      out += v == null ? '' : f(v).split('\n').join(HELD);
      continue;
    }

    const empty = Array.isArray(v) ? v.length === 0 : !v;
    if (n.inverted) { if (empty) out += run(n.body, scopes, filters); continue; }
    if (empty) continue;

    if (Array.isArray(v)) {
      out += v.map((item) => run(n.body, scopes.concat([item]), filters)).join(n.join);
    } else {
      out += run(n.body, scopes.concat([typeof v === 'object' ? v : {}]), filters);
    }
  }
  return out;
}

/** Every path a template mentions, sections and values alike. Callers use
    it to tell a template that ignores something from one that wants it. */
function reaches(nodes, into = new Set()) {
  for (const n of nodes) {
    if (n.t === 'text') continue;
    into.add(n.key);
    if (n.t === 'sec') reaches(n.body, into);
  }
  return into;
}

/** Compile once, render many. Templates are read at startup and reused.
    `indent` is what each line of the output is laid out to; the template's
    own indentation is the author's and never reaches the slide. */
function compile(src, where, filters, indent = '') {
  const nodes = parse(src, where, indent);
  /* Trimmed: the first and last newlines are where the author put the
     markup on its own line, not part of the slide. */
  const fill = (data) => run(nodes, [data], { escape, raw: String, ...filters })
    /* A section that rendered nothing leaves the breaks either side of it
       against each other. The blank line is the author's formatting
       showing through, not markup, so it goes. */
    .replace(/\n[ \t]*(?=\n)/g, '')
    .split(HELD).join('\n')
    .trim();
  fill.uses = reaches(nodes);
  return fill;
}

module.exports = { compile, parse, escape };
