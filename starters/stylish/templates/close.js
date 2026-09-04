'use strict';

module.exports = {
  /* The separators are made non-breaking so the colophon never wraps
     between a name and the dot after it. Nothing else on this slide is
     peculiar to it: the links are `pairs`, which any template can ask for. */
  data({ meta, t }) {
    return { colophon: t.esc(meta.colophon || '').replace(/ · /g, ' &nbsp;·&nbsp; ') };
  },
};
