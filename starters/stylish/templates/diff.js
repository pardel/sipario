'use strict';

/* Splits the transcript into its three kinds of line so each can be
   coloured. Done here rather than in CSS because a `+` at the start of a
   line is not something a selector can see, and done here rather than by
   marking the lines up in deck.md because the whole point of the slide is
   that what is on it was pasted out of `git diff` unedited. */

const KIND = { '+': 'add', '-': 'del' };

module.exports = {
  data({ fenced }) {
    return {
      lines: fenced.split('\n').map((text) => ({
        /* A blank line is context, not a removal: `-` alone never opens
           one, and treating the empty string as a lookup would. */
        kind: KIND[text[0]] || 'same',
        text: text || ' ',
      })),
    };
  },
};
