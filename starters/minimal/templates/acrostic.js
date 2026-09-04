'use strict';

/* Rows read `- **G** Ground — every claim carries its source`. */

const ACROSTIC_ROW = /^-\s*\*\*(.+?)\*\*\s*(.+?)\s+—\s+(.*)$/;

module.exports = {
  data({ body }) {
    return {
      rows: body.split('\n').map((l) => l.match(ACROSTIC_ROW)).filter(Boolean)
        .map(([, letter, word, gloss]) => ({ letter, word, gloss })),
    };
  },
};
