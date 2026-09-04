'use strict';

/* A row is a path and, where it earns one, a note. They are separated in
   the file by a run of two or more spaces, which is how the listing stays
   readable as a listing in deck.md rather than becoming a table.
   Indentation is kept: it is what makes a tree a tree. */

module.exports = {
  data({ fenced }) {
    return {
      rows: fenced.split('\n').map((line) => {
        /* The indent is taken off before the split and put back after,
           or a nested row's own leading spaces are read as the gap
           before its note and the path is lost. */
        const [, indent, rest] = line.match(/^([ \t]*)(.*)$/);
        const [path, note] = rest.split(/ {2,}/);
        return { path: indent + path.replace(/\s+$/, ''), note: (note || '').trim() };
      }),
    };
  },
};
