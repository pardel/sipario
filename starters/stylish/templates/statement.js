'use strict';

/* Every paragraph but the last is a line the room has already been given;
   the last is the one landing now. They are set identically, because the
   pair has to read as a build rather than a swap.

   Height is reserved from the slide's last step, as an icon list's rows
   are: the lines this step has not reached are rendered and hidden, not
   left out. */

module.exports = {
  data({ bs, lastStep, t }) {
    const here = bs.filter((b) => !b.trim().startsWith('>'));
    const all = t.blocks(lastStep.body).filter((b) => !b.trim().startsWith('>'));
    return {
      lines: all.map((p, k) => ({
        cls: (k === all.length - 1 ? 'statement-line' : 'statement-carry') + (k < here.length ? '' : ' hidden-step'),
        text: p.trim(),
      })),
    };
  },
};
