'use strict';

/* A section slide opens a movement and is named by it.
 *
 * The word is the `# ` line above the slide, which the deck already
 * carries as `meta.group`. Declaring it again on the slide would be the
 * same string in two places; deriving it in the engine would be the
 * engine knowing what a template called `section` is for. A slide that
 * gives its `##` line a title of its own is saying something else, and
 * that title wins.
 *
 * The body is a line, and may go on to list what the movement holds:
 * one `- ` item per slide, in the order they come, numbered by the
 * template rather than in the deck so the two cannot disagree.
 */

exports.data = ({ meta, body }) => {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = lines.filter((l) => l.startsWith('- ')).map((l) => ({ text: l.slice(2).trim() }));
  return {
    word: meta.title || meta.group,
    line: lines.filter((l) => !l.startsWith('- ')).join('\n'),
    rows,
    listed: rows.length > 0,
  };
};
