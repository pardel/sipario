'use strict';

/* Which row is first and which is last is decided here rather than left
   to `:first-of-type` in CSS. That selector counts element *types*, not
   classes, so putting anything else in a <div> ahead of the rows made the
   first row stop being the first div and grow a border it should not have
   had. The standfirst's height-holding box did exactly that. */

module.exports = {
  data({ bs, sub, lastStep, steps, t }) {
    /* The ghost is the *longest* standfirst on the slide, not the last
       one. Reserving from the last is only right when the last is the
       tallest: a slide that opens on two lines and ends on one laid its
       opening words over a one-line box and printed straight through the
       first row. Length stands in for height here, the measure and the
       type being the same on every step. */
    const ghost = (steps || [lastStep])
      .map((x) => t.standfirst(t.blocks(x.body)))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];

    /* Height is reserved from the slide's last step: every row the slide
       ends with is rendered, and the ones this step has not reached yet
       are hidden rather than absent, so nothing shifts as the build
       runs. */
    const list = t.items(bs);
    const reserve = t.items(t.blocks(lastStep.body));
    const key = (r) => JSON.stringify(r);
    const shown = new Set(list.map(key));
    const all = reserve.length ? reserve : list;

    const at = all.map((r, i) => (r.lead ? -1 : i)).filter((i) => i > -1);
    const firstRow = at[0];
    const lastRow = at[at.length - 1];
    const firstLead = all.findIndex((r) => r.lead);

    const rows = all.map((r, i) => {
      const hide = shown.has(key(r)) ? '' : ' hidden-step';
      if (r.lead) return { lead: r.lead, cls: (i === firstLead ? ' first' : '') + hide };
      return {
        tag: r.tag, head: r.head, body: r.body,
        cls: (i === firstRow ? ' first' : '') + (i === lastRow ? ' last' : '') + hide,
      };
    });

    return {
      ghost,
      plainSub: Boolean(ghost) && sub === ghost,
      boxedSub: Boolean(ghost) && sub !== ghost,
      rows,
    };
  },
};
