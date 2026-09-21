'use strict';

/* The deck, exported: a PDF with a page per step, and a PowerPoint deck
 * with a picture per step and the script under each one.
 *
 * Both are photographs of the page the room sees, taken by a browser
 * already on the machine. Nothing is rendered again by a second engine:
 * the server that serves the talk is started on a port of its own, the
 * browser is pointed at its /print page, and what the printer prints and
 * the camera captures is the same markup, the same sheets and the same
 * fonts the deck runs on. The PDF cannot disagree with the room, and
 * neither can the pictures.
 *
 * A PowerPoint slide is a picture rather than text boxes, because a
 * template is HTML and CSS and there is no faithful translation of
 * either into what PowerPoint draws. What travels as text is the
 * script: every step's ```notes block, in the notes pane of its slide,
 * which is what the export is for.
 *
 * A step is a page. A build of four steps is four pages, each showing
 * what the room saw at that step, because that is what the deck is; a
 * reader who wants only the last step of each slide has the deck's
 * numbers in the corner to find it by.
 */

const fs = require('fs');
const path = require('path');
const { render, parse, identity, grouped, stepId, numberOf, notesText, slug } = require('./render.js');
const { talk } = require('./talk.js');
const { serve } = require('./server.js');
const { launch, findBrowser } = require('./browser.js');
const { pptx } = require('./pptx.js');

/** Every step of the deck in order, as the export sees it: its id, its
 *  slide's number and title, its place in the build, and its script as
 *  text. The deck is rendered first, so a deck the renderer refuses is
 *  refused here with the same message. */
function outline(src, t) {
  render(src, t);
  const deck = identity(src);
  const out = [];
  grouped(parse(src)).forEach((g, gi) => g.slides.forEach((sl, si) => sl.steps.forEach((st, k) => {
    out.push({
      id: stepId(sl, k),
      n: numberOf(gi, si, deck.from),
      group: g.name,
      title: sl.meta.title || '',
      step: k + 1,
      of: sl.steps.length,
      notes: notesText(st.note),
    });
  })));
  return out;
}

/* Run in the page once it has loaded: wait for its type and its figures,
   then read the stage's size off the root and where every slide sits.
   Page coordinates, so a screenshot can be clipped to a slide wherever
   the column has put it.

   A figure that fails to load is collected rather than waited past. The
   wait has to end on an error or a talk with one missing file would hang
   the export for ever, but ending it is not the same as ignoring it: an
   image that did not arrive leaves a hole in the picture, and a hole
   that nobody mentioned is exactly the quiet failure this library
   refuses everywhere else. One already complete when this runs is
   judged by its natural size, which is zero only when it failed. */
const MEASURE = `(async () => {
  await document.fonts.ready;
  const broken = new Set();
  await Promise.all([...document.images].map((i) => {
    if (i.complete) { if (!i.naturalWidth) broken.add(i.getAttribute('src')); return null; }
    return new Promise((r) => {
      i.onload = () => { if (!i.naturalWidth) broken.add(i.getAttribute('src')); r(); };
      i.onerror = () => { broken.add(i.getAttribute('src')); r(); };
    });
  }));
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => parseFloat(cs.getPropertyValue(v));
  return {
    w: px('--w'), h: px('--h'),
    broken: [...broken],
    slides: [...document.querySelectorAll('.slide')].map((s) => {
      const b = s.getBoundingClientRect();
      return { id: s.id, n: s.dataset.n,
               x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
    }),
  };
})()`;

/** Serve the talk, open its print page in a browser, hand `fn` the page
 *  and what was measured on it, and close both whatever happens. */
async function onPaper(dir, fn) {
  const t = talk(dir);
  const src = fs.readFileSync(t.deck, 'utf8');
  const r = render(src, t);
  const steps = outline(src, t);

  const quiet = { log() {}, warn() {}, error() {} };
  const server = serve(dir, { port: 0, log: quiet });
  await new Promise((ok) => (server.listening ? ok() : server.once('listening', ok)));
  const url = `http://127.0.0.1:${server.address().port}/print`;

  /* The browser is opened inside the try, because finding one can fail
     and a server left listening on a machine that has no browser would
     hold the port and go on watching the talk for the life of the
     process. The CLI exits either way; a library caller does not. */
  let browser = null;
  try {
    browser = await launch();
    await browser.page.open(url);

    /* The outline was read from deck.md here, and the page was rendered
       from deck.md again by the server when the browser asked for it. A
       save between the two reads pairs this draft's scripts with that
       draft's pictures, and an edit inside a ```notes block moves no id
       and changes no size, so nothing below would catch it. The page is
       loaded and its content is now fixed, so comparing the file against
       what the outline was built from closes the window. */
    if (fs.readFileSync(t.deck, 'utf8') !== src) {
      throw new Error('deck.md changed while the deck was being exported, so its pictures ' +
        'and its scripts would come from two different drafts. Run it again.');
    }

    const m = await browser.page.evaluate(MEASURE);
    if (!(m.w > 0 && m.h > 0)) {
      throw new Error(`the stage has no size: --w is ${m.w}, --h is ${m.h}`);
    }
    if (m.broken.length) {
      throw new Error(`the page could not load ${m.broken.join(', ')}, which would print as ` +
        'a hole in the slide; check the file is in the talk\'s images/ folder');
    }
    /* The page is the deck's own markup, so the two lists agree unless
       something between the renderer and the browser has gone wrong, and
       that is worth stopping for rather than pairing pictures with the
       wrong scripts. */
    const seen = m.slides.map((s) => s.id).join(' ');
    const want = steps.map((s) => s.id).join(' ');
    if (seen !== want) {
      throw new Error(`the print page shows ${m.slides.length} steps and the deck has ` +
        `${steps.length}; the page has [${seen}] and the deck [${want}]`);
    }
    /* A slide the talk's sheets hide on paper measures nothing, and a
       page that is not there is the failure this is for: the count would
       be short by one and every script after it paired with the wrong
       picture. */
    const off = m.slides.filter((s) => Math.round(s.width) !== Math.round(m.w) ||
                                       Math.round(s.height) !== Math.round(m.h));
    if (off.length) {
      throw new Error(`on paper ${off.map((s) => `${s.id} is ${s.width}x${s.height}`).join(', ')}, ` +
        `not the stage's ${m.w}x${m.h}: a rule in the talk's sheets sizes or hides it`);
    }
    return await fn({ page: browser.page, r, t, steps, slides: m.slides, w: m.w, h: m.h });
  } finally {
    if (browser) await browser.close();
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
  }
}

/* The file is named after the deck and lands in the current folder,
   never in the talk: the talk is watched and versioned, and an export is
   neither a source nor something to commit beside one. */
const named = (r, ext, out) => path.resolve(out || `${slug(r.deck.name)}.${ext}`);

/* What the PDF says of itself: every node of the page tree carries a
   /Count, and the root's is the whole document's. Read off the file
   rather than assumed from the deck, so a page that did not print is a
   failure here and not a surprise in the room. */
function pdfPages(buf) {
  const counts = [...buf.toString('latin1').matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

/** The deck as a PDF, one page per step, at the stage's size. Returns
 *  `{ file, pages, slides, steps, width, height }`. */
function exportPdf(dir, { out } = {}) {
  return onPaper(dir, async ({ page, r, steps, w, h }) => {
    const pdf = await page.pdf({ width: w / 96, height: h / 96 });
    const pages = pdfPages(pdf);
    if (pages !== steps.length) {
      throw new Error(`the PDF has ${pages} pages and the deck has ${steps.length} steps; ` +
        'a step that overflows its page, or a sheet that hides one, would do this');
    }
    const file = named(r, 'pdf', out);
    fs.writeFileSync(file, pdf);
    return { file, pages, slides: r.slides, steps: r.steps, width: w, height: h };
  });
}

/** The deck as a .pptx, one picture per step with its script in the
 *  notes. Returns `{ file, slides, steps }`. */
function exportPptx(dir, { out } = {}) {
  return onPaper(dir, async ({ page, r, steps, slides, w, h }) => {
    const pictures = [];
    for (const s of slides) pictures.push(await page.screenshot(s));
    const file = named(r, 'pptx', out);
    fs.writeFileSync(file, pptx({
      title: r.deck.title,
      width: w,
      height: h,
      slides: steps.map((st, i) => ({
        png: pictures[i],
        notes: st.notes,
        name: `${st.n}${st.title ? ' ' + st.title : ''}${st.of > 1 ? ` (step ${st.step} of ${st.of})` : ''}`,
        descr: `Slide ${st.n}${st.title ? ', ' + st.title : ''}, in ${st.group}` +
          (st.of > 1 ? `, step ${st.step} of ${st.of}` : ''),
      })),
    }));
    return { file, slides: steps.length, deckSlides: r.slides, steps: r.steps, width: w, height: h };
  });
}

module.exports = { outline, exportPdf, exportPptx, findBrowser, pdfPages };
