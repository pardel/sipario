'use strict';

/* `layers: capture, trust` names the groups in the SVG to reveal, in
   order, one per step. The SVG marks them `<g class="layer"
   data-layer="name">`.

   A misspelt layer name is the failure worth guarding: nothing would
   throw, the group would simply never be hidden, and the slide would show
   the whole figure at step one while looking entirely normal. Both halves
   of the contract are checked in render.js before any of this runs. */

module.exports = {
  data({ meta, step, t }) {
    if (!meta.layers) return { layered: false };

    const names = t.figure.names(meta);
    /* An <img> was told `object-position: left center`, so a figure
       shorter than its box sat against the left edge and lined up with the
       heading above it. An inline svg centres itself instead, and nothing
       in CSS overrides that, so the same instruction has to be given as an
       attribute. Inlining without this quietly indented every layered
       figure. */
    const svg = t.figure.align(t.figure.read(meta.figure)).replace(
      /<g class="layer" data-layer="([^"]+)"/g,
      (m, name) => {
        const at = names.indexOf(name);
        return at > -1 && at > step ? m.replace('class="layer"', 'class="layer hidden-step"') : m;
      });

    /* The caption is the last reveal, so the picture is read before it is
       told what to make of it. */
    return { layered: true, svg, captionCls: step < names.length ? ' hidden-step' : '' };
  },
};
