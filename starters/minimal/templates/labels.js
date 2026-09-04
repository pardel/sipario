'use strict';

/* `- (ink) `name` gloss`. The ink names a palette token rather than a
   colour, so a deck restyled by swapping css/theme.css restyles these
   with it. An unknown ink is passed through as written, which lets a
   one-off be a one-off without inventing a token for it. */

const LABEL_ROW = /^-\s*\(([^)]+)\)\s*`([^`]+)`\s*(.*)$/;

/* The deck writes a colour word; what it means is a signal, and the token
   is named for the signal so a talk can recolour the scheme without every
   slide going on calling it green. */
const LABEL_INK = {
  green:  'var(--label-good)',
  slate:  'var(--label-quiet)',
  red:    'var(--label-bad)',
  indigo: 'var(--label-note)',
};

module.exports = {
  data({ body }) {
    return {
      rows: body.split('\n').map((l) => l.match(LABEL_ROW)).filter(Boolean)
        .map(([, ink, name, gloss]) => ({ ink: LABEL_INK[ink] || ink, name, gloss })),
    };
  },
};
