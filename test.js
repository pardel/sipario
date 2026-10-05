'use strict';

/* sipario's own suite, run against starters/minimal.
 *
 * The example is the fixture. It is the shortest talk that uses every
 * template it defines, and it is the folder somebody copies to start a
 * second one, so a check that breaks here breaks the thing a stranger
 * would have started from rather than being found in a room.
 *
 * The DOM half exists because the deck's layout is decided at runtime by
 * fit(), so a static render says nothing about it. Two bugs shipped that
 * way: the slide off-centre when stacks became grid items, and the slide
 * unscaled when a leftover call to a deleted function killed the script
 * on its first line. Both are one assertion here.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { render, talk, talkChecks, scaffold } = require('./index.js');

const ROOT = __dirname;
const TALK = talk(path.join(ROOT, 'starters/minimal'));

/* A room's sessions are written to the machine's data folder. Every
   check, and every process a check starts, writes to a scratch one
   instead: the suite leaves nothing among the owner's real sessions. */
process.env.SIPARIO_DATA = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-data-'));
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

/* A deck written for one check names itself like any other, and renders
   against the example's templates. */
const D = 'name: T\n\n';
const R = (src) => render(D + src, TALK);

// ------------------------------------------------------------- the page

const { html, slides, steps, deck } = render(fs.readFileSync(TALK.deck, 'utf8'), TALK);
/* Every sheet, in the order the server links them: the frame, the talk's
   own, then one per template, each of which may replace what came before. */
const talkCss = () => [TALK.deckCss].concat(
  fs.readdirSync(TALK.templateRoot).filter((f) => f.endsWith('.css')).sort()
    .map((f) => path.join(TALK.templateRoot, f)))
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const css = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8') + talkCss();
const js = fs.readFileSync(path.join(ROOT, 'js/deck.js'), 'utf8');
/* Loaded first on the deck's page and the notes', as the server loads it;
   the phone's page does without. */
const eventsJs = fs.readFileSync(path.join(ROOT, 'js/events.js'), 'utf8');
const phoneJs = fs.readFileSync(path.join(ROOT, 'js/phone.js'), 'utf8');

/* An event stream with no server behind it. A check speaks for the
   server with `emit(name, data)`: an event by name reaches whatever
   listens for that name, and `message` reaches `onmessage` too, as it
   does in a browser. Closing it lets go of whatever the check wired it
   to, as the server's end does when a page goes. */
function fakeStream(streams) {
  return function (url) {
    const heard = {};
    this.url = url;
    this.readyState = 1;
    this.addEventListener = (name, fn) => { (heard[name] = heard[name] || []).push(fn); };
    this.emit = (name, data) => {
      const ev = { type: name, data: typeof data === 'string' ? data : JSON.stringify(data) };
      if (name === 'message' && this.onmessage) this.onmessage(ev);
      for (const fn of heard[name] || []) fn(ev);
    };
    this.close = () => { if (this.off) this.off(); this.off = null; this.readyState = 2; };
    streams.push(this);
  };
}

/* What the browser does once the page's scripts have run. */
const parsed = (w) => w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

/* The runtime reads the talk's name off this attribute, so every page the
   suite builds carries it exactly as the served page does. */
const MAIN = `<main id="deck" data-deck="${deck.key}">${html}</main>`;

/* A page with the deck in it and the runtime not yet run, plus the
   handles the checks drive it by. Two are built: the starter as served,
   and a small deck of three movements for the checks that move between
   movements, which the starter, being one movement, cannot exercise.

   Marks persist across Home, deliberately, so a check that cares about
   where left and right land has to start from a deck that has forgotten
   them. R twice is the only way to say that, which is itself a check
   that the reset works. It lands on the first slide as well, so nothing
   has to be done before it. */
function harness(main) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${css}</style></head><body>
     ${main}
     <div id="progress"><div id="progress-bar"></div></div>
     </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:9999/',
      virtualConsole: vc });
  const { window } = dom;
  /* No server in a test. What the page asks for is kept, so a check can
     say what a deck reached for as well as what it did. */
  const streams = [];
  const opened = streams;
  const fetched = [];
  window.EventSource = fakeStream(streams);
  window.fetch = (url) => { fetched.push(url); return Promise.reject(new Error('no network in a test')); };
  window.open = () => ({ closed: false, focus() {}, close() { this.closed = true; } });
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  const doc = window.document;
  const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k }));
  return {
    window, doc, errors, opened, fetched,
    current: () => doc.querySelector('.slide.current'),
    key,
    forget: () => { key('r'); key('r'); },
  };
}

/* Three movements: a title, a movement whose slides run down under a
   section, two of them builds, and a close. Just enough shape for left,
   right, down and up to have somewhere to go. */
const MOVES_SRC = `name: Moves

# Title

## 1.1 Three movements
id: 1-three-movements
template: title
subtitle: A deck for the checks that move between movements
author: The suite

\`\`\`notes
The first movement holds one slide.
\`\`\`

# Middle

## 2.1
id: 2-middle
template: section
letter: M

Three slides, two of them builds.

\`\`\`notes
The section opens the second movement.
\`\`\`

## 2.2
id: 2-one-line-then-two
template: statement

One line.

\`\`\`notes
A build's first step.
\`\`\`

--

Then two.

\`\`\`notes
And its second.
\`\`\`

## 2.3 Rows
id: 2-rows
template: icon-list
align: spread

- (check) **One**
  The first row.

\`\`\`notes
A second build.
\`\`\`

--

- (check) **One**
  The first row.
- (folder) **Two**
  The second row.

\`\`\`notes
Its second step.
\`\`\`

## 2.4 Labels
id: 2-labels
template: labels

- (green) \`ok\` fine

\`\`\`notes
A plain slide after the builds.
\`\`\`

# Close

## 3.1 END
id: 3-end
template: close
colophon: the suite

> Where it ends

- \`a\`
  b

\`\`\`notes
The last movement holds one slide.
\`\`\`
`;
const MOVES_DECK = render(MOVES_SRC, TALK);
const MOVES_MAIN = `<main id="deck" data-deck="${MOVES_DECK.deck.key}">${MOVES_DECK.html}</main>`;

const fixture = harness(MAIN);
const MOVES = harness(MOVES_MAIN);
const { window, errors, doc, current, key, forget } = fixture;

console.log(`deck: ${slides} slides, ${steps} steps`);

check('deck.js runs without throwing', () => {
  window.eval(eventsJs);
  window.eval(js);
  parsed(window);
  if (errors.length) throw new Error(errors[0].detail || errors[0].message);
});

check('and runs on a deck of three movements', () => {
  MOVES.window.eval(eventsJs);
  MOVES.window.eval(js);
  parsed(MOVES.window);
  if (MOVES.errors.length) throw new Error(MOVES.errors[0].detail || MOVES.errors[0].message);
});

// ------------------------------------------------------------ the checks

check('exactly one slide is current', () => {
  eq(doc.querySelectorAll('.slide.current').length, 1, 'current slides');
});

check('the current slide is scaled to fit the window', () => {
  /* fit() hands the scale to the stylesheet as --k, and the stylesheet's
     own rule applies it, so a slide can be animated across the window by
     a rule that still knows its size. */
  const k = Number(current().style.getPropertyValue('--k'));
  if (!k) throw new Error(`no --k on the slide: ${JSON.stringify(current().getAttribute('style'))}`);
  const want = Math.min(1600 / 1280, 900 / 720);        // 1.25
  if (Math.abs(k - want) > 0.001) throw new Error(`scale ${k}, expected ${want}`);
  const rule = css.match(/\n\.slide \{[^}]*\}/)[0];
  if (!/transform: translate\(-50%, -50%\) scale\(var\(--k/.test(rule)) {
    throw new Error('the frame does not scale the slide by --k');
  }
});

check('the current slide is centred', () => {
  /* left/top come from the stylesheet and fit() clears its own inline
     copies, so the computed value is the one that decides where the
     slide lands. Asserting the inline style would pass on a deck that
     renders in the corner. */
  const el = current();
  const c = window.getComputedStyle(el);
  eq(c.left, '50%', 'computed left');
  eq(c.top, '50%', 'computed top');
  if (el.style.transform) throw new Error(`an inline transform is back: ${el.style.transform}`);
});

check('the compass sits by the slide\'s bottom-right corner, outside it when there is room', () => {
  /* Pinned to a corner of the window it straddled the letterbox edge
     wherever that fell. Its place is now computed from the slide's box:
     1600x900 is a true 16:9, so the slide fills the window and the compass
     tucks inside the corner; a wider window has a band beside the slide,
     and the compass moves out onto it. */
  const c = doc.getElementById('compass');
  const size = () => ({ left: parseFloat(c.style.left), top: parseFloat(c.style.top) });
  window.dispatchEvent(new window.Event('resize'));
  let at = size();
  eq(c.classList.contains('outside'), false, 'a 16:9 window leaves no room outside');
  if (!(at.left + 84 <= 1600 && at.left > 1600 - 200)) throw new Error(`inside, but at ${at.left}`);
  if (!(at.top + 84 <= 900 && at.top > 900 - 200)) throw new Error(`inside, but at ${at.top} down`);
  /* The slide's number rides in the middle of the arrows, and follows. */
  forget();
  eq(c.querySelector('.cnum').textContent, '1.1', 'the number in the centre is the first slide\'s');
  key('ArrowRight');
  eq(c.querySelector('.cnum').textContent, current().dataset.n, 'and it follows the deck');

  Object.defineProperty(window, 'innerWidth', { value: 2400, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  at = size();
  eq(c.classList.contains('outside'), true, 'a wider window has a band beside the slide');
  if (!(at.left >= 2000)) throw new Error(`outside on the right, but at ${at.left} with the slide ending at 2000`);
  if (Math.round(at.top + 84) !== 900) throw new Error(`aligned with the slide's foot, but ending at ${at.top + 84}`);

  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
});

check('a slide arrives from the direction it was reached, and a step does not move', () => {
  /* The direction rides on the arriving slide as data-enter and the
     stylesheet animates the stage from that side. Movements are left and
     right, slides within one are down and up, and a step within a build
     carries nothing, because a build must not shift. */
  const { doc, current, key, forget } = MOVES;
  const leaving = () => doc.querySelector('.slide.leaving');
  forget();
  key('ArrowRight');
  eq(current().dataset.enter, 'right', 'the next movement comes from the right');
  eq(leaving() && leaving().dataset.n, '1.1', 'and the one left stays on for the run');
  eq(leaving().dataset.leave, 'right', 'going out the way the deck moved');
  key('ArrowDown');
  eq(current().dataset.enter, 'down', 'the next slide comes from below');
  eq(leaving() && leaving().dataset.n, '2.1', 'the earlier leaver is put away when the next move comes');
  key('ArrowDown');
  eq(current().dataset.n, '2.2', 'still on the build');
  eq(current().dataset.enter, undefined, 'its next step does not move');
  eq(current().parentNode.querySelector('.slide.leaving'), null, 'and no step of it is leaving');
  key('ArrowLeft');
  eq(current().dataset.enter, 'left', 'the previous movement comes from the left');
  key('End');
  eq(current().dataset.enter, 'right', 'a jump forward comes from the right');
  key('Home');
  eq(current().dataset.enter, 'left', 'and a jump back from the left');
  const ins = css.match(/\.slide\.current\[data-enter="(right|left|down|up)"\]\s+\{[^}]*animation:/g) || [];
  const outs = css.match(/\.slide\.leaving\[data-leave="(right|left|down|up)"\]\s+\{[^}]*animation:/g) || [];
  eq(ins.length, 4, 'the frame brings a slide in from all four directions');
  eq(outs.length, 4, 'and carries one out to all four');
  eq(/prefers-reduced-motion: reduce\)\s*\{\s*\.slide\[data-enter\], \.slide\.leaving \{\s*animation: none/.test(css), true,
     'and none of it for someone who asked for less motion');
});

check('the minimap draws the talk\'s shape and marks the slide you are on', () => {
  const { doc, key, forget } = MOVES;
  const mm = doc.getElementById('minimap');
  eq(doc.body.classList.contains('minimap'), true, 'on to begin with');
  key('m');
  eq(doc.body.classList.contains('minimap'), false, 'M hides it');
  key('m');
  eq(doc.body.classList.contains('minimap'), true, 'and M again shows it');
  const cols = [...mm.querySelectorAll('.mm-col')].map((c) => c.querySelectorAll('.mm-cell').length);
  eq(cols.join(' '), '1 4 1', 'a column per movement, a cell per slide');
  eq(mm.querySelectorAll('.mm-cell.build').length, 2, 'the two builds are marked');
  forget();
  const on = () => { const c = mm.querySelector('.mm-cell.on'); return c.dataset.g + '.' + c.dataset.s; };
  eq(on(), '0.0', 'the title is lit');
  key('ArrowRight');
  eq(on(), '1.0', 'then the next movement\'s first slide');
  key('ArrowDown');
  eq(on(), '1.1', 'then the slide below it');
  key('ArrowDown');
  eq(on(), '1.1', 'and a step within it moves nothing');
  eq(mm.querySelectorAll('.mm-cell.on').length, 1, 'one cell lit');
  key('m');
  eq(doc.body.classList.contains('minimap'), false, 'M again hides it');
});

check('the minimap\'s lit cell fills as a build plays, and stands the dots down', () => {
  const { doc, key, forget } = MOVES;
  const mm = doc.getElementById('minimap');
  const fill = () => mm.querySelector('.mm-cell.on').style.getPropertyValue('--fill');
  forget();
  eq(fill(), '100%', 'a slide that does not animate is lit whole');
  key('ArrowRight');
  key('ArrowDown');
  eq(fill(), '50%', 'step one of a two-step build lights half the cell');
  key('ArrowDown');
  eq(fill(), '100%', 'and the last step lights all of it');
  eq(/\.mm-cell\.on\s*\{[^}]*var\(--fill/.test(css), true, 'the lit cell is painted from --fill');
  eq(/body\.minimap #steps\s*\{\s*display:\s*none/.test(css), true,
     'the dots stand down while the map is showing');
});

check('the compass lights only the live directions', () => {
  const { window, doc, current, key, forget } = MOVES;
  /* Left and right are the movements; down and up are the slides inside
     one. The deck opens on a movement of one slide of one step, so only
     forward exists. */
  const live = (d) => doc.querySelector('.cdir-' + d).classList.contains('live');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
  eq(live('right'), true, 'right on slide 1: there are later movements');
  eq(live('down'), false, 'down on slide 1: its movement holds one slide of one step');
  eq(live('left'), false, 'left on slide 1');
  eq(live('up'), false, 'up on slide 1');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End' }));
  eq(live('right'), false, 'right on the last slide');
  eq(live('down'), false, 'down on the last slide');
  eq(live('left'), true, 'left on the last slide');
  eq(live('up'), false, 'up on the last slide: its movement holds only it');
});

check('space does nothing', () => {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
  const before = current();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
  eq(current(), before, 'space moved the deck');
});

check('the arrows alone reach every step, in order', () => {
  /* Down reads a movement; right crosses to the next one. Between them
     they have to reach every step without space, or removing it left
     part of the talk unreachable from the keys that remain. */
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
  const seen = [current()];
  for (let i = 0; i < steps * 3; i++) {
    const before = current();
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    if (current() === before) {
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    }
    const el = current();
    if (el !== seen[seen.length - 1]) seen.push(el);
  }
  eq(seen.length, steps, 'steps reachable by the arrows alone');
  eq(seen[seen.length - 1], doc.querySelectorAll('.slide')[steps - 1], 'ending on the close');
});

check('PageDown still reads the whole talk, for a clicker', () => {
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
  const seen = [current()];
  for (let i = 0; i < steps * 2; i++) {
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'PageDown' }));
    const el = current();
    if (el !== seen[seen.length - 1]) seen.push(el);
  }
  eq(seen.length, steps, 'steps reachable by PageDown');
});

check('the step indicator tracks a build and is absent elsewhere', () => {
  const { window, doc, current, key, forget } = MOVES;
  const el = doc.querySelector('#steps');
  forget();
  eq(el.children.length, 0, 'dots on slide 1, which does not animate');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));   // 2.1
  eq(doc.querySelector('.slide.current').dataset.n, '2.1', 'right reached 2.1');
  eq(el.children.length, 0, 'no dots on the section, which does not animate');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));    // 2.2
  eq(doc.querySelector('.slide.current').dataset.n, '2.2', 'down reached 2.2');
  eq(el.children.length, 2, 'dots on the build');
  eq(el.querySelectorAll('.on').length, 1, 'filled dots at step 1');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  eq(el.querySelectorAll('.on').length, 2, 'filled dots at step 2');
});

check('down steps a build, then carries on down the movement', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  const dots = () => doc.querySelector('#steps').querySelectorAll('.on').length;
  forget();
  key('ArrowRight');                         // a movement with slides under it
  eq(n(), '2.1', 'at the top of a movement that reads downward');
  key('ArrowDown');
  eq(n(), '2.2', 'down reached the animating slide');
  eq(dots(), 1, 'on its first step');
  key('ArrowDown');
  eq(n(), '2.2', 'down stepped the build rather than leaving the slide');
  eq(dots(), 2, 'and reached its second step');
  key('ArrowDown');
  eq(n(), '2.3', 'down again moves on, the build being finished');
});

check('up returns to the finished slide, not its first step', () => {
  const { window, doc, current, key, forget } = MOVES;
  forget();
  key('ArrowRight');                         // 2.1
  key('ArrowDown');                          // 2.2, step 1
  key('ArrowDown');                          // 2.2, step 2
  key('ArrowDown');                          // 2.3
  eq(current().dataset.n, '2.3', 'moved on past the build');
  key('ArrowUp');
  eq(current().dataset.n, '2.2', 'back to the build');
  eq(doc.querySelector('#steps').querySelectorAll('.on').length, 2,
     'and to the state the room had already seen');
});

check('left and right move by movement, down and up read within one', () => {
  const { window, doc, current, key, forget } = MOVES;
  /* A slide's number is its movement and its place in it, so the moves
     are legible in the numbers themselves. */
  const n = () => current().dataset.n;
  forget();
  eq(n(), '1.1', 'start');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  eq(n(), '1.1', 'down does nothing: the first movement holds one slide of one step');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(n(), '2.1', 'right opens the second movement');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(n(), '3.1', 'right again opens the third');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  eq(n(), '2.1', 'left returns to the top of the second');
});

check('a slide number is its section and its place in it', () => {
  doc.querySelectorAll('#deck .group').forEach((gEl, gi) => {
    [...gEl.querySelectorAll('.stack')].forEach((st, si) => {
      const want = `${gi + 1}.${si + 1}`;
      eq(st.dataset.n, want, 'the stack');
      /* Every step of a build carries its slide's number. */
      st.querySelectorAll('.slide').forEach((el) => eq(el.dataset.n, want, `steps of ${want}`));
    });
  });
});

check('the deck is grouped into its movements', () => {
  const { parse, grouped } = require('./lib/render.js');
  const gs = grouped(parse(MOVES_SRC));
  eq(gs.length, 3, 'groups');
  eq(gs.map((g) => g.name).join('|'), 'Title|Middle|Close', 'group names');
  /* The two slides the room arrives and leaves on each stand alone. */
  eq(gs[0].slides.length, 1, 'the title is its own movement, of one');
  eq(gs[0].slides[0].meta.template, 'title', 'and it is the title slide');
  eq(gs[gs.length - 1].slides.length, 1, 'the close is its own movement, of one');
  eq(gs[gs.length - 1].slides[0].meta.template, 'close', 'and it is the close slide');
  eq(gs.reduce((a, g) => a + g.slides.length, 0), MOVES_DECK.slides, 'every slide is in a group');
});

check('a slide under no movement stops the render', () => {
  const src = fs.readFileSync(TALK.deck, 'utf8').replace('\n# Title\n', '\n');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('a deck whose first slide sits under no `# ` line rendered anyway');
  if (!/slide 1 is in no movement/.test(threw.message)) {
    throw new Error(`unhelpful message: ${threw.message}`);
  }
});

check('grouping does not disturb slide order', () => {
  const { doc } = MOVES;
  const gEls = doc.querySelectorAll('#deck .group');
  eq(gEls.length, 3, 'group elements');
  eq(gEls[0].dataset.group, 'Title', 'first group');
  eq(gEls[0].querySelector('.group-name').textContent, 'Title', 'the map heading');
  const order = [...doc.querySelectorAll('#deck .slide')].map((s) => s.dataset.n);
  eq(order[0], '1.1', 'first slide');
  eq(order[order.length - 1], '3.1', 'last slide');
  const key = (n) => n.split('.').map(Number);
  for (let i = 1; i < order.length; i++) {
    const [a, b] = key(order[i - 1]), [c, d] = key(order[i]);
    if (c < a || (c === a && d < b)) {
      throw new Error(`out of order at ${i}: ${order[i - 1]} then ${order[i]}`);
    }
  }
});

check('the map can label the slide you are on', () => {
  const { window, doc, current, key, forget } = MOVES;
  /* The number in the map comes from `.stack[data-n]` through CSS, and
     the teal marking from this class. Both are on the stack, outside the
     scaled box, because the number inside a slide is a sixth of a pixel
     tall at map scale. */
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
  const marked = doc.querySelectorAll('.stack.current-stack');
  eq(marked.length, 1, 'stacks marked current');
  eq(marked[0].dataset.n, '1.1', 'the marked stack');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End' }));
  const last = doc.querySelectorAll('.stack.current-stack');
  eq(last.length, 1, 'still exactly one marked');
  eq(last[0].dataset.n, '3.1', 'the marked stack at the end');
});

check('Enter shows the slide the map has selected', () => {
  /* The map is a chooser, not just a picture: the arrows move the
     selection inside it and Enter is how you say "that one". Without
     Enter the only way to leave the map on a chosen slide was the mouse,
     which is the one thing you do not have on a stage. */
  forget();
  key('o');
  eq(doc.body.classList.contains('overview'), true, 'O opened the map');
  key('ArrowRight'); key('ArrowRight'); key('ArrowDown');
  eq(doc.body.classList.contains('overview'), true, 'the arrows leave the map open');
  const chosen = current();
  key('Enter');
  eq(doc.body.classList.contains('overview'), false, 'Enter closed the map');
  eq(doc.documentElement.classList.contains('overview'), false, 'and let the page stop scrolling');
  eq(current().parentNode, chosen.parentNode, 'and landed on the chosen slide');
});

check('Enter plays a build rather than dropping you at its end', () => {
  /* The map shows a build at its last step, since that is its only frame
     that shows the whole slide. Choosing it must still start the build,
     or every animated slide arrives already spent. */
  forget();
  const build = [...doc.querySelectorAll('.stack')].find((st) => st.children.length > 1);
  if (!build) throw new Error('no build in the deck to test');
  key('o');
  /* PageDown reads forward across movements; the arrows stop at the end
     of one, which is the distinction the two axes exist for. */
  while (current() !== build.children[1]) {
    const was = current();
    key('PageDown');
    if (current() === was) throw new Error('reading forward stopped before the build');
  }
  key('Enter');
  eq(current(), build.children[0], 'Enter started the build at its first step');
});

check('Enter does nothing when the map is closed', () => {
  /* Enter is the map's key alone. Bound loosely it becomes a second,
     undocumented way to advance the deck, which is the mistake space
     made. */
  forget();
  key('ArrowRight');
  const before = current();
  key('Enter');
  eq(current(), before, 'the deck did not move');
  eq(doc.body.classList.contains('overview'), false, 'and no map appeared');
});

check('a list in the script renders as a list', () => {
  /* The notes are read at a glance from a second screen, mid-sentence,
     which is the one place a list beats prose outright. It used to render
     as a single run-on line, and the deck already had one. */
  const out = R(`# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
On a normal day:

- it clears the inbox,
- files each item,
- and commits.

Then it stops.
\`\`\`
`).html;
  const ul = out.match(/<ul>[\s\S]*?<\/ul>/);
  if (!ul) throw new Error('the bullets did not become a list');
  eq((ul[0].match(/<li>/g) || []).length, 3, 'items');
  eq(/<p>On a normal day:<\/p>/.test(out), true, 'the lead-in stayed a paragraph');
  eq(/<p>Then it stops\.<\/p>/.test(out), true, 'and so did the line after it');
});

check('a bullet that wraps in the file stays one item', () => {
  /* deck.md is hand-edited prose, so a long bullet gets wrapped. Treating
     the continuation as a new item would split a sentence in the window
     and nothing would look broken enough to notice. */
  const out = R(`# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
Two things:

- the first one, which runs on
  past the end of the line,
- and the second.
\`\`\`
`).html;
  const ul = out.match(/<ul>[\s\S]*?<\/ul>/)[0];
  eq((ul.match(/<li>/g) || []).length, 2, 'items');
  eq(/past the end of the line,<\/li>/.test(ul), true, 'the continuation joined its own item');
});

check('a numbered list in the script renders in order', () => {
  const out = R(`# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
In order:

1. first,
2. second.
\`\`\`
`).html;
  const ol = out.match(/<ol>[\s\S]*?<\/ol>/);
  if (!ol) throw new Error('the numbers did not become a list');
  eq((ol[0].match(/<li>/g) || []).length, 2, 'items');
  eq(/<li>first,<\/li>/.test(ol[0]), true, 'the marker was stripped');
});

function scriptOf(note) {
  return R(`# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
${note}
\`\`\`
`).html;
}

check('the script can be bold and italic', () => {
  const out = scriptOf('A **bold** word and an *italic* one.');
  eq(/<strong>bold<\/strong>/.test(out), true, 'bold');
  eq(/<em>italic<\/em>/.test(out), true, 'italic');
  eq(/<li>/.test(out), false, 'and a lone asterisk pair is not a bullet');
});

check('emphasis works inside a list item too', () => {
  const out = scriptOf('Two:\n\n- a **bold** item\n- an *italic* one');
  const ul = out.match(/<ul>[\s\S]*?<\/ul>/)[0];
  eq(/<li>a <strong>bold<\/strong> item<\/li>/.test(ul), true, 'bold in an item');
  eq(/<em>italic<\/em>/.test(ul), true, 'italic in an item');
});

check('a path with underscores is left alone', () => {
  /* The script names paths constantly. Two underscores on one line would
     silently italicise everything between them, which is why underscore
     emphasis is not supported and this check exists to keep it that way. */
  const out = scriptOf('It writes 5_System/tools/status.sh and reads 0_Inbox/ first.');
  eq(/<em>/.test(out), false, 'nothing was italicised');
  eq(/5_System\/tools\/status\.sh/.test(out), true, 'the path survived intact');
});

check('a note cannot introduce a tag of its own', () => {
  /* A tag in a script is a direction to the voice or it is refused by
     name (lib/ssml.js), so an HTML tag never reaches the page; what is
     left is text, and escaping runs before the markers are applied, so
     the emphasis pass can only ever see text it already made safe. */
  let err = null;
  try { scriptOf('Careful: <script>alert(1)</script>.'); } catch (e) { err = e; }
  if (!err || !/1-a: <script> is not a tag sipario reads/.test(err.message)) {
    throw new Error(`an HTML tag in a script was not refused by name: ${err ? err.message : 'rendered'}`);
  }
  const out = scriptOf('Careful: **1 < 2 & 3 > 2** and <sub alias="x">y</sub>.');
  eq(/<strong>1 &lt; 2 &amp; 3 &gt; 2<\/strong>/.test(out), true,
     'emphasis still applied around the escaped text');
  eq(/<sub|alias|>x</.test(out), false, 'a direction to the voice is not on the page');
});

check('bold wins over italic where the markers overlap', () => {
  const out = scriptOf('This is **very** important.');
  eq(/<strong>very<\/strong>/.test(out), true, 'read as bold');
  eq(/<em>/.test(out), false, 'not as an italic between stray asterisks');
});

function layered(layers, steps) {
  return `# One

## 1.1 T
id: 1-a
template: image
figure: in-layers
layers: ${layers}
caption: A caption


\`\`\`notes
one
\`\`\`
${steps}`;
}

check('a layered figure reveals one group per step, caption last', () => {
  /* The figure has to be inlined for this: nothing outside an <img> can
     hide a group inside it. */
  const out = R(layered('source, output',
    '\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\nthree\n```')).html;
  const steps = out.match(/<section class="slide[\s\S]*?<aside/g);
  eq(steps.length, 3, 'steps');
  const hidden = (sec) => [...sec.matchAll(/class="layer hidden-step" data-layer="([^"]+)"/g)]
    .map((m) => m[1]).join(',');
  eq(hidden(steps[0]), 'output', 'step one holds the second layer back');
  eq(hidden(steps[1]), '', 'step two shows both');
  eq(/image-caption hidden-step/.test(steps[1]), true, 'and still holds the caption');
  eq(/class="image-caption"/.test(steps[2]), true, 'step three lets the caption in');
  eq(/<img class="image-figure"/.test(out), false, 'the figure was inlined, not linked');
});

check('every step of a layered figure carries the whole figure', () => {
  /* Hidden, never absent. If a step left a group out, the svg would
     reflow and the picture would move under itself as it filled in,
     which is the same defect the icon-list builds had. */
  const out = R(layered('source, output',
    '\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\nthree\n```')).html;
  const counts = out.match(/<section class="slide[\s\S]*?<aside/g)
    .map((sec) => (sec.match(/data-layer="/g) || []).length);
  eq(counts.join(','), '2,2,2', 'groups present per step');
});

check('an inlined figure sits against the left edge, like the img did', () => {
  /* The <img> carried `object-position: left center`, so a figure shorter
     than its box lined up with the heading above it and the caption
     below. An inline svg centres itself and no CSS overrides that, so
     inlining silently indented the figure away from everything else on
     the slide. The instruction has to be an attribute. */
  const out = R(layered('source, output',
    '\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\nthree\n```')).html;
  const svg = out.match(/<svg[^>]*>/)[0];
  eq(/preserveAspectRatio="xMinYMid meet"/.test(svg), true, 'aligned left, not centred');
  eq((out.match(/preserveAspectRatio=/g) || []).length,
     (out.match(/<svg\b/g) || []).length, 'exactly one per svg, not doubled');
});

check('a misspelt layer name stops the render', () => {
  /* The failure worth guarding. Nothing would throw on its own: the group
     would simply never be hidden, and the slide would show the whole
     figure at step one while looking entirely normal. */
  let err = null;
  try { R(layered('source, outpost', '\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\nthree\n```')); }
  catch (e) { err = e; }
  if (!err) throw new Error('the render accepted a layer that is not in the svg');
  eq(/outpost/.test(err.message), true, 'it named the bad layer');
  eq(/"source", "output"/.test(err.message), true, 'and listed the real ones');
});

check('a layer build with the wrong number of steps stops the render', () => {
  for (const [steps, what] of [['\n--\n\n```notes\ntwo\n```', 'too few'],
                               ['\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\n3\n```\n\n--\n\n```notes\n4\n```', 'too many']]) {
    let err = null;
    try { R(layered('source, output', steps)); } catch (e) { err = e; }
    if (!err) throw new Error(`the render accepted ${what} steps`);
    eq(/need 3 steps/.test(err.message), true, `${what}: it said how many were needed`);
  }
});

check('an image slide with no layers is still a plain img', () => {
  /* A picture that arrives whole should not pay for a build it does not
     have, and inlining every figure would put four thousand lines of svg
     into the page for no reason. */
  const out = R(`# One

## 1.1 T
id: 1-a
template: image
figure: one-piece


\`\`\`notes
one
\`\`\`
`).html;
  eq(/<img class="image-figure" src="images\/one-piece\.svg"/.test(out), true, 'linked, not inlined');
  eq(/<svg/.test(out), false, 'no svg in the page');
});

check('the dock width is written down once', () => {
  /* It was in two places, `34vw` in the css and `0.34` in deck.js, and
     nothing connected them. jsdom computes no layout so this cannot
     measure where the panel lands; what it can hold is the property that
     made the bug possible in the first place. */
  const literals = (css.match(/34vw|0\.34/g) || []).concat(js.match(/0\.34|34vw/g) || []);
  eq(literals.length, 0, 'no loose copies of the dock width');
  eq(/--dock:\s*34%/.test(css), true, 'css states it');
  eq(/css\("--dock"\)/.test(js), true, 'and the deck reads that same value');
});

check('the deck chrome moves off the docked panel', () => {
  /* The panel is painted over the top-right corner, so the compass simply
     vanished when the notes docked. The dots and the progress bar had the
     quiet version: one off the deck's centre, the other running its last
     third behind an opaque panel. */
  for (const id of ['#steps', '#progress']) {
    const rule = new RegExp(`body\\.docked\\s*${id}\\s*\\{[^}]*var\\(--dock\\)`);
    eq(rule.test(css), true, `${id} is moved clear of the panel when docked`);
  }
  /* The compass is placed by fit() from the slide's box, and the slide is
     centred in what the panel leaves, so the compass follows it there. */
  const c = doc.getElementById('compass');
  doc.body.classList.add('docked');
  window.dispatchEvent(new window.Event('resize'));
  const edge = parseFloat(c.style.left) + 84;
  doc.body.classList.remove('docked');
  window.dispatchEvent(new window.Event('resize'));
  const avail = 1600 * (1 - parseFloat(css.match(/--dock:\s*([\d.]+)%/)[1]) / 100);
  if (!(edge <= avail)) throw new Error(`#compass ends at ${edge}, under a panel that starts at ${avail}`);
});

check('the first row is marked, not counted by element type', () => {
  /* `.row:first-of-type` counts <div>s, not classes, so anything else
     wrapped in a div ahead of the rows made the first row stop being the
     first div and grow a top border. The standfirst's height-holding box
     did exactly that, and the border appeared and vanished as the slide
     built. */
  eq(/\.row:(first|last)-of-type/.test(css), false,
     'no row rule depends on element type');
  doc.querySelectorAll('#deck .slide').forEach((sl) => {
    const rows = [...sl.querySelectorAll('.icon-list-row')];
    if (!rows.length) return;
    const firsts = rows.filter((r) => r.classList.contains('first'));
    const lasts = rows.filter((r) => r.classList.contains('last'));
    eq(firsts.length, 1, `slide ${sl.dataset.n} marks one first row`);
    eq(lasts.length, 1, `slide ${sl.dataset.n} marks one last row`);
    eq(firsts[0], rows[0], `slide ${sl.dataset.n} marks the row that is actually first`);
    eq(lasts[0], rows[rows.length - 1], `slide ${sl.dataset.n} marks the row that is actually last`);
  });
});

check('a build does not change which row is first', () => {
  /* The visible symptom was a border coming and going between steps, so
     the marking has to be identical on every step of a stack. */
  doc.querySelectorAll('#deck .stack').forEach((st) => {
    const steps = [...st.querySelectorAll('.slide')];
    if (steps.length < 2) return;
    const heads = steps.map((el) => {
      const r = el.querySelector('.icon-list-row.first');
      return r ? r.querySelector('h3').textContent : null;
    });
    if (new Set(heads).size > 1) {
      throw new Error(`slide ${st.dataset.n} changes its first row: ${heads.join(' -> ')}`);
    }
  });
});

check('no body of text strands its last word', () => {
  /* jsdom lays nothing out, so this cannot count lines. What it can hold
     is the decision, which was between two values that both fix the
     symptom: `balance` evens every line and re-breaks ones that were
     already right, turning the opening statement into "Every
     second-brain / system solves capture."; `pretty` only refuses to
     leave a word alone. Someone swapping one for the other would fix
     nothing and quietly damage the deck's first line. */
  for (const rule of ['p.statement-line', 'p.statement-carry', '.icon-list-row-text p',
                      '.image-caption, .term-caption']) {
    const block = css.match(new RegExp(`${rule.replace(/\./g, '\\.')} \\{[^}]*\\}`));
    if (!block) throw new Error(`no ${rule} rule`);
    eq(/text-wrap:\s*pretty/.test(block[0]), true, `${rule} avoids orphans`);
    eq(/text-wrap:\s*balance/.test(block[0]), false, `${rule} does not rebalance`);
  }
});

check('every asset the deck references exists', () => {
  /* `src` is the URL the markup writes, which the server mounts onto the
     talk's own folder of that name, so it resolves against the talk and
     not the repo. */
  const missing = [...doc.querySelectorAll('img')]
    .map((i) => i.getAttribute('src'))
    .filter((src) => !fs.existsSync(path.join(TALK.dir, src)));
  if (missing.length) throw new Error(`missing: ${[...new Set(missing)].join(', ')}`);
});

check('every step has a spoken script', () => {
  const empty = [...doc.querySelectorAll('.slide')]
    .filter((s) => !s.querySelector('.notes').textContent.trim())
    .map((s) => s.id);
  if (empty.length) throw new Error(`no script: ${empty.join(', ')}`);
});



// ------------------------------------------------ declared slide numbers

check('each movement remembers where it was left', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  forget();
  key('ArrowRight');                         // 2.1
  key('ArrowDown'); key('ArrowDown');        // 2.2, part way through its build
  eq(n(), '2.2', 'partway down the second movement');
  const dots = doc.querySelector('#steps').querySelectorAll('.on').length;

  key('ArrowRight');
  eq(n(), '3.1', 'moved on to the next movement');
  key('ArrowLeft');
  eq(n(), '2.2', 'back where the second was left, not at its top');
  eq(doc.querySelector('#steps').querySelectorAll('.on').length, dots,
     'and at the step it was left on');
});

check('a movement never visited opens at its first slide', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  forget();
  key('ArrowRight'); key('ArrowRight');
  eq(n(), '3.1', 'the third movement opens at its top');
});

check('Shift and up returns to the top of the movement you are in', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  const top = () => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true }));
  forget();
  key('ArrowRight');                         // 2.1
  key('ArrowDown'); key('ArrowDown');        // 2.2, mid-build
  top();
  eq(n(), '2.1', 'back at the head of the second movement');
  eq(current().dataset.enter, 'up', 'arriving from above, as a move back within a part does');
  top();
  eq(n(), '2.1', 'and from the head it stays put');
  key('ArrowDown');
  eq(n(), '2.2', 'reading on goes down from the head, not to where the movement was left');
  key('ArrowLeft'); key('ArrowRight');
  eq(n(), '2.2', 'the mark is the last place shown, so left and right still return there');
});

check('R forgets the marks, and asks before it does', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  const asking = () => doc.body.classList.contains('asking');

  forget();
  key('ArrowRight');                         // 2.1
  key('ArrowDown'); key('ArrowDown');        // 2.2, mid-build
  key('ArrowRight');                         // 3.1

  /* Cancelling leaves the marks alone. */
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r' }));
  eq(asking(), true, 'it asked');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  eq(asking(), false, 'and stopped asking');
  key('ArrowLeft');
  eq(n(), '2.2', 'the mark survived a cancelled reset');

  /* Confirming forgets them, and stands the deck back at the start. */
  key('ArrowRight');                         // 3.1
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r' }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r' }));
  eq(n(), '1.1', 'the deck went back to the first slide');
  key('ArrowRight');
  eq(n(), '2.1', 'the second movement opens at its top again');
});

check('the ask does not leak keystrokes to the deck', () => {
  const { window, doc, current, key, forget } = MOVES;
  const n = () => current().dataset.n;
  forget();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const before = n();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r' }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));  // cancels
  eq(n(), before, 'the arrow cancelled the ask rather than moving the deck');
});

check('a build reserves its height, so nothing shifts as it runs', () => {
  /* Every step of an animating slide renders everything the slide ends
     with; what it has not reached is hidden, not left out. If the counts
     differed, the stage would re-centre and the line the room is reading
     would jump as the next one lands. Rows and statement lines both:
     statements once went without it, and a slide's first line moved when
     its second arrived. */
  /* The standfirst is counted by its slot rather than by its elements. A
     step whose wording differs from the tallest on the slide lays its own
     words, absolutely positioned, over an invisible copy of the tallest,
     so it renders two elements and occupies one line-box. Counting the
     elements would read a build that cannot shift as one that does;
     counting the slot says what actually matters, that every step
     reserves the same height for it. */
  const SLOT = 'p.sub.ghost, p.sub:not(.over):not(.ghost)';
  /* Every kind of thing a step can reveal, named. An earlier version
     listed only rows and statement lines, so slide 2.3's figure layers
     went uncounted and the slide passed by arithmetic accident: its
     hidden layers were subtracted from a total of zero, giving -2, -1, 0,
     which reads as a build that reveals something each step. */
  const CONTENT = '.icon-list-row, p.icon-list-lead, p.statement-line, p.statement-carry, .layer, p.image-caption, p.term-caption';
  const HIDDEN = CONTENT.split(', ').map((x) => `${x}.hidden-step`).join(', ');
  const PIECES = `${CONTENT}, ${SLOT}`;
  /* Words actually on screen: the overlay, or a plain standfirst that is
     neither the invisible ghost nor held back. */
  const SHOWN_SUB = 'p.icon-list-sub.over, p.icon-list-sub:not(.ghost):not(.over):not(.hidden-step)';
  doc.querySelectorAll('#deck .stack').forEach((st) => {
    const steps = [...st.querySelectorAll('.slide')];
    if (steps.length < 2) return;
    const counts = steps.map((el) => el.querySelectorAll(PIECES).length);
    if (new Set(counts).size > 1) {
      throw new Error(`slide ${st.dataset.n} renders ${counts.join(', ')} pieces across its steps`);
    }
    const shown = steps.map((el) =>
      el.querySelectorAll(CONTENT).length - el.querySelectorAll(HIDDEN).length
      + (el.querySelector(SHOWN_SUB) ? 1 : 0));
    for (let i = 1; i < shown.length; i++) {
      if (shown[i] <= shown[i - 1]) {
        throw new Error(`slide ${st.dataset.n} reveals nothing at step ${i + 1}`);
      }
    }
  });
});

check('a standfirst that changes as the slide builds cannot move the rows', () => {
  /* Each step has to print its own words, and reserve the height of the
     tallest standfirst on the slide. Printing the last step's words on
     every step was the first bug here; reserving the last step's height
     rather than the tallest was the second, and it laid slide 3.2's
     opening two lines straight through its first row. */
  const out = R(`# One

## 1.1 T
id: 1-a
template: icon-list


> A long opening standfirst that runs to some length and then some more

- (upload) **One**
  First.

\`\`\`notes
one
\`\`\`

--

> Short now.

- (trash-2) **Two**
  Second.

\`\`\`notes
two
\`\`\`
`).html;
  const steps = out.match(/<section class="slide[\s\S]*?<aside/g);
  eq(steps.length, 2, 'steps');
  /* Whatever holds the height on each step, a plain standfirst or an
     invisible ghost under an overlay, has to be the same words, or the
     two steps reserve different heights and the rows move. */
  const reserved = (sec) => {
    const g = sec.match(/class="icon-list-sub ghost">([^<]*)/);
    return g ? g[1] : (sec.match(/class="icon-list-sub">([^<]*)/) || [])[1];
  };
  eq(reserved(steps[0]), reserved(steps[1]), 'both steps reserve the same standfirst');
  eq(/A long opening standfirst/.test(reserved(steps[0])), true, 'and it is the tallest one');
  /* Each step still prints its own words. */
  const printed = (sec) => {
    const o = sec.match(/class="icon-list-sub over">([^<]*)/);
    return o ? o[1] : (sec.match(/class="icon-list-sub">([^<]*)/) || [])[1];
  };
  eq(/A long opening standfirst/.test(printed(steps[0])), true, 'step one prints its own');
  eq(printed(steps[1]), 'Short now.', 'and step two prints its own, not step one\'s');
});

check('align reaches every step of the slide that asked for it', () => {
  const aligned = [...doc.querySelectorAll('#deck .slide.align-spread')];
  if (!aligned.length) throw new Error('no slide carries align-spread');
  aligned.forEach((el) => eq(el.dataset.n, '3.5', 'only slide 3.5 is aligned'));
  eq(aligned.length, 2, 'every step of that slide carries it');
});

check('an unknown align value stops the render', () => {
  const src = fs.readFileSync(TALK.deck, 'utf8')
    .replace('align: spread', 'align: middle');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('align: middle rendered as though it meant something');
  if (!/slide 3.5 has align: middle/.test(threw.message)) {
    throw new Error(`unhelpful message: ${threw.message}`);
  }
});

check('every slide declares an id, prefixed by its section', () => {
  const { parse } = require('./lib/render.js');
  const parsed = parse(fs.readFileSync(TALK.deck, 'utf8'));
  const missing = parsed.filter((sl) => !sl.meta.id).map((sl) => sl.meta.slide);
  if (missing.length) throw new Error(`slides without an id: ${missing.join(', ')}`);

  const ids = [...doc.querySelectorAll('#deck .slide')].map((el) => el.id);
  eq(ids.length, steps, 'ids');
  eq(new Set(ids).size, steps, 'unique ids');
  eq(ids[0], '1-a-slide-of-every-template', 'the title slide');
  eq(ids[ids.length - 1], '4-take-it', 'the close');

  /* Every id's prefix must be the section it is actually in. */
  doc.querySelectorAll('#deck .group').forEach((gEl, i) => {
    gEl.querySelectorAll('.slide').forEach((el) => {
      if (!el.id.startsWith(`${i + 1}-`)) throw new Error(`${el.id} is in section ${i + 1}`);
    });
  });

  /* A slide's steps take its id with a numeric suffix. */
  eq(ids[5], '3-a-statement-arrives-a-line-at-a-time', 'a build\'s first step');
  eq(ids[6], '3-a-statement-arrives-a-line-at-a-time-2', 'and its second');
});

check('an id in the wrong section stops the render', () => {
  const src = fs.readFileSync(TALK.deck, 'utf8')
    .replace('id: 3-templates', 'id: 9-templates');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('an id from the wrong section rendered anyway');
  if (!/"9-templates" but sits in section 3 \(Templates\)/.test(threw.message)) {
    throw new Error(`unhelpful message: ${threw.message}`);
  }
});

check('a slide with no id stops the render', () => {
  const src = fs.readFileSync(TALK.deck, 'utf8')
    .replace('id: 3-templates\n', '');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('a slide without an id rendered anyway');
  if (!/declares no id/.test(threw.message)) throw new Error(`unhelpful: ${threw.message}`);
});

check('a duplicate id stops the render', () => {
  const { checkIds } = require('./lib/render.js');
  let threw = null;
  try { checkIds(['a', 'b', 'a']); } catch (e) { threw = e; }
  if (!threw) throw new Error('duplicate ids passed the check');
  if (!/"a" is used by step 1 and step 3/.test(threw.message)) {
    throw new Error(`unhelpful message: ${threw.message}`);
  }
});

check('every slide declares its number, and it is right', () => {
  const { parse, grouped, checkNumbers } = require('./lib/render.js');
  const parsed = parse(fs.readFileSync(TALK.deck, 'utf8'));
  checkNumbers(grouped(parsed));                          // throws if not
  eq(parsed.length, slides, 'slides parsed');
  eq(parsed[0].meta.slide, '1.1', 'the title declares 1.1');
  eq(parsed[1].meta.slide, '2.1', 'the second movement starts at 2.1');
  eq(parsed[parsed.length - 1].meta.slide, '4.1', 'the close declares 4.1');
});

check('number-from: 0 counts the movements from the opening', () => {
  /* A talk whose first movement is an opening rather than a beat can
     number it 0, so that beat three is 3.x on every slide and on its
     section mark alike. The numbers and the id prefixes both follow. */
  const { render, parse, grouped, checkNumbers, checkDeclaredIds, identity } = require('./lib/render.js');
  let src = MOVES_SRC.replace('name: Moves', 'name: Moves\nnumber-from: 0');
  for (let n = 1; n <= 3; n++) {                   // ascending, so 2 -> 1 never re-hits a fresh 1
    src = src.replace(new RegExp(`^## ${n}\\.`, 'mg'), `## ${n - 1}.`)
             .replace(new RegExp(`^id: ${n}-`, 'mg'), `id: ${n - 1}-`);
  }
  eq(identity(src).from, 0, 'the head says where to count from');
  const groups = grouped(parse(src));
  checkNumbers(groups, 0);
  checkDeclaredIds(groups, 0);
  const html = render(src, TALK).html;
  const ns = [...html.matchAll(/<div class="stack" data-steps="\d+" data-n="([^"]+)"/g)].map((m) => m[1]);
  eq(ns[0], '0.1', 'the opening is 0.1');
  eq(ns[1], '1.1', 'and the second movement is 1.x');
  eq(/<section class="group" data-group="Title" data-section="0">/.test(html), true,
     'the movement carries its number too');
  eq(/id="0-three-movements"/.test(html), true, 'ids open with the same number');

  /* Declared numbers that still count from 1 are wrong under the key. */
  let threw = null;
  try { render(MOVES_SRC.replace('name: Moves', 'name: Moves\nnumber-from: 0'), TALK); } catch (e) { threw = e; }
  if (!threw || !/declared 1.1, is actually 0.1/.test(threw.message)) {
    throw new Error(`a deck numbered from 1 under number-from: 0 should stop: ${threw && threw.message}`);
  }
  /* The key takes 0 or 1 and nothing else. */
  threw = null;
  try { identity('name: X\nnumber-from: 2\n\n# A'); } catch (e) { threw = e; }
  if (!threw || !/number-from is 2/.test(threw.message)) throw new Error('number-from: 2 was accepted');
});

check('a wrong declared number stops the render', () => {
  const src = fs.readFileSync(TALK.deck, 'utf8')
    .replace('## 3.5 ', '## 3.50 ');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('a slide numbered 3.50 in fifth place rendered anyway');
  if (!/declared 3.50, is actually 3.5/.test(threw.message)) {
    throw new Error(`unhelpful message: ${threw.message}`);
  }
});

check('a `##` line with no number stops the render', () => {
  /* The number is what makes a slide header a slide header, so leaving it
     off does not produce an unnumbered slide: it produces no slide, and
     everything the slide held is read as more body for the one above it.
     That renders, and looks like the slide was simply deleted. */
  const src = fs.readFileSync(TALK.deck, 'utf8').replace('## 3.6 ', '## ');
  let threw = null;
  try { render(src, TALK); } catch (e) { threw = e; }
  if (!threw) throw new Error('a `##` line with no number was read as body');
  if (!/opens neither a movement nor a slide/.test(threw.message)) {
    throw new Error(`unhelpful: ${threw.message}`);
  }
});

// ------------------------------------------- the deck and its presenter

/* A BroadcastChannel the two windows share, so the protocol between them
 * is what is under test rather than the browser's implementation of it. */
function makeBus() {
  /* Named, as the real one is: a message reaches the peers on the same
     name and no other, which is what a rename turns on. */
  const peers = [];
  return function Channel(name) {
    this.name = name;
    this.onmessage = null;
    this.onmessageerror = null;
    this.close = () => { const i = peers.indexOf(this); if (i > -1) peers.splice(i, 1); };
    this.postMessage = (data) => {
      for (const p of peers) if (p !== this && p.name === this.name && p.onmessage) p.onmessage({ data });
    };
    peers.push(this);
  };
}

function windowFor(body, scripts, Bus, url, before) {
  const errs = [];
  const con = new VirtualConsole();
  con.on('jsdomError', (e) => errs.push(e));
  const d = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true,
      url: url || 'http://localhost:9999/', virtualConsole: con });
  d.window.BroadcastChannel = Bus;
  d.window.EventSource = fakeStream([]);
  d.window.open = () => ({ closed: false, focus() {}, close() { this.closed = true; } });
  Object.defineProperty(d.window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(d.window, 'innerHeight', { value: 900, configurable: true });
  if (before) before(d.window);                    // e.g. seed storage, as a reload would find it
  for (const src of scripts.includes(phoneJs) ? scripts : [eventsJs].concat(scripts)) d.window.eval(src);
  parsed(d.window);
  if (errs.length) throw new Error(errs[0].detail || errs[0].message);
  return d.window;
}

const presenterJs = fs.readFileSync(path.join(ROOT, 'js/presenter.js'), 'utf8');
const deckBody = `${MOVES_MAIN}
  <div id="progress"><div id="progress-bar"></div></div>`;
const presenterBody = `${MOVES_MAIN}
  <div class="notes-bar" id="notes-bar" aria-label="Notes"><span id="attach-note"></span>
    <button id="attach-btn"></button><button id="close-btn"></button></div>
  <div id="wrap">
    <div class="shelf" id="now-shelf"><h4><button class="shelf-btn" id="now-btn"></button></h4>
      <div class="shot-box" id="now"></div></div>
    <div class="pane" id="side">
      <div id="clock">00:00</div><button id="timer-btn"></button><p id="timer-note"></p>
    </div>
    <div class="shelf" id="next-shelf"><h4><button class="shelf-btn" id="next-btn"></button></h4>
      <div class="shot-box" id="next"></div></div>
    <div class="pane" id="script"><h4>Script
      <button class="size-btn" id="smaller-btn"></button>
      <button class="size-btn" id="bigger-btn"></button></h4>
      <div id="notes"></div></div>
    <pre id="fault"></pre>
  </div><div id="orphan"></div>`;

let deckWin, presWin, BUS;

/* Attaching closes the presenter window, and a closed jsdom window has no
   document, so a check that needs one after that has to open another on
   the same bus. Exactly what a person would do. */
function newPresenter() {
  presWin = windowFor(presenterBody, [presenterJs], BUS);
  return presWin;
}

check('the presenter window runs and follows the deck', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  newPresenter();

  const notes = presWin.document.getElementById('notes').textContent.trim();
  const first = deckWin.document.querySelector('.slide.current');
  if (!notes) throw new Error('the presenter shows no script');
  eq(notes.slice(0, 40), first.querySelector('.notes').textContent.trim().slice(0, 40),
     'script shown');
});

check('the presenter window drives the deck', () => {
  /* Right, not down: the deck opens on Title, which holds one slide of
     one step, so down there correctly does nothing. */
  const before = deckWin.document.querySelector('.slide.current');
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const after = deckWin.document.querySelector('.slide.current');
  if (after === before) throw new Error('the deck did not move');
  eq(presWin.document.getElementById('notes').textContent.trim().slice(0, 40),
     after.querySelector('.notes').textContent.trim().slice(0, 40),
     'the presenter followed');
});

check('moving the deck updates the presenter', () => {
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'End' }));
  const last = deckWin.document.querySelector('.slide.current');
  eq(presWin.document.getElementById('notes').textContent.trim().slice(0, 40),
     last.querySelector('.notes').textContent.trim().slice(0, 40), 'script at the end');
  /* With the position line gone, the preview is what says the panel
     followed: it is the real slide, so a stale one would be the last
     slide's words over the previous slide's picture. */
  const shot = presWin.document.querySelector('#now .slide.shot');
  if (!shot || shot.id !== last.id) {
    throw new Error('the preview did not follow to the last slide');
  }
});

check('a second deck window does not drive the first one\'s notes', () => {
  /* The channel is named for the talk, so two windows of the *same* talk
     share it. Before the panel knew which window opened it, every deck
     broadcast its position to every panel and each panel obeyed whichever
     spoke last: open the deck twice and the notes beside one window showed
     the script for the slide the other was on. Reproduced 2026-09-19 from
     a deck on 1.1 whose panel was reading 2.3. */
  const bus = makeBus();
  const deckA = windowFor(deckBody, [js], bus);
  const id = deckA.document.getElementById('deck').getAttribute('data-deck');
  const tabA = deckA.sessionStorage.getItem('notes-tab');
  if (!tabA) throw new Error('the deck window took no id of its own');

  const panelA = windowFor(presenterBody, [presenterJs], bus,
    'http://localhost:9999/presenter?tab=' + tabA);

  deckA.document.dispatchEvent(new deckA.KeyboardEvent('keydown', { key: 'End' }));
  const mine = deckA.document.querySelector('.slide.current');
  const shown = () => panelA.document.getElementById('notes').textContent.trim().slice(0, 40);
  eq(shown(), mine.querySelector('.notes').textContent.trim().slice(0, 40),
     'the panel follows the window that opened it');

  /* A second window of the same talk, which publishes where it is as it
     starts. Its id differs, so this panel must not move. */
  const deckB = windowFor(deckBody, [js], bus);
  const tabB = deckB.sessionStorage.getItem('notes-tab');
  if (tabB === tabA) throw new Error('two deck windows took the same id');
  eq(shown(), mine.querySelector('.notes').textContent.trim().slice(0, 40),
     'a second deck window moved the first one\'s notes');
});

check('the presenter previews the real slide, not a copy of it', () => {
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Home' }));
  const shot = presWin.document.querySelector('#now .slide.shot');
  if (!shot) throw new Error('no preview rendered');
  if (shot.querySelector('.notes')) throw new Error('the preview still carries its notes');
  eq(shot.querySelector('h1').textContent,
     deckWin.document.querySelector('.slide.current h1').textContent, 'preview heading');
});

check('the notes carry the map, lit where the deck is', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const d = deckWin.document;
  const map = p.document.getElementById('notes-map');
  if (!map) throw new Error('no map in the notes');
  eq(map.parentNode.id, 'side', 'in the side column');
  eq(map.parentNode.firstChild, map, 'at its top');
  eq(map.querySelectorAll('.mm-col').length, d.querySelectorAll('#minimap .mm-col').length,
     'a column per movement, as on the deck');
  eq(map.querySelectorAll('.mm-cell').length, d.querySelectorAll('#minimap .mm-cell').length,
     'and a cell per slide');
  const lit = () => { const c = map.querySelector('.mm-cell.on'); return c && c.dataset.g + '.' + c.dataset.s; };
  eq(lit(), '0.0', 'lit at the start');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  eq(lit(), '1.1', 'and it follows the deck');
  eq(map.querySelectorAll('.mm-cell.on').length, 1, 'one cell lit, not two');

  /* M governs both maps, from either window. */
  const shown = () => !map.classList.contains('hidden');
  const deckShown = () => d.body.classList.contains('minimap');
  eq(shown() && deckShown(), true, 'both maps showing to begin with');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'm' }));
  eq(deckShown(), false, 'M on the deck hides its map');
  eq(shown(), false, 'and the notes\' map with it');
  p.document.dispatchEvent(new p.KeyboardEvent('keydown', { key: 'm' }));
  eq(deckShown(), true, 'M in the notes brings the deck\'s back');
  eq(shown(), true, 'and its own');
});

check('a detached window takes a fresh deck without reloading', () => {
  /* A save reloads the deck window but not a detached one, which kept the
     copy it loaded with. The window fetches its page again and swaps the
     deck in, keeping its place and its clock. */
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const before = p.document.getElementById('notes').textContent.trim();
  const cells = p.document.querySelectorAll('#notes-map .mm-cell').length;

  const edited = MOVES_SRC
    .replace('The section opens the second movement.', 'The section, rewritten, opens the second movement.')
    .replace('\n# Close', '\n## 2.5 Added\nid: 2-added\ntemplate: statement\n\nA slide that was not there.\n\n```notes\nNew.\n```\n\n# Close');
  const fresh = render(edited, TALK);
  eq(p.__refresh(`<html><body><main id="deck" data-deck="${fresh.deck.key}">${fresh.html}</main></body></html>`), true, 'refreshed');
  const after = p.document.getElementById('notes').textContent.trim();
  if (after === before) throw new Error('the script did not change');
  if (!/rewritten/.test(after)) throw new Error(`the script is not the new one: ${after.slice(0, 60)}`);
  eq(p.document.querySelectorAll('#notes-map .mm-cell').length, cells + 1, 'the map grew a cell for the new slide');
  eq(p.document.querySelector('#notes-map .mm-cell.on').dataset.g, '1', 'and still lights the movement the deck is on');
  eq(p.document.getElementById('clock').textContent, '00:00', 'the clock was left alone');
});

check('a save that does not render shows its fault in the notes, and the next one clears it', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const before = p.document.getElementById('notes').textContent.trim();
  eq(p.__refresh('deck.md slide numbering is out of step:\n  declared 3.50, is actually 3.5', false), false, 'refused');
  eq(p.document.body.classList.contains('fault'), true, 'the fault is shown');
  if (!/declared 3.50/.test(p.document.getElementById('fault').textContent)) throw new Error('without the message');
  eq(p.document.getElementById('notes').textContent.trim(), before, 'the last good script stays');
  eq(p.__refresh(`<html><body><main id="deck">${MOVES_DECK.html}</main></body></html>`), true, 'the next save renders');
  eq(p.document.body.classList.contains('fault'), false, 'and the fault is gone');
});

check('the notes wait for the deck\'s version, so fullscreen holds them back too', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const fake = new BUS('sipario:moves');                   // a deck that reports versions
  const at = (v) => fake.postMessage({ from: 'deck', type: 'state', g: 0, s: 0, y: 0, v });
  at('100');
  const before = p.document.getElementById('notes').textContent.trim();
  const edited = MOVES_SRC.replace('The first movement holds one slide.', 'The first movement, rewritten.');
  const page = `<html><body><main id="deck" data-deck="sipario:moves" data-version="101">${render(edited, TALK).html}</main></body></html>`;
  p.__stage('101', page, true);                            // the stream said so, the fetch came back
  eq(p.document.getElementById('notes').textContent.trim(), before, 'staged, not applied: the deck is still on 100');
  at('100');
  eq(p.document.getElementById('notes').textContent.trim(), before, 'and stays so while the deck holds the save');
  at('101');
  if (!/rewritten/.test(p.document.getElementById('notes').textContent)) throw new Error('not applied once the deck reached 101');
});

check('a renamed deck keeps its notes: the window moves to the new channel', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const opened = [];
  const Real = p.BroadcastChannel;
  p.BroadcastChannel = function (name) { opened.push(name); return new Real(name); };
  const renamed = render(MOVES_SRC.replace('name: Moves', 'name: Moves Renamed'), TALK);
  const page = `<html><body><main id="deck" data-deck="${renamed.deck.key}" data-version="7">${renamed.html}</main></body></html>`;
  /* Staged on the stream's word: the new channel is opened beside the old
     one, and the old one still drives, since a deck in fullscreen is
     still on it. */
  p.__stage('7', page, true);
  eq(opened.join(), 'sipario:moves-renamed', 'a channel under the new name was opened on staging');
  eq(p.document.getElementById('deck').getAttribute('data-deck'), 'sipario:moves', 'the copy waits for the deck');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(p.document.querySelector('#notes-map .mm-cell.on').dataset.g, '1', 'the deck on the old channel still drives');
  /* The renamed deck confirms on the new channel: the copy is taken and
     the window moves over, and the old channel is left behind. */
  const fresh = new BUS('sipario:moves-renamed');
  fresh.postMessage({ from: 'deck', type: 'state', g: 2, s: 0, y: 0, v: '7' });
  eq(p.document.getElementById('deck').getAttribute('data-deck'), 'sipario:moves-renamed', 'taken when the deck confirms');
  eq(p.document.querySelector('#notes-map .mm-cell.on').dataset.g, '2', 'and on the new deck\'s position');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  eq(p.document.querySelector('#notes-map .mm-cell.on').dataset.g, '2', 'the old channel no longer drives');
});

check('notes opened after a held save take their version from the page, and ask for the deck\'s', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  /* The page was rendered at 5; the deck, in fullscreen, is showing 4. */
  const p = windowFor(presenterBody.replace('<main id="deck"', '<main id="deck" data-version="5"'), [presenterJs], BUS);
  const asked = [];
  p.fetch = (url) => { asked.push(url); return new Promise(() => {}); };
  const fake = new BUS('sipario:moves');
  fake.postMessage({ from: 'deck', type: 'state', g: 0, s: 0, y: 0, v: '4' });
  eq(asked.length, 1, 'the deck\'s version was asked for');
  if (!/[?&]v=4$/.test(asked[0])) throw new Error(`asked for the wrong thing: ${asked[0]}`);
  /* What comes back says which version it is, and that is what is applied. */
  const older = render(MOVES_SRC.replace('The first movement holds one slide.', 'The first movement, as the room sees it.'), TALK);
  p.__stage('4', `<html><body><main id="deck" data-deck="sipario:moves" data-version="4">${older.html}</main></body></html>`, true);
  if (!/as the room sees it/.test(p.document.getElementById('notes').textContent)) throw new Error('the room\'s version was not applied');
});

check('a hello from a detached window lets a reloaded deck take it back, whichever loads first', () => {
  BUS = makeBus();
  const first = windowFor(deckBody, [js], BUS);
  first.document.dispatchEvent(new first.KeyboardEvent('keydown', { key: 'd' }));
  const tab = first.sessionStorage.getItem('notes-tab');
  /* The deck reloads before its window has moved to the channel: the
     roll-call is unanswered. */
  first.dispatchEvent(new first.Event('pagehide'));      // the page goes, as a reload takes it
  deckWin = windowFor(deckBody, [js], BUS, undefined, (w) => w.sessionStorage.setItem('notes-tab', tab));
  eq(deckWin.__detached(), false, 'nobody answered the roll-call');
  presWin = windowFor(presenterBody, [presenterJs], BUS, 'http://localhost:9999/presenter?tab=' + tab);
  eq(deckWin.__detached(), true, 'the window\'s hello let the deck take it back');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(deckWin.document.body.classList.contains('docked'), false, 'so N hides rather than docking a second copy');
});

check('the dock says it is not a window, from its first word', () => {
  /* `inFrame` was decided after the first hello went out, so the dock
     announced itself as a window: a deck with popups allowed opened a
     blank window by name and hid the dock. */
  BUS = makeBus();
  const heard = [];
  const spy = new BUS('sipario:moves');
  spy.onmessage = (e) => { if (e.data.from === 'presenter' && e.data.type === 'hello') heard.push(e.data); };
  windowFor(presenterBody, [presenterJs], BUS, 'http://localhost:9999/presenter?tab=abc',
    (w) => Object.defineProperty(w, 'parent', { value: {}, configurable: true }));   // framed
  eq(heard.length, 1, 'the dock said hello');
  eq(heard[0].detached, false, 'and not as a window');
  windowFor(presenterBody, [presenterJs], BUS, 'http://localhost:9999/presenter?tab=abc');
  eq(heard.length, 2, 'a window of its own said hello');
  eq(heard[1].detached, true, 'and as a window');
});

check('a refresh brings the stylesheets with it', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const p = newPresenter();
  const head = p.document.head;
  const add = (href) => { const l = p.document.createElement('link'); l.rel = 'stylesheet'; l.href = href; head.appendChild(l); };
  add('/templates/kept.css'); add('/templates/dropped.css');
  const page = `<html><head><link rel="stylesheet" href="/templates/kept.css"><link rel="stylesheet" href="/templates/added.css"></head>` +
    `<body><main id="deck">${MOVES_DECK.html}</main></body></html>`;
  eq(p.__refresh(page), true, 'refreshed');
  const hrefs = [...head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'));
  if (!hrefs.some((h) => /^\/templates\/kept\.css\?v=\d+$/.test(h))) throw new Error(`kept.css was not fetched again: ${hrefs}`);
  if (!hrefs.some((h) => /^\/templates\/added\.css\?v=\d+$/.test(h))) throw new Error(`added.css was not added: ${hrefs}`);
  if (hrefs.some((h) => /dropped\.css/.test(h))) throw new Error(`dropped.css was kept: ${hrefs}`);
  /* In the fresh page's order: an added sheet is not simply appended. */
  add('/templates/z.css');
  const ordered = `<html><head><link rel="stylesheet" href="/templates/a.css"><link rel="stylesheet" href="/templates/z.css"></head>` +
    `<body><main id="deck">${MOVES_DECK.html}</main></body></html>`;
  p.__refresh(ordered);
  const order = [...head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href').split('?')[0]);
  eq(order.join(), '/templates/a.css,/templates/z.css', 'a.css before z.css, as the deck has them');
});

check('a reloaded deck takes its detached window back before P can dock a second copy', () => {
  BUS = makeBus();
  const first = windowFor(deckBody, [js], BUS);
  first.document.dispatchEvent(new first.KeyboardEvent('keydown', { key: 'd' }));
  eq(first.__detached(), true, 'the first deck detached its notes');
  const tab = first.sessionStorage.getItem('notes-tab');
  presWin = windowFor(presenterBody, [presenterJs], BUS, 'http://localhost:9999/presenter?tab=' + tab);
  /* The deck reloads: the page goes, and a new window with the same tab id
     arrives, the notes still open. It asks on the way in, and takes the
     window back. */
  first.dispatchEvent(new first.Event('pagehide'));
  deckWin = windowFor(deckBody, [js], BUS, undefined, (w) => w.sessionStorage.setItem('notes-tab', tab));
  eq(deckWin.__detached(), true, 'the reloaded deck has its window back');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(deckWin.document.body.classList.contains('docked'), false, 'N did not dock a second copy');
  eq(deckWin.__detached(), false, 'it hid the notes, which is what P does when they show');
});

check('the notes are off until asked for', () => {
  /* The guard that matters. A panel that opened by itself would put the
     script on whatever screen the deck is being shared to, which is why
     the notes moved out to a window in the first place. Both ways of
     showing them start closed. */
  if (deckWin.document.body.classList.contains('docked')) {
    throw new Error('the notes were docked without being asked for');
  }
  if (deckWin.document.getElementById('dock')) {
    throw new Error('the dock was built before it was needed');
  }
});

check('N docks the notes, and they are the presenter page itself', () => {
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(d.body.classList.contains('docked'), true, 'docked after P');
  const frame = d.getElementById('dock-frame');
  if (!frame) throw new Error('no iframe in the dock');
  const src = frame.getAttribute('src');
  eq(src.split('?')[0], '/presenter',
     'the dock shows the presenter page, so the two cannot drift apart');
  if (!/[?&]tab=[^&]+/.test(src)) {
    throw new Error('the dock was not told which deck window owns it: ' + src);
  }
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(d.body.classList.contains('docked'), false, 'N again hides them');
});

check('the deck makes room for the docked notes', () => {
  const d = deckWin.document;
  const at = () => d.querySelector('.slide.current').style;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  const on = at().getPropertyValue('--k');
  const left = at().left;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  const off = at().getPropertyValue('--k');
  if (Number(on) >= Number(off)) {
    throw new Error(`docking did not shrink the deck: ${on} then ${off}`);
  }
  if (left === '50%') throw new Error('the deck stayed centred under the panel');
  eq(at().left, '50%', 'and it re-centres when the notes close');
});

check('D moves the notes to a window and back', () => {
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(d.body.classList.contains('docked'), true, 'docked to start');

  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), false, 'detaching undocks');

  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), true, 'and D again brings them back');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
});

check('the detached window can put the notes back', () => {
  /* The mirror of the dock's detach button. Without it the only way home
     is to go and find the deck window, which is the one you have just
     pushed onto a projector. */
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Escape' }));
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), false, 'detached to start');
  eq(deckWin.__detached(), true, 'and the window is open');

  presWin.document.getElementById('attach-btn').dispatchEvent(
    new presWin.MouseEvent('click', { bubbles: true }));
  eq(d.body.classList.contains('docked'), true, 'attach docked them again');
  eq(deckWin.__detached(), false, 'and closed the window');
});

check('the detached window wears the dock\'s header, and its close hides the notes', () => {
  /* One bar for both: the label, then attach where the dock has detach,
     then the same close. Nothing of the kind is left loose in the body,
     where the attach button used to sit above the clock. */
  const pres = require('./lib/pages.js').presenterPage(MOVES_DECK, 9999);
  const bar = pres.match(/<div class="notes-bar" id="notes-bar"[^>]*aria-label="Notes"[^>]*>([\s\S]*?)\n<\/div>/);
  if (!bar) throw new Error('the notes page has no header bar named Notes');
  if (/>Notes</.test(bar[1])) throw new Error('the header still prints the word Notes');
  for (const name of ['Attach notes', 'Close notes']) {
    if (!bar[1].includes(`aria-label="${name}"`)) throw new Error(`no ${name} in the header`);
  }
  eq(pres.split('id="attach-btn"').length - 1, 1, 'one attach button, and it is in the header');
  const wrap = pres.slice(pres.indexOf('<div id="wrap">'));
  if (/aria-label="(Attach|Close) notes"/.test(wrap)) throw new Error('a notes control is still loose in the body');
  if (!/\.notes-bar\b/.test(fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8'))) {
    throw new Error('the bar is not one class the dock and the window share');
  }

  const d = deckWin.document;
  newPresenter();
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(deckWin.__detached(), true, 'detached');
  presWin.document.getElementById('close-btn').dispatchEvent(
    new presWin.MouseEvent('click', { bubbles: true }));
  eq(deckWin.__detached(), false, 'close shut the window');
  eq(d.body.classList.contains('docked'), false, 'and did not dock them: the notes are hidden');

  newPresenter();
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'n' }));
  eq(deckWin.__detached(), false, 'N in the window hides them too');
  eq(d.body.classList.contains('docked'), false, 'still not docked');
});

check('D works with the notes in focus: in their window it attaches, docked it detaches', () => {
  /* The notes take the keys once they have been clicked, so the deck's D
     has to be answered there too, both ways round. */
  const d = deckWin.document;
  newPresenter();
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(deckWin.__detached(), true, 'detached from the deck');
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), true, 'D in the window docked them');
  eq(deckWin.__detached(), false, 'and closed the window');

  /* Docked, the notes are the deck's iframe and call straight through;
     that call is the deck's own toggle, and the message is its fallback. */
  eq(typeof deckWin.__toggleDetached, 'function', 'the deck offers its docked frame the toggle');
  const ch = new BUS(deckWin.document.getElementById('deck').getAttribute('data-deck'));
  ch.postMessage({ from: 'presenter', type: 'detach' });
  ch.close();
  eq(deckWin.__detached(), true, 'a detach from the notes detaches');
  eq(d.body.classList.contains('docked'), false, 'and nothing is left docked');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
});

check('A is retired: in the detached window it does nothing, and no key list names it', () => {
  /* D moves the notes from either window now, so A was a second name for
     the same act, and one more key to remember at a lectern. */
  const d = deckWin.document;
  newPresenter();                       // the last check closed the previous one
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(deckWin.__detached(), true, 'detached');
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'a' }));
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'A' }));
  eq(deckWin.__detached(), true, 'A left the window where it was');
  eq(d.body.classList.contains('docked'), false, 'and docked nothing');
  if (/<dt>A<\/dt>/.test(js)) throw new Error('the help overlay still names A');
  for (const s of ['minimal', 'stylish']) {
    const src = fs.readFileSync(path.join(ROOT, 'starters', s, 'deck.md'), 'utf8');
    if (/`A`/.test(src)) throw new Error(`the ${s} keys slide still names A`);
  }
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(deckWin.__detached(), false, 'D put them back');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'n' }));
});

check('the notes\' reset clears the clock and the deck\'s bookmarks', () => {
  /* Reset means ready for another run-through. A clock back at 00:00
     while every movement still opens where the last run left it is half
     a reset, and the half that is missing is the one you notice on
     stage. */
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const d = deckWin.document, p = newPresenter();
  const dk = (k) => d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: k }));
  const n = () => d.querySelector('.slide.current').dataset.n;

  dk('r'); dk('r');
  dk('ArrowRight');
  dk('ArrowDown'); dk('ArrowDown');                         // left partway into 2.2
  eq(n(), '2.2', 'the second movement was left partway down');
  dk('ArrowRight');

  const btn = p.document.getElementById('timer-btn');
  btn.click();                                              // start
  btn.click();                                              // pause
  btn.click();                                              // ask
  eq(p.document.getElementById('timer-note').textContent.length > 0, true, 'the notes asked');
  eq(n(), '3.1', 'and nothing moved while it asked');
  btn.click();                                              // confirm

  eq(p.document.getElementById('clock').textContent, '00:00', 'the clock went back to zero');
  eq(n(), '1.1', 'and the deck to the first slide');
  dk('ArrowRight'); dk('ArrowRight');
  eq(n(), '3.1', 'with the third movement opening at its top again');
});

check('a reset from the notes draws nothing on the deck', () => {
  /* The deck window is the one on the projector. Its own R writes the
     question across the slide, which is right when it is the only window
     and wrong the moment it is being shared, so a reset asked for in the
     notes is answered there and lands here silently. */
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const d = deckWin.document, p = newPresenter();
  const btn = p.document.getElementById('timer-btn');
  btn.click(); btn.click(); btn.click(); btn.click();
  eq(d.body.classList.contains('asking'), false, 'the deck showed no overlay');
  eq(d.getElementById('ask').textContent, '', 'and wrote no message on the slide');
});

check('the notes ask before forgetting, and take no for an answer', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const d = deckWin.document, p = newPresenter();
  const dk = (k) => d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: k }));
  const n = () => d.querySelector('.slide.current').dataset.n;

  dk('r'); dk('r');
  dk('ArrowRight');
  dk('ArrowDown'); dk('ArrowDown');
  dk('ArrowRight');

  const btn = p.document.getElementById('timer-btn');
  btn.click(); btn.click(); btn.click();                    // start, pause, ask
  p.document.dispatchEvent(new p.KeyboardEvent('keydown', { key: 'Escape' }));
  eq(p.document.getElementById('timer-note').textContent, '', 'the notes stopped asking');
  dk('ArrowLeft');
  eq(n(), '2.2', 'the mark survived a cancelled reset');
});

check('the notes\' ask does not leak keystrokes to the deck', () => {
  BUS = makeBus();
  deckWin = windowFor(deckBody, [js], BUS);
  const d = deckWin.document, p = newPresenter();
  const n = () => d.querySelector('.slide.current').dataset.n;
  const btn = p.document.getElementById('timer-btn');
  btn.click(); btn.click(); btn.click();
  const before = n();
  p.document.dispatchEvent(new p.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(n(), before, 'the arrow cancelled the ask rather than moving the deck');
});

check('every element the notes reach for is on the page the server sends', () => {
  /* The suite builds its own copy of the notes page, so an id renamed in
     the page and not here would pass every check above and be null in
     the room. Read the real page instead. */
  const page = fs.readFileSync(path.join(ROOT, 'lib/pages.js'), 'utf8');
  const wanted = [...presenterJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  eq(wanted.length > 0, true, 'found the ids the notes use');
  const missing = wanted.filter((id) => !page.includes(`id="${id}"`));
  if (missing.length) throw new Error(`lib/pages.js has no ${missing.join(', ')}`);
});

check('the notes are one layout, not two', () => {
  /* The dock is an iframe on /presenter, so both modes already run the
     same page. What made them look different was a breakpoint: under
     820px the two columns stacked into one, and the dock is 34% of the
     window, so it was always under it while a detached window was
     always over. Same page, two layouts, decided by an accident of
     width. */
  const pcss = fs.readFileSync(path.join(ROOT, 'css/presenter.css'), 'utf8');
  const media = pcss.match(/@media[^{]*\{[\s\S]*?\n\}/g) || [];
  const layoutSwitch = media.filter((m) => /#wrap|grid-template-columns/.test(m));
  if (layoutSwitch.length) {
    throw new Error(`a media query changes the notes layout:\n${layoutSwitch[0].slice(0, 120)}`);
  }
  eq(/#wrap \{[^}]*grid-template-columns:\s*minmax\([^)]*\) 1fr/.test(pcss), true,
     'the rail shrinks with the panel rather than sitting at a fixed width');
  /* The script runs the whole width under both columns, so a rule that
     confined it to one would halve the only thing on this page that has
     to be read while talking. */
  eq(/#script \{[^}]*grid-column:\s*1 \/ -1/.test(pcss), true,
     'the script runs the full width, under the previews and the clock');
});

check('either preview can be put away, and the choice is remembered', () => {
  /* The rail is there to be glanced at and the script is there to be
     read, so a presenter who wants neither picture should get the space
     back. Hiding must survive the next slide, or it would undo itself
     the moment the talk moved. */
  const p = newPresenter();
  const shelf = (n) => p.document.getElementById(n + '-shelf').classList.contains('hidden');

  eq(shelf('now'), false, 'both previews start showing');
  p.document.getElementById('now-btn').click();
  eq(shelf('now'), true, 'the button put the current slide away');
  eq(shelf('next'), false, 'and left the next one alone');

  p.document.dispatchEvent(new p.KeyboardEvent('keydown', { key: '2' }));
  eq(shelf('next'), true, 'the key put the next slide away too');

  /* Moving the deck repaints, which is where a hidden shelf would come
     back if paint() decided what is showing. */
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  eq(shelf('now'), true, 'still hidden after the deck moved');

  /* Each jsdom window gets its own storage, so what a second window
     would read is checked where it is written rather than by opening
     one. */
  const key = [...Object.keys(p.localStorage)].find((k) => k.endsWith(':shelves'));
  eq(!!key, true, 'the choice was written down');
  eq(key.startsWith('sipario:'), true, 'under this deck\'s own key, not a shared one');
  const kept = JSON.parse(p.localStorage.getItem(key));
  eq(kept.now && kept.next, true, 'both are remembered as put away');

  p.document.getElementById('now-btn').click();
  eq(shelf('now'), false, 'and the same button brings it back');
});

check('the script can be made bigger and smaller, and the size is kept', () => {
  /* How far a lectern is from the eyes is a property of the room, not of
     the talk, so this is set in the room and remembered for the next
     time the same deck is opened. */
  const p = newPresenter();
  const size = () => p.document.getElementById('script').style.getPropertyValue('--script');

  const first = size();
  eq(/px$/.test(first), true, `a size is set, read "${first}"`);
  p.document.getElementById('bigger-btn').click();
  const bigger = parseInt(size(), 10);
  eq(bigger > parseInt(first, 10), true, 'bigger is bigger');

  p.document.dispatchEvent(new p.KeyboardEvent('keydown', { key: '-' }));
  eq(size(), first, 'and the key puts it back');

  const key = [...Object.keys(p.localStorage)].find((k) => k.endsWith(':script'));
  eq(!!key, true, 'the size was written down, under this deck\'s own key');

  /* The ends of the range say so rather than letting a press do nothing:
     a live-looking button that answers nothing reads as broken. */
  for (let i = 0; i < 12; i++) p.document.getElementById('bigger-btn').click();
  eq(p.document.getElementById('bigger-btn').disabled, true, 'the top of the range is said');
  for (let i = 0; i < 12; i++) p.document.getElementById('smaller-btn').click();
  eq(p.document.getElementById('smaller-btn').disabled, true, 'and the bottom');
  eq(p.document.getElementById('bigger-btn').disabled, false, 'the other way is still open');

  /* Back to where the suite found it, since the store outlives this
     window and the checks after it read the same key. */
  for (let i = 0; i < 12; i++) p.document.getElementById('bigger-btn').click();
  while (size() !== first) p.document.getElementById('smaller-btn').click();
});

check('the deck hands the notes their own keys, and only while they show', () => {
  /* Docked, the notes are an iframe and the hands are on the deck
     window, so a key the notes own has to travel. Detached, the notes
     hear it themselves, and a forwarded copy would toggle it twice. */
  const src = fs.readFileSync(path.join(ROOT, 'js/deck.js'), 'utf8');
  const fwd = src.match(/type: "panel"[\s\S]{0,80}/);
  if (!fwd) throw new Error('the deck forwards nothing to the notes');
  const block = src.slice(Math.max(0, src.indexOf(fwd[0]) - 320), src.indexOf(fwd[0]) + 80);
  eq(/notesShowing\(\)/.test(block), true, 'it forwards only while the notes show');
  eq(/detached\(\)/.test(block), true, 'and not to a window that hears the key itself');
});

check('a hidden preview is a hidden picture, never a hidden label', () => {
  /* A control that removes itself leaves the way back nowhere to be
     found, which is how a hidden panel becomes a lost feature. */
  const pcss = fs.readFileSync(path.join(ROOT, 'css/presenter.css'), 'utf8');
  eq(/\.shelf\.hidden \.shot-box/.test(pcss), true, 'hiding reaches the preview');
  eq(/\.shelf\.hidden h4\s*\{[^}]*display:\s*none/.test(pcss), false,
     'the label stays on the page when the preview goes');
  /* The control is an icon now, so the state has to be drawn rather than
     spelled: an eye that looks the same either way is a switch nobody
     can read. */
  eq(/\.shelf\.hidden \.eye-slash\s*\{[^}]*opacity:\s*1/.test(pcss), true,
     'a put-away preview is struck through, not just unlit');
  const page = fs.readFileSync(path.join(ROOT, 'lib/pages.js'), 'utf8');
  eq(/class="eye-slash"/.test(page), true, 'the slash is in the markup, so nothing reflows on a press');
});

check('N shows and hides the notes, P does nothing, n no longer steps forward, and PageDown still does', () => {
  /* The notes moved from P to N, and N was a second forward key for a
     clicker; forward is PageDown alone now. */
  const w = windowFor(deckBody, [js], makeBus());
  const d = w.document;
  const key = (k) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
  const at = () => d.querySelector('.slide.current').id;
  const start = at();
  key('p');
  key('P');
  eq(d.body.classList.contains('docked'), false, 'P docks nothing');
  eq(d.getElementById('dock'), null, 'and builds no dock');
  key('n');
  eq(d.body.classList.contains('docked'), true, 'N docks the notes');
  eq(at(), start, 'and does not move the deck');
  key('N');
  eq(d.body.classList.contains('docked'), false, 'N again hides them, shifted or not');
  key('PageDown');
  if (at() === start) throw new Error('PageDown no longer steps forward');
  if (!/<dt>N<\/dt><dd>Show or hide the notes/.test(js) || /<dt>P<\/dt>/.test(js)) {
    throw new Error('the help overlay does not say N');
  }
  const presenter = fs.readFileSync(path.join(ROOT, 'js/presenter.js'), 'utf8');
  if (/k === "n"[^\n]*type: "next"/.test(presenter.replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('the notes window still steps forward on n');
});

check('the notes\' controls are drawn, each named for a screen reader and titled with its key', () => {
  const w = windowFor(deckBody, [js], makeBus());
  const d = w.document;
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n' }));
  const byName = (doc, name) => doc.querySelector(`button[aria-label="${name}"]`);
  for (const [name, key] of [['Detach notes', '(D)'], ['Close notes', '(N)']]) {
    const b = byName(d, name);
    if (!b) throw new Error(`no button named "${name}"`);
    eq(b.textContent.trim(), '', `${name} carries no word, only its drawing`);
    if (!b.querySelector('svg[aria-hidden="true"] path')) throw new Error(`${name} is not drawn`);
    if (!/currentColor/.test(b.innerHTML)) throw new Error(`${name} is not drawn in the text's colour`);
    if (!b.title.includes(key)) throw new Error(`${name}'s title does not give its key: ${b.title}`);
  }
  byName(d, 'Close notes').click();
  eq(d.body.classList.contains('docked'), false, 'Close notes, found by its name, hides them');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n' }));
  byName(d, 'Detach notes').click();
  eq(w.__detached(), true, 'Detach notes, found by its name, detaches them');
  const pres = require('./lib/pages.js').presenterPage(MOVES_DECK, 9999);
  const attach = pres.match(/<button id="attach-btn"[^>]*>([\s\S]*?)<\/button>/);
  if (!attach || !/aria-label="Attach notes"/.test(attach[0])) throw new Error('no button named "Attach notes"');
  if (!/title="[^"]*\(D\)"/.test(attach[0])) throw new Error('its title does not give its keys');
  if (!/^<svg[^>]*aria-hidden="true"[\s\S]*<\/svg>$/.test(attach[1].trim())) throw new Error('attach is not drawn, or carries a word');
  const sheets = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'css/presenter.css'), 'utf8');
  for (const rule of ['.notes-bar button:focus-visible']) {
    if (!sheets.includes(rule)) throw new Error(`no visible focus for ${rule.split(':')[0]}`);
  }
});

check('F with the notes docked moves them to their own window first, and the next F goes full screen', () => {
  /* One key press buys one window-changing act, so going full screen and
     opening the notes cannot share it, and a window opened once full
     screen takes the deck out of it. The notes go first, then the stage. */
  const w = windowFor(deckBody, [js], makeBus());
  const d = w.document;
  let full = 0;
  d.documentElement.requestFullscreen = () => { full++; return Promise.resolve(); };
  const key = (k) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
  key('n');
  eq(d.body.classList.contains('docked'), true, 'docked to start');
  key('f');
  eq(d.body.classList.contains('docked'), false, 'F took the notes off the deck');
  eq(w.__detached(), true, 'into their own window');
  eq(full, 0, 'and did not go full screen on the same press');
  if (!/Press F here for full screen/.test(d.getElementById('ask').textContent)) {
    throw new Error(`the deck does not say what to do next: ${d.getElementById('ask').textContent}`);
  }
  key('f');
  eq(full, 1, 'the next F goes full screen');
  eq(d.body.classList.contains('docked'), false, 'with the notes still off the deck');

  const bare = windowFor(deckBody, [js], makeBus());
  let bareFull = 0;
  bare.document.documentElement.requestFullscreen = () => { bareFull++; return Promise.resolve(); };
  bare.document.dispatchEvent(new bare.KeyboardEvent('keydown', { key: 'f' }));
  eq(bareFull, 1, 'with no notes docked, F goes full screen at once');
  eq(bare.__detached(), false, 'and opens nothing');

  const blocked = windowFor(deckBody, [js], makeBus());
  let blockedFull = 0;
  blocked.document.documentElement.requestFullscreen = () => { blockedFull++; return Promise.resolve(); };
  blocked.open = () => null;
  blocked.document.dispatchEvent(new blocked.KeyboardEvent('keydown', { key: 'n' }));
  blocked.document.dispatchEvent(new blocked.KeyboardEvent('keydown', { key: 'f' }));
  eq(blocked.document.body.classList.contains('docked'), true, 'a blocked window leaves the notes docked');
  eq(blockedFull, 0, 'and the deck does not go full screen over them');
});

check('the notes are never docked and detached at once', () => {
  /* Detached means the deck window shows nothing but slides. Any path that
     leaves both showing puts the script back on the shared screen, which
     is the whole reason the notes can detach at all. */
  const d = deckWin.document;
  const both = () => d.body.classList.contains('docked') && deckWin.__detached();

  const paths = [
    ['n', 'd', 'n'],          // dock, detach, then N out of habit
    ['d', 'n'],               // detach from cold, then N
    ['n', 'd', 'd'],          // dock, detach, re-attach
    ['d', 'd', 'n', 'd'],     // round trip and out again
  ];
  for (const path of paths) {
    d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Escape' }));
    for (const k of path) {
      d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: k }));
      if (both()) throw new Error(`both showing after ${path.join(' ')}`);
    }
  }
});


check('a slide reached by an encoded link is the slide that opens', () => {
  /* A fragment travels the way a URL may carry it, so `#2-café` arrives
     as `#2-caf%C3%A9`. Matched raw against the id on the slide it found
     nothing, opened the first slide instead, and then rewrote the
     address bar from it — losing the link it had been given. */
  const src = MOVES_SRC.replace('id: 2-middle', 'id: 2-café');
  const r = render(src, TALK);
  const body = `<main id="deck" data-deck="${r.deck.key}">${r.html}</main>
    <div id="progress"><div id="progress-bar"></div></div>`;
  const w = windowFor(body, [js], makeBus(), 'http://localhost:9999/#2-caf%C3%A9');
  eq(w.document.querySelector('.slide.current').id, '2-café', 'the slide the link named');
  eq(decodeURIComponent(w.location.hash.slice(1)), '2-café', 'and the address bar still says so');
});

check('a browser that goes before it answers the navigation fails the call without ending the process', () => {
  /* The wait for the load event is created before the navigation is
     sent, so for a moment nothing is holding it. A browser that goes in
     that moment fails both at once, and a rejection nobody is holding
     ends the process — the caller catching this call is not enough, and
     an export would die on the way to its own error message. */
  const probe = `
    const { Session, Page } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
    const ws = {
      send(raw) {
        const m = JSON.parse(raw);
        /* Answers everything until the navigation, then goes. */
        if (m.method === 'Page.navigate') { setImmediate(() => ws.onclose()); return; }
        setImmediate(() => ws.onmessage({ data: JSON.stringify({ id: m.id, result: {} }) }));
      },
      close() {},
    };
    new Page(new Session(ws)).open('about:blank').then(
      () => console.log(JSON.stringify({ resolved: true })),
      (e) => console.log(JSON.stringify({ caught: e.message })));
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  const out = JSON.parse((stdout.trim().split('\n').pop()) || '{}');
  if (!out.caught) throw new Error(`it did not fail the call: ${stdout.trim() || '(nothing)'}`);
  if (status !== 0) {
    throw new Error(`the call failed but the process died anyway (${status}): ` +
      `${stderr.trim().split('\n').filter((l) => /Error|rejection/.test(l))[0] || stderr.trim().split('\n')[0]}`);
  }
});

check('the link the deck writes for a slide opens that slide again', () => {
  /* Reading the fragment decoded only works if writing it encodes, and
     an id may itself hold what looks like an escape: `2-100%20` written
     down bare reads back as `2-100 `, a slide that is not there. This
     moves to the slide, takes the address bar as a person would, and
     opens it in a second window. */
  const src = MOVES_SRC.replace('id: 2-middle', 'id: 2-100%20');
  const r = render(src, TALK);
  const body = `<main id="deck" data-deck="${r.deck.key}">${r.html}</main>
    <div id="progress"><div id="progress-bar"></div></div>`;
  const w1 = windowFor(body, [js], makeBus());
  w1.document.dispatchEvent(new w1.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(w1.document.querySelector('.slide.current').id, '2-100%20', 'the deck is on the slide');
  const wrote = w1.location.hash;
  if (!wrote) throw new Error('the deck wrote no link for the slide it is on');
  const w2 = windowFor(body, [js], makeBus(), `http://localhost:9999/${wrote}`);
  eq(w2.document.querySelector('.slide.current').id, '2-100%20',
    `the link it wrote (${wrote}) opens the slide it wrote it from`);
});

check('a link to a slide that is not there still opens the deck at the start', () => {
  const r = render(MOVES_SRC, TALK);
  const body = `<main id="deck" data-deck="${r.deck.key}">${r.html}</main>
    <div id="progress"><div id="progress-bar"></div></div>`;
  for (const hash of ['#nothing-here', '#%E0%A4%A', '#']) {
    const w = windowFor(body, [js], makeBus(), `http://localhost:9999/${hash}`);
    eq(w.document.querySelector('.slide.current').id, '1-three-movements', `${hash} opens the first slide`);
  }
});

check('the presenter says it is following a deck only once one has spoken', () => {
  /* The page paints itself on load, because the script it was rendered
     with is already in it, and the paint used to be what marked the
     window live. So a /presenter opened with no deck behind it declared
     itself live before anything had answered, and the warning that
     should have replaced the script could never appear. */
  const bus = makeBus();
  const p = windowFor(presenterBody, [presenterJs], bus);
  eq(p.document.body.classList.contains('live'), false, 'nothing has spoken yet');
  p.dispatchEvent(new p.Event('resize'));
  eq(p.document.body.classList.contains('live'), false, 'and painting is not being followed');
  if (!p.document.getElementById('notes').innerHTML.trim()) {
    throw new Error('the script is blank, so this check is not testing what it says');
  }
  windowFor(deckBody, [js], bus);            // a deck opens and says where it is
  eq(p.document.body.classList.contains('live'), true, 'a deck spoke');
  eq(p.document.body.classList.contains('orphan'), false, 'so it is not an orphan');
});

// ---------------------------------------------------------------- the room

/* The audience's half of a talk. The relay is state in this process, so
 * most of what it does is checked by calling it; the pages that talk to
 * it are run in jsdom with their fetch and their event stream wired
 * straight to it; and the server is started once, in a process of its
 * own, to prove what a phone on the network can and cannot reach. */

const { createRelay } = require('./lib/relay.js');
const audienceJs = fs.readFileSync(path.join(ROOT, 'js/audience.js'), 'utf8');

/* A deck opened to the room, and a slide of every kind it can hold. */
const inRoom = (src) => src.replace(/^name: (.*)$/m, 'name: $1\naudience: local');
const ROOM_DECK = render(inRoom(MOVES_SRC), TALK);
const ROOM_MAIN = `<main id="deck" data-deck="${ROOM_DECK.deck.key}" data-audience="local">` +
  `${ROOM_DECK.html}</main>`;

/* A window whose fetch and event stream reach `relay` directly. Streams
   are kept so a check can say when the relay speaks, and whether it can
   be reached at all: `down` makes every request fail, as a room with no
   relay would. */
function roomWindow(body, scripts, relay, { down = false, bus = makeBus(), url = 'http://localhost:9999/', before } = {}) {
  const streams = [];
  const posted = [];
  const win = windowFor(body, scripts, bus, url, (w) => {
    if (before) before(w);
    w.fetch = (url, init) => {
      const msg = JSON.parse(init.body);
      posted.push({ url, msg });
      if (down) return Promise.reject(new Error('the relay is down'));
      const r = (url.endsWith('/phone') ? relay.fromPhone : relay.fromDeck)(msg);
      return Promise.resolve({ ok: r.status === 200, status: r.status,
                               json: () => Promise.resolve(r.body) });
    };
    w.EventSource = fakeStream(streams);
  });
  /* Connected the way a stream connects: the listener hears the current
     state at once, then every change. On the page's one stream the tally
     is an event by name; on a stream of the relay's own, the phone's or
     one elsewhere, it is the stream's only kind. */
  const connect = (es, subscribe) => { es.off = subscribe((event) => es.emit(es.url.startsWith('/events') ? 'tally' : 'message', event)); };
  /* The stream the room speaks on: the page's one stream when it asks
     for the room, else a stream of the relay's own. The latest open. */
  const room = () => streams.filter((es) => es.readyState !== 2 &&
    (/^\/events\?(.*&)?(deck|of)=/.test(es.url) || /\/stream(\?|$)/.test(es.url))).pop();
  return { win, streams, posted, connect, room };
}

/* The pages as the server sends them, run in a window: the markup is
   the real markup, so an id renamed in lib/pages.js and not in the
   runtime fails here rather than in a room. */
const bodyOf = (page) => page.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
const pagesLib = require('./lib/pages.js');
const roomDeck = (r, relay, opts) => roomWindow(bodyOf(pagesLib.deckPage(r)), [js, audienceJs], relay, opts);
const roomPresenter = (r, relay, opts) =>
  roomWindow(bodyOf(pagesLib.presenterPage(r, 9999)), [presenterJs, audienceJs], relay, opts);
/* A deck window's stream connected as the server would connect it: as a
   deck window, by the id in its address; a notes window's, by its deck's. */
const asWindow = (relay, es) => (fn) => {
  const q = new URL(es.url, 'http://x').searchParams;
  return relay.onTally(fn, { deck: q.get('deck'), of: q.get('of') });
};
const roomPhone = (relay) => roomWindow(bodyOf(pagesLib.phonePage('Moves')), [phoneJs], relay);

check('a deck opens the room with `audience:`, and nothing else is a value it takes', () => {
  const body = '# G\n\n## 1.1\nid: 1-a\ntemplate: statement\n\nA.\n\n```notes\nn\n```\n';
  eq(R(body).deck.audience, null, 'no key, no room');
  eq(render(`name: T\naudience: local\n\n${body}`, TALK).deck.audience, 'local', 'a relay inside serve');
  eq(render(`name: T\naudience: https://room.example/talks/\n\n${body}`, TALK).deck.audience,
     'https://room.example/talks', 'a relay elsewhere, its trailing slash gone');
  /* A value it does not know is a typo or a guess, and either would be a
     room that never opens while the deck looks as though it asked. */
  for (const bad of ['loud', 'http://room.example', 'ftp://room.example', '']) {
    let msg = '';
    try { render(`name: T\naudience: ${bad}\n\n${body}`, TALK); } catch (err) { msg = err.message; }
    if (!msg.includes(`audience is ${bad || 'empty'}`) || !msg.includes('`local`')) {
      throw new Error(`audience: ${bad} was not refused by name: ${msg || 'no error'}`);
    }
  }
});

check('a deck with no audience makes no audience request at all', () => {
  /* Structural first: the script that would make one is not on the page. */
  const { deckPage, presenterPage } = require('./lib/pages.js');
  for (const page of [deckPage(MOVES_DECK), presenterPage(MOVES_DECK, 9999)]) {
    if (/audience|qr\.js/.test(page)) throw new Error('a page with no room mentions the audience');
  }
  /* And behavioural: the fixture has run every check above this one, and
     all it ever opened is its one stream, asking for nothing but the
     reload that every page hears. */
  eq(fixture.opened.map((es) => es.url).join(' '), '/events', 'streams the fixture opened');
  eq(fixture.fetched.length, 0, 'requests the fixture made');
});

check('a deck in a room carries its relay and the script that talks to it; the others do not', () => {
  const { deckPage, presenterPage, printPage } = require('./lib/pages.js');
  for (const page of [deckPage(ROOM_DECK), presenterPage(ROOM_DECK, 9999)]) {
    if (!page.includes('data-audience="local"')) throw new Error('a page does not say where its relay is');
    if (!page.includes('<script src="/js/audience.js"></script>')) throw new Error('a page has no room script');
  }
  if (!presenterPage(ROOM_DECK, 9999).includes('data-room-phones')) throw new Error('the notes header has no room in it');
  if (deckPage(ROOM_DECK).includes('id="audience"')) throw new Error('the room panel is on the deck');
  /* On paper the deck is a photograph, and a photograph opens nothing. */
  if (/<script|data-audience/.test(printPage(ROOM_DECK))) throw new Error('the print page reaches for the room');
});

check('the relay knows where the talk is, and tells a phone what is on the stage', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, join: () => 'http://10.0.0.2:10000/' });
  const hello = relay.fromDeck({ type: 'hello', deck: 'sipario:moves', name: 'Moves', title: 'Moves, and a long subtitle' });
  eq(hello.status, 200, 'hello is answered');
  eq(hello.body.session, relay.session, 'with the session');
  eq(hello.body.join, 'http://10.0.0.2:10000/', 'and where phones join');
  eq(relay.stage().deck, 'Moves', "the phones are given the deck's name, not the tab's longer title");
  if (!pagesLib.deckPage(ROOM_DECK).includes('data-name="Moves"')) throw new Error('the deck page does not carry its name for the hello');
  eq(relay.fromDeck({ type: 'slide', id: '2-middle', step: 0 }).status, 200, 'a slide is taken');
  eq(JSON.stringify(relay.state.slide), '{"id":"2-middle","step":0,"v":0}', 'and kept');

  const tallies = [];
  relay.onTally((t) => tallies.push(t));
  const staged = [];
  const off = relay.onStage((s) => staged.push(s));
  eq(staged[0].mode, 'react', 'a phone joining is told what is on stage at once');
  eq(tallies[tallies.length - 1].phones, 1, 'and the deck hears one phone has joined');
  off();
  eq(tallies[tallies.length - 1].phones, 0, 'and that it left');

  for (const bad of [null, { type: 'dance' }, { type: 'slide', id: 3 }]) {
    eq(relay.fromDeck(bad).status, 400, `the deck message ${JSON.stringify(bad)} is refused`);
  }
  eq(relay.fromPhone({ type: 'slide', id: 'x', step: 0 }).status, 400, 'a phone cannot say where the talk is');
  relay.close();
});

check('a deck in a room says where it is as it moves, and only when it moves', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0 });
  const { win, streams, posted } = roomWindow(`${ROOM_MAIN}<div id="progress"><div id="progress-bar"></div></div>`,
    [js, audienceJs], relay);
  eq(posted[0].url, '/audience/deck', 'the local relay is on the deck\'s own origin');
  eq(posted.map((p) => p.msg.type).join(' '), 'hello slide', 'hello, then where it is');
  eq(relay.state.slide.id, '1-three-movements', 'the relay has the first slide');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(relay.state.slide.id, '2-middle', 'and follows the deck to the next movement');
  const before = posted.length;
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp' }));   // nowhere to go
  eq(posted.length, before, 'a key that moved nothing sends nothing');
  eq(streams.map((s) => s.url.replace(/deck=[a-z0-9]+$/, 'deck=<window>')).join(' '), '/events?deck=<window>',
     'and it listens to the relay\'s tally on its one stream, as a deck window, by its id');
  eq(streams[0].url.endsWith('deck=' + win.document.getElementById('deck').getAttribute('data-window')), true, 'its own');
  relay.close();
});

check('a relay that cannot be reached is said once, in the presenter window, and never on the stage', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0 });
  const deckRoom = roomDeck(ROOM_DECK, relay, { down: true });
  const pres = roomPresenter(ROOM_DECK, relay, { down: true });
  eq(pres.posted.length, 0, 'the presenter window never speaks for the deck');
  const note = pres.win.document.querySelector('.notes-bar [data-room-alert]');
  pres.room().onerror();
  pres.room().onerror();
  if (!/not answering/.test(note.textContent)) throw new Error(`the presenter says: "${note.textContent}"`);
  eq(note.textContent.split('not answering').length - 1, 1, 'said once, however often it fails');
  deckRoom.room().onerror();
  if (/not answering/.test(deckRoom.win.document.body.textContent)) throw new Error('the stage was told');
  /* And the deck still moves: the talk does not wait on the room. */
  deckRoom.win.document.dispatchEvent(new deckRoom.win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  eq(deckRoom.win.document.querySelector('.slide.current').id, '2-middle', 'the deck moved on');
  pres.connect(pres.room(), relay.onTally);
  eq(note.textContent, '', 'and the note goes when the relay answers');
  /* With the relay inside serve the stream is the deck's own, and a room
     that is not open says so on it rather than failing it. */
  pres.room().emit('relay', { open: false });
  eq(note.textContent.split('not answering').length - 1, 1, 'a room that is not open is said the same way');
  relay.close();
});

check('an edit to the pages under lib/ reaches the next request, as an edit to the renderer does', () => {
  /* The server held the page writers as the functions it first loaded, so
     the require cache being dropped on a save changed nothing: the notes
     went on being written by the old pages.js, beside new scripts and
     sheets, until a restart. A copy of the library is served and its
     pages.js edited, so this repo's own files are never touched. */
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-reload-'));
  for (const d of ['lib', 'js', 'css']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
  const talkDir = path.join(root, 'talk');
  fs.cpSync(TALK.dir, talkDir, { recursive: true });
  const probe = `
    const fs = require('fs');
    const { serve } = require(${JSON.stringify(path.join(root, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(talkDir)}, { port: 0, log: quiet });
    const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
    const page = async (port) => (await fetch('http://127.0.0.1:' + port + '/presenter')).text();
    (async () => {
      await up(s);
      const port = s.address().port;
      const out = { before: /RELOADED/.test(await page(port)) };
      const file = ${JSON.stringify(path.join(root, 'lib/pages.js'))};
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<title>Presenter', '<title>RELOADED Presenter'));
      out.after = false;
      for (let i = 0; i < 40 && !out.after; i++) {
        await new Promise((ok) => setTimeout(ok, 100));
        out.after = /RELOADED/.test(await page(port));
      }
      console.log(JSON.stringify(out));
      s.close(); process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  fs.rmSync(root, { recursive: true, force: true });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim().split('\n').pop());
  eq(out.before, false, 'the notes page starts as written');
  eq(out.after, true, 'and after pages.js is saved, the next request is written by the new one');
});

check('on the network a phone reaches the room and nothing else: not the deck, not the notes, not the talk', () => {
  /* The listener split, checked from outside. The deck listens on this
     machine alone and the phones get a listener of their own, which
     answers the join page and the room's two routes and 404s the rest. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-room-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const deckFile = path.join(dir, 'deck.md');
  fs.writeFileSync(deckFile, inRoom(fs.readFileSync(deckFile, 'utf8')));
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const http = require('http');
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(dir)}, { port: 0, log: quiet });
    const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
    /* The first event of a name on a stream, or of none when none is given. */
    const first = (port, p, name = 'message') => new Promise((ok) => http.get({ host: '127.0.0.1', port, path: p }, (r) => {
      let buf = '';
      r.on('data', (c) => {
        buf += c;
        for (let i = buf.indexOf('\\n\\n'); i > -1; i = buf.indexOf('\\n\\n')) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (((/^event: (.*)$/m.exec(block) || [])[1] || 'message') !== name) continue;
          ok(JSON.parse(/^data: (.*)$/m.exec(block)[1])); r.destroy(); return;
        }
      });
    }));
    const status = async (port, p, init) => (await fetch('http://127.0.0.1:' + port + p, init)).status;
    const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    (async () => {
      await up(s); await up(s.room.server);
      const deck = s.address().port, phone = s.room.port;
      const out = {
        deckHost: s.address().address,
        phoneHost: s.room.server.address().address,
        page: await status(phone, '/'),
        script: await status(phone, '/phone.js'),
        sheet: await status(phone, '/phone.css'),
        refused: {},
        hello: await (await fetch('http://127.0.0.1:' + deck + '/audience/deck', json({ type: 'hello', deck: 'x', title: 'Minimal' }))).json(),
        plain: await status(deck, '/audience/deck', { method: 'POST', body: '{"type":"hello"}' }),
        plainPhone: await status(phone, '/phone', { method: 'POST', body: '{"type":"react"}' }),
        tally: await first(deck, '/events?of=', 'tally'),
        stage: await first(phone, '/stream'),
      };
      for (const p of ['/presenter', '/print', '/js/deck.js', '/js/audience.js', '/js/presenter.js', '/js/events.js',
                       '/events', '/css/presenter.css', '/templates/title.html', '/templates/icon-list.js',
                       '/audience/deck', '/deck.md', '/images/..%2fdeck.md',
                       '/fonts/..%2fdeck.md', '/slide/1-a-slide-of-every-template/0', '/images/one-piece.svg']) {
        out.refused[p] = await status(phone, p);
      }
      out.served = {};
      for (const p of ['/css/theme.css', '/deck.css', '/templates/title.css', '/fonts/inter.woff2', '/images/bg-blob.svg']) {
        out.served[p] = await status(phone, p);
      }
      out.front = /id="screen"/.test(await (await fetch('http://127.0.0.1:' + phone + '/')).text());
      /* A phone loads each slide into a fresh frame; the fonts must not
         travel again each time. */
      const font = await fetch('http://127.0.0.1:' + phone + '/fonts/inter.woff2');
      await font.arrayBuffer();
      out.again = await status(phone, '/fonts/inter.woff2', { headers: { 'if-modified-since': font.headers.get('last-modified') } });
      console.log(JSON.stringify(out));
      s.close(); process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim().split('\n').pop());
  eq(out.deckHost, '127.0.0.1', 'with the room open, the deck listens on this machine alone');
  eq(out.phoneHost, '0.0.0.0', 'and the phones get a listener on the network');
  eq(out.page, 200, 'which serves the join page');
  eq(out.script, 200, 'its script');
  eq(out.sheet, 200, 'and its sheet');
  for (const [p, code] of Object.entries(out.refused)) eq(code, 404, `a phone asking for ${p}`);
  /* What a slide is drawn with, and nothing else of the talk. */
  for (const [p, code] of Object.entries(out.served)) eq(code, 200, `a phone asking for ${p}`);
  eq(out.front, true, "the phone listener's front page is the phone's, not the deck's");
  eq(out.again, 304, 'and a font the phone already has is not sent again');
  eq(out.hello.ok, true, 'the deck says hello on its own listener');
  eq(out.plain, 415, 'a message that does not say it is JSON is refused, so no other site can send one');
  eq(out.plainPhone, 415, 'on either listener');
  eq(out.tally.type, 'tally', 'the deck hears the tally as it connects');
  if (!/^http:\/\/[^/]+:\d+\/$/.test(out.tally.join)) throw new Error(`the join address is ${out.tally.join}`);
  eq(out.stage.type, 'stage', 'and a phone hears the stage');
  eq(out.stage.deck, 'Minimal', 'named for the talk');
});

check('the pace is read from the last minute, one voice per phone, and not at all from fewer than three', () => {
  /* The contract of lib/pace.js, which is the one piece of this a talk's
     owner may want to reshape. Whatever it becomes, these are the
     promises the panel is drawn on. */
  const { paceReading, DEFAULTS } = require('./lib/pace.js');
  const at = 10 * 60 * 1000;
  const sig = (token, value, ago = 0) => ({ token, value, at: at - ago });
  eq(JSON.stringify(paceReading([], at)), '{"reading":null,"slower":0,"ok":0,"faster":0,"n":0}', 'nobody');
  const two = paceReading([sig('a', -1), sig('b', -1)], at);
  eq(two.reading, null, 'two phones are not a reading');
  eq(two.slower, 2, 'though they are counted');
  eq(paceReading([sig('a', -1), sig('b', -1), sig('c', -1)], at).reading, -1, 'all asking for slower is -1');
  eq(paceReading([sig('a', 1), sig('b', 1), sig('c', 1)], at).reading, 1, 'all asking for faster is +1');
  eq(paceReading([sig('a', 1), sig('b', 0), sig('c', -1), sig('d', 1)], at).reading, 0.25,
     'and between, (faster - slower) over everyone who spoke');
  const changed = paceReading([sig('a', -1, 30000), sig('a', 1, 10000), sig('b', 0), sig('c', 0)], at);
  eq(changed.n, 3, 'a phone that changed its mind is one phone');
  eq(`${changed.slower}/${changed.faster}`, '0/1', 'counted as what it said last');
  eq(paceReading([sig('a', 1, 10000), sig('a', -1, 30000), sig('b', 0), sig('c', 0)], at).faster, 1,
     'whatever order the signals come in');
  const old = [sig('a', -1, DEFAULTS.window + 1), sig('b', 0), sig('c', 0), sig('d', 0)];
  eq(paceReading(old, at).slower, 0, 'a signal older than the window counts for nothing');
  eq(paceReading([sig('a', -1, DEFAULTS.window)], at).slower, 1, 'one at its edge still counts');
  eq(paceReading([{ token: 'a', value: -1, at: at + 1 }], at).n, 0, 'nor does one from the future');
  eq(paceReading([{ token: 'a', value: 2, at }, { token: 'b', value: '1', at }], at).n, 0,
     'a value other than -1, 0 or 1 is not a signal');
  eq(paceReading([sig('a', 1)], at, { minimum: 1 }).reading, 1, 'the floor is an option');
  eq(paceReading([sig('a', 1, 5000)], at, { window: 1000 }).n, 0, 'and so is the window');
  const input = [sig('a', 1), sig('a', -1, 1)];
  const copy = JSON.stringify(input);
  paceReading(input, at);
  eq(JSON.stringify(input), copy, 'and it changes nothing it is handed');
});

check('a reaction is counted once, and a phone pressing too fast is told to wait', () => {
  const { LIMITS } = require('./lib/relay.js');
  let t = 0;
  const relay = createRelay({ throttle: 0, tick: 0, now: () => t });
  relay.fromDeck({ type: 'slide', id: '2-middle', step: 0 });
  const react = (token, kind = 'clap') => relay.fromPhone({ type: 'react', token, kind }).status;
  for (let i = 0; i < LIMITS.react.each; i++) eq(react('phone-aaaa'), 200, `reaction ${i + 1}`);
  eq(react('phone-aaaa'), 429, `reaction ${LIMITS.react.each + 1} inside the window waits`);
  eq(react('phone-bbbb'), 200, 'another phone does not');
  t = LIMITS.react.per;
  eq(react('phone-aaaa'), 200, 'and the first may go again once the window has passed');
  const clap = relay.tally().reactions.find((r) => r.kind === 'clap');
  eq(clap.count, LIMITS.react.each + 2, 'the tally counts what was taken, and nothing refused');
  if (!clap.emoji) throw new Error('the tally does not say how to draw a reaction');
  eq(relay.slides.get('2-middle').reactions.clap, LIMITS.react.each + 2, 'and so does the slide it landed on');
  eq(react('phone-aaaa', 'boo'), 400, 'a reaction outside the set is refused');
  eq(react('short'), 400, 'and so is a token that is not one');
  eq(relay.tally().joined, 2, 'two phones have spoken');
  relay.close();
});

check('the room as a whole has a ceiling, however many tokens one phone makes', () => {
  /* A token is made by the phone, so a phone that wanted to could make a
     new one for every press. The room's ceiling is what bounds that. */
  const { LIMITS } = require('./lib/relay.js');
  const relay = createRelay({ throttle: 0, tick: 0, now: () => 0 });
  for (let i = 0; i < LIMITS.react.room; i++) {
    const s = relay.fromPhone({ type: 'react', token: `token-${String(i).padStart(4, '0')}`, kind: 'wow' }).status;
    if (s !== 200) throw new Error(`reaction ${i + 1} was refused before the ceiling`);
  }
  eq(relay.fromPhone({ type: 'react', token: 'token-fresh', kind: 'wow' }).status, 429, 'past the ceiling, a new token waits too');
  relay.close();
});

check("a phone's pace is its latest word, and the deck is told the room's", () => {
  let t = 0;
  const relay = createRelay({ throttle: 0, tick: 0, now: () => t });
  relay.fromDeck({ type: 'slide', id: '2-rows', step: 1 });
  const pace = (token, value) => relay.fromPhone({ type: 'pace', token, value }).status;
  eq(pace('phone-aaaa', -1), 200, 'a phone asks for slower');
  eq(pace('phone-aaaa', 1), 429, 'and cannot say it again at once');
  eq(pace('phone-bbbb', -1), 200, 'a second agrees');
  eq(pace('phone-cccc', 1), 200, 'a third wants faster');
  t = 2000;
  eq(pace('phone-aaaa', 1), 200, 'the first changes its mind');
  const p = relay.tally().pace;
  eq(`${p.slower} ${p.ok} ${p.faster}`, '1 0 2', 'the room, one voice a phone');
  eq(Math.round(p.reading * 1000), 333, 'reads a third of the way to faster');
  eq(relay.fromPhone({ type: 'pace', token: 'phone-dddd', value: 5 }).status, 400, 'a pace that is not -1, 0 or 1 is refused');
  eq(JSON.stringify(relay.slides.get('2-rows').pace), '{"slower":2,"ok":0,"faster":2}',
     'and the slide keeps every word it heard');
  relay.close();
});

check('the presenter window shows the reactions and the pace; the stage, by default, neither', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, join: () => 'http://10.0.0.2:10000/' });
  const deckRoom = roomDeck(ROOM_DECK, relay);
  const pres = roomPresenter(ROOM_DECK, relay);
  deckRoom.connect(deckRoom.room(), relay.onTally);
  pres.connect(pres.room(), relay.onTally);
  const doc = pres.win.document;
  eq(doc.getElementById('audience'), null, 'the notes carry no room section: the header says it all');
  for (const [tok, v] of [['phone-aaaa', -1], ['phone-bbbb', -1], ['phone-cccc', -1], ['phone-dddd', 1]]) {
    relay.fromPhone({ type: 'pace', token: tok, value: v });
  }
  relay.fromPhone({ type: 'react', token: 'phone-aaaa', kind: 'clap' });
  relay.fromPhone({ type: 'react', token: 'phone-bbbb', kind: 'clap' });
  const bar = doc.querySelector('.notes-bar [data-room-reactions]');
  if (!bar || !/\u{1F44F}.2/u.test(bar.textContent)) {
    throw new Error(`the notes' header does not count the claps: ${bar && bar.textContent}`);
  }
  eq(doc.getElementById('room-reactions'), null, 'and the body no longer carries a line of them');
  /* Docked, the header is the deck page's own bar: built on N, and filled
     from the count already in hand rather than the next one. */
  const dd = deckRoom.win.document;
  dd.dispatchEvent(new deckRoom.win.KeyboardEvent('keydown', { key: 'n' }));
  const dockBar = dd.querySelector('#dock-bar [data-room-reactions]');
  if (!dockBar || !/\u{1F44F}.2/u.test(dockBar.textContent)) {
    throw new Error(`the dock's header does not count the claps: ${dockBar && dockBar.textContent}`);
  }
  const pace = doc.querySelector('.notes-bar [data-room-pace]');
  if (!pace || !/3 slower/.test(pace.textContent)) throw new Error('the counts are not said in the header');
  if (!/^\d+ phones?$/.test(doc.querySelector('.notes-bar [data-room-phones]').textContent)) {
    throw new Error(`the header does not count the phones: ${doc.querySelector('.notes-bar [data-room-phones]').textContent}`);
  }
  const order = [...doc.querySelectorAll('.notes-bar [data-room-phones], .notes-bar [data-room-reactions], .notes-bar [data-room-pace]')]
    .map((el) => Object.keys(el.dataset)[0]);
  eq(order.join(' '), 'roomPhones roomReactions roomPace', 'phones, then reactions, then the pace');
  eq(deckRoom.win.document.getElementById('reactions'), null, 'nothing floats on the stage');
  relay.close();
});

check('asked to, the stage floats what the room reacts with', () => {
  const r = render(inRoom(MOVES_SRC).replace('audience: local', 'audience: local\naudience-reactions: stage'), TALK);
  eq(r.deck.reactionsOnStage, true, 'the deck asked');
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0 });
  const deckRoom = roomDeck(r, relay);
  deckRoom.connect(deckRoom.room(), relay.onTally);
  for (const tok of ['phone-aaaa', 'phone-bbbb', 'phone-cccc']) relay.fromPhone({ type: 'react', token: tok, kind: 'love' });
  eq(deckRoom.win.document.querySelectorAll('#reactions .reaction').length, 3, 'one rises per reaction');
  for (let i = 0; i < 5; i++) relay.fromPhone({ type: 'react', token: 'phone-dddd', kind: 'wow' });
  const floating = deckRoom.win.document.querySelectorAll('#reactions .reaction').length;
  if (floating > 3 + 5) throw new Error(`${floating} reactions rose from eight`);
  relay.close();
});

check('audience-reactions takes `stage` alone, and only in a deck with a room', () => {
  const body = '# G\n\n## 1.1\nid: 1-a\ntemplate: statement\n\nA.\n\n```notes\nn\n```\n';
  for (const [head, want] of [['audience-reactions: stage', 'needs `audience:`'],
                              ['audience: local\naudience-reactions: screen', 'audience-reactions is screen']]) {
    let msg = '';
    try { render(`name: T\n${head}\n\n${body}`, TALK); } catch (err) { msg = err.message; }
    if (!msg.includes(want)) throw new Error(`"${head}" was not refused by name: ${msg || 'no error'}`);
  }
});

check('a phone in the room reacts and signals the pace, with a token it made and kept', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0 });
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const doc = phone.win.document;
  eq(doc.querySelectorAll('.reactions button').length, 5, 'a button per reaction');
  eq(doc.querySelectorAll('.pace button').length, 3, 'and three for the pace');
  doc.querySelector('.reactions button').click();
  doc.querySelectorAll('.pace button')[0].click();
  eq(phone.posted.map((p) => `${p.url} ${p.msg.type}`).join(', '), '/phone react, /phone pace', 'both sent');
  const tok = phone.posted[0].msg.token;
  if (!/^[0-9a-f]{24}$/.test(tok)) throw new Error(`the token is ${tok}`);
  eq(phone.posted[1].msg.token, tok, 'the same token both times');
  eq(phone.win.localStorage.getItem('sipario-token'), tok, 'kept in the phone');
  eq(relay.tally().reactions[0].count, 1, 'and the relay counted it');
  relay.close();
});

/* A deck with a room, and one poll slide under test. `tpl` and the poll's
   lines are what each refusal below varies. */
const pollDeck = (poll, { tpl = 'poll', head = 'audience: local\n', more = '' } = {}) =>
  `name: T\n${head}\n# G\n\n## 1.1 Asked\nid: 1-asked\ntemplate: ${tpl}\n\n` +
  `\`\`\`poll\n${poll}\n\`\`\`\n\n\`\`\`notes\nn\n\`\`\`\n${more}`;
const GOOD_POLL = 'id: which\nquestion: Which one?\n- This\n- That';

check('a poll the room could not answer stops the render, and each reason is named', () => {
  const refused = (src, want, opts = TALK) => {
    let msg = '';
    try { render(src, opts); } catch (err) { msg = err.message; }
    if (!msg.includes(want)) throw new Error(`expected "${want}", got: ${msg || 'no error'}`);
  };
  refused(pollDeck(GOOD_POLL, { head: '' }), 'a poll, in a deck with no `audience:`');
  refused(pollDeck(GOOD_POLL, { tpl: 'statement' }), 'the statement template never prints a poll');
  refused(pollDeck('id: which\nquestion: Which one?\n- Only this'), 'the poll has 1 option; it needs two at least');
  refused(pollDeck('id: which\nquestion: Which one?'), 'the poll has 0 options');
  refused(pollDeck('question: Which one?\n- This\n- That'), 'the poll declares no `id:`');
  refused(pollDeck('id: Which One\nquestion: Which one?\n- This\n- That'), 'is not lowercase letters, digits and hyphens');
  refused(pollDeck('id: which\n- This\n- That'), 'the poll asks no `question:`');
  refused(pollDeck(`${GOOD_POLL}\nanswer: This`), '"answer: This" is not `id:`, `question:` or a `- ` option');
  refused(pollDeck(GOOD_POLL, { more: `\n## 1.2 Again\nid: 1-again\ntemplate: poll\n\n\`\`\`poll\n${GOOD_POLL}\n\`\`\`\n\n\`\`\`notes\nn\n\`\`\`\n` }),
          'poll id "which" is already 1-asked\'s');
  refused(pollDeck(GOOD_POLL, { more: `\n--\n\n\`\`\`poll\nid: other\nquestion: And?\n- A\n- B\n\`\`\`\n\n\`\`\`notes\nn\n\`\`\`\n` }),
          '1-asked: 2 polls; a slide holds one');
  refused('name: T\naudience: local\n\n# G\n\n## 1.1 Asked\nid: 1-asked\ntemplate: poll\n\n```poll\nid: x\n',
          'a ```poll block is never closed');
  /* A template may print the poll and still give the room's answers
     nowhere to land. That is refused too, rather than drawing bars that
     never move. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-unmarked-'));
  fs.writeFileSync(path.join(dir, 'bare.html'),
    '<p class="bare-q">{{poll.question}}</p>\n\n<ul>{{#poll.options}}<li>{{text}}</li>{{/poll.options}}</ul>\n');
  refused(pollDeck(GOOD_POLL, { tpl: 'bare' }), 'the bare template marks no element data-option="0"',
          { templateRoot: dir, imageRoot: TALK.imageRoot });
  fs.rmSync(dir, { recursive: true, force: true });
});

check('a poll reaches its template whole, and stays on the stage for the rest of its slide', () => {
  const r = render(pollDeck(GOOD_POLL, { more: '\n--\n\n```notes\nm\n```\n' }), TALK);
  const steps = [...r.html.matchAll(/<section class="slide[^"]*" id="([^"]+)"[^>]*?(?: data-poll="([^"]*)")?>([\s\S]*?)<aside/g)];
  eq(steps.length, 2, 'two steps');
  for (const [, id, poll, body] of steps) {
    if (!poll) throw new Error(`${id} does not carry the poll`);
    const data = JSON.parse(poll.replace(/&quot;/g, '"'));
    eq(JSON.stringify(data), '{"id":"which","question":"Which one?","options":["This","That"]}', `${id}: the poll, whole`);
    eq((body.match(/data-option="\d"/g) || []).join(' '), 'data-option="0" data-option="1"', `${id}: each option marked`);
    if (/```|id: which/.test(body)) throw new Error(`${id}: the poll block reached the stage as text`);
  }
});

check('on paper a poll prints its question and its options, and no answers', () => {
  const { printPage } = require('./lib/pages.js');
  const page = printPage(render(fs.readFileSync(TALK.deck, 'utf8'), TALK));
  const poll = page.match(/<section class="slide template-poll[\s\S]*?<\/section>/);
  if (!poll) throw new Error('the example has no poll to print');
  if (!/class="poll-question">[^<]+</.test(poll[0])) throw new Error('the question is not printed');
  if ((poll[0].match(/class="poll-option"/g) || []).length < 2) throw new Error('the options are not printed');
  if (/data-votes|--share|<script/.test(poll[0])) throw new Error('the printed poll carries answers or a script');
});

check('one vote a phone, the last one standing, and only while its poll is on the stage', () => {
  const relay = createRelay({ throttle: 0, tick: 0 });
  const open = { type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That', 'Other'] };
  const vote = (token, option, poll = 'which') => relay.fromPhone({ type: 'vote', token, poll, option }).status;
  eq(vote('phone-aaaa', 0), 409, 'nothing is open yet');
  eq(relay.fromDeck(open).status, 200, 'the deck opens the poll');
  eq(relay.stage().mode, 'poll', 'and the phones are shown it');
  eq(vote('phone-aaaa', 0), 200, 'a phone votes');
  eq(vote('phone-aaaa', 2), 200, 'and changes its mind');
  eq(vote('phone-bbbb', 2), 200, 'another agrees with its second thought');
  eq(vote('phone-cccc', 3), 400, 'an option that is not there is refused');
  eq(vote('phone-cccc', 0, 'other'), 409, 'and so is a poll that is not on the stage');
  eq(JSON.stringify(relay.tally().polls.which), '{"votes":[0,0,2],"total":2}', 'two phones, two votes, both on Other');
  relay.fromDeck({ type: 'poll-close', id: 'which' });
  eq(relay.stage().mode, 'react', 'closed, the phones go back to reacting');
  eq(vote('phone-dddd', 1), 409, 'and a late vote is refused');
  relay.fromDeck(open);
  eq(relay.tally().polls.which.total, 2, 'opened again, the answers are still there');
  relay.fromDeck({ ...open, options: ['This', 'That'] });
  eq(relay.tally().polls.which.total, 0, 'but new options are a new question, and start again');
  relay.fromDeck({ type: 'poll-close' });
  eq(relay.tally().poll, null, 'a close that names nothing closes what is open');
  eq(relay.fromDeck({ ...open, options: ['Only'] }).status, 400, 'a poll of one option is refused here too');
  relay.close();
});

check('the room answers a poll on its phones, and the deck draws the answers where the template marked them', () => {
  const relay = createRelay({ deck: 'T', throttle: 0, tick: 0, join: () => 'http://10.0.0.2:10000/' });
  const deckRoom = roomDeck(render(pollDeck(GOOD_POLL), TALK), relay);
  eq(deckRoom.posted.map((p) => p.msg.type).join(' '), 'hello slide', 'the deck says where it is');
  eq(relay.tally().poll, 'which', 'and the relay, knowing where the poll sits, opens it');
  deckRoom.connect(deckRoom.room(), relay.onTally);
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const pdoc = phone.win.document;
  eq(pdoc.querySelector('.question').textContent, 'Which one?', 'the phone shows the question');
  const buttons = pdoc.querySelectorAll('.options button');
  eq(buttons.length, 2, 'and an answer per option');
  buttons[1].click();
  const sent = phone.posted[phone.posted.length - 1].msg;
  eq(`${sent.type} ${sent.poll} ${sent.option}`, 'vote which 1', 'a tap is a vote for that option');
  relay.fromPhone({ type: 'vote', token: 'phone-bbbb', poll: 'which', option: 1 });
  relay.fromPhone({ type: 'vote', token: 'phone-cccc', poll: 'which', option: 0 });
  relay.fromPhone({ type: 'vote', token: 'phone-dddd', poll: 'which', option: 1 });
  const opts = deckRoom.win.document.querySelectorAll('.slide.current [data-option]');
  eq([...opts].map((o) => o.getAttribute('data-votes')).join(' '), '1 3', 'each option carries its votes');
  eq([...opts].map((o) => o.style.getPropertyValue('--share')).join(' '), '0.25 0.75', 'and its share');
  eq(deckRoom.win.document.querySelector('[data-join]').textContent, '10.0.0.2:10000', 'the join address is filled in');
  relay.close();
});

check('the presenter window counts the answers, and its previews show them', () => {
  const relay = createRelay({ deck: 'T', throttle: 0, tick: 0 });
  const r = render(pollDeck(GOOD_POLL), TALK);
  const pres = roomPresenter(r, relay);
  pres.connect(pres.room(), relay.onTally);
  relay.fromDeck({ type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That'] });
  relay.fromPhone({ type: 'vote', token: 'phone-aaaa', poll: 'which', option: 0 });
  eq(pres.win.document.querySelector('.notes-bar [data-room-alert]').textContent, 'poll which: 1 answer', 'the panel counts');
  eq(pres.win.document.querySelector('#deck [data-option="0"]').getAttribute('data-votes'), '1',
     'and the copy the previews are cloned from has the answers');
  relay.close();
});

const FORM = '```feedback\n- rate: How useful?\n- ask: What would you change?\n```\n';
const formDeck = (form = FORM, head = 'audience: local\n', more = '') =>
  `name: T\n${head}\n# G\n\n## 1.1 End\nid: 1-end\ntemplate: statement\n\nThanks.\n\n${form}\n\`\`\`notes\nn\n\`\`\`\n${more}`;

check('a feedback form the room could not fill in stops the render, and each reason is named', () => {
  const refused = (src, want) => {
    let msg = '';
    try { render(src, TALK); } catch (err) { msg = err.message; }
    if (!msg.includes(want)) throw new Error(`expected "${want}", got: ${msg || 'no error'}`);
  };
  refused(formDeck(FORM, ''), 'a feedback form, in a deck with no `audience:`');
  refused(formDeck('```feedback\n- score: How useful?\n```\n'), '"score:" is not a kind of question; it is rate or ask');
  refused(formDeck('```feedback\nHow useful?\n```\n'), '"How useful?" is not a `- rate:` or `- ask:` question');
  refused(formDeck('```feedback\n```\n'), 'the form asks nothing');
  refused(formDeck(FORM, 'audience: local\n', `\n## 1.2 Again\nid: 1-again\ntemplate: statement\n\nAgain.\n\n${FORM}\n\`\`\`notes\nn\n\`\`\`\n`),
          '2 feedback forms, at 1-end and 1-again; a deck has one');
  refused('name: T\naudience: local\n\n# G\n\n## 1.1 End\nid: 1-end\ntemplate: statement\n\nThanks.\n\n' +
          '```feedback\n- rate: How useful?\n', 'a ```feedback block is never closed');
  const r = render(formDeck(), TALK);
  const step = r.html.match(/<section[^>]* data-feedback="([^"]*)"[^>]*>([\s\S]*?)<aside/);
  if (!step) throw new Error('the step does not carry its form');
  eq(step[1].replace(/&quot;/g, '"'), '{"questions":[{"kind":"rate","text":"How useful?"},{"kind":"ask","text":"What would you change?"}]}',
     'the form, whole, on its step');
  if (/How useful/.test(step[2])) throw new Error('the form reached the stage as text');
});

check('the form stays open once reached, a poll goes before it, and a phone sends it whole', () => {
  const relay = createRelay({ throttle: 0, tick: 0 });
  const QS = [{ kind: 'rate', text: 'How useful?' }, { kind: 'ask', text: 'What would you change?' }];
  const send = (token, answers) => relay.fromPhone({ type: 'feedback', token, answers }).status;
  eq(send('phone-aaaa', [5, null]), 409, 'not before the deck reaches it');
  relay.fromDeck({ type: 'feedback-open', questions: QS });
  eq(relay.stage().mode, 'feedback', 'the phones show the form');
  relay.fromDeck({ type: 'poll-open', id: 'late', question: 'One more?', options: ['Yes', 'No'] });
  eq(relay.stage().mode, 'poll', 'a poll on the stage goes first');
  relay.fromDeck({ type: 'poll-close', id: 'late' });
  eq(relay.stage().mode, 'feedback', 'and the form comes back after it');
  eq(send('phone-aaaa', [6, null]), 400, 'a score is 1 to 5');
  eq(send('phone-aaaa', [3, 'x'.repeat(501)]), 400, 'an answer has a length');
  eq(send('phone-aaaa', [3]), 400, 'a form is answered whole');
  eq(send('phone-aaaa', [null, '  ']), 400, 'and not empty');
  eq(send('phone-aaaa', [2, 'Slower, please']), 200, 'a phone sends its form');
  eq(send('phone-aaaa', [4, 'More demos']), 200, 'and sends it again, changed');
  eq(send('phone-bbbb', [5, null]), 200, 'a second phone rates without writing');
  eq(relay.tally().feedback, 2, 'two forms, the second of the first phone replacing its first');
  if (/demos|Slower/.test(JSON.stringify(relay.tally()))) throw new Error('what somebody typed reached the deck');
  eq(JSON.stringify(relay.record().feedback.responses), '[[4,"More demos"],[5,null]]', 'the record keeps the answers');
  relay.close();
});

check('a session goes to disk once a phone has spoken, as counts and no token', () => {
  const saved = [];
  let t = Date.parse('2026-09-27T10:00:00Z');
  const relay = createRelay({ deck: 'T', throttle: 0, tick: 0, every: 0, now: () => t, save: (r) => saved.push(r) });
  relay.fromDeck({ type: 'slide', id: '1-asked', step: 0 });
  relay.fromDeck({ type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That'] });
  relay.close();
  eq(saved.length, 0, 'a session nobody joined leaves nothing behind');

  const relay2 = createRelay({ deck: 'T', throttle: 0, tick: 0, every: 60000, now: () => t, save: (r) => saved.push(r) });
  relay2.fromDeck({ type: 'slide', id: '1-asked', step: 0 });
  relay2.fromDeck({ type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That'] });
  relay2.fromPhone({ type: 'vote', token: 'secret-token-1', poll: 'which', option: 1 });
  relay2.fromPhone({ type: 'react', token: 'secret-token-2', kind: 'clap' });
  relay2.fromPhone({ type: 'pace', token: 'secret-token-2', value: 1 });
  eq(saved.length, 0, 'writes wait and gather');
  t += 1000;
  relay2.close();
  eq(saved.length, 1, 'and closing writes what was waiting');
  const rec = saved[0];
  eq(rec.session, relay2.session, 'named for its session');
  eq(rec.joined, 2, 'two phones');
  eq(JSON.stringify(rec.polls), '[{"id":"which","question":"Which one?","total":1,"options":[{"text":"This","votes":0},{"text":"That","votes":1}]}]', 'the poll, counted');
  eq(rec.reactions.clap, 1, 'the reactions');
  eq(JSON.stringify(rec.slides[0]), '{"id":"1-asked","reactions":{"clap":1,"love":0,"laugh":0,"wow":0,"think":0},"pace":{"slower":0,"ok":0,"faster":1}}',
     'and what was said while each slide was up');
  if (/secret-token/.test(JSON.stringify(rec))) throw new Error('a token reached the record');
});

check('results come out as JSON and a long CSV, beside the command and never in the talk', () => {
  const { saveSession, listSessions, toCsv, exportResults, dataDir } = require('./lib/results.js');
  eq(dataDir({ SIPARIO_DATA: '/x/y' }), '/x/y', 'the data folder can be named');
  eq(dataDir({}, 'darwin', '/Users/a'), '/Users/a/Library/Application Support/sipario', 'on a Mac');
  eq(dataDir({}, 'linux', '/home/a'), '/home/a/.local/share/sipario', 'elsewhere');
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-results-'));
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-out-'));
  const rec = (session) => ({
    deck: 'Minimal', session, started: '', updated: '', joined: 3,
    polls: [{ id: 'which', question: 'Which, then?', total: 3, options: [{ text: 'This', votes: 2 }, { text: 'That', votes: 1 }] }],
    reactions: { clap: 4, love: 0 },
    slides: [{ id: '3-poll', reactions: { clap: 4, love: 0 }, pace: { slower: 1, ok: 0, faster: 0 } }],
    feedback: { questions: [{ kind: 'rate', text: 'Useful?' }, { kind: 'ask', text: 'Change?' }],
                responses: [[5, '=SUM(A1) "quoted", yes'], [4, null]] },
  });
  saveSession('sipario:minimal', rec('20260927-0900-aaaa'), root);
  saveSession('sipario:minimal', rec('20260927-1400-bbbb'), root);
  eq(listSessions('sipario:minimal', root).join(' '), '20260927-0900-aaaa 20260927-1400-bbbb', 'oldest first');
  const r = exportResults(TALK.dir, { into: out, root });
  eq(path.basename(r.json), 'minimal-20260927-1400-bbbb.json', 'the latest, named for the talk and the session');
  eq(fs.readdirSync(out).sort().join(' '), 'minimal-20260927-1400-bbbb.csv minimal-20260927-1400-bbbb.json', 'both, where asked');
  eq(JSON.parse(fs.readFileSync(r.json, 'utf8')).polls[0].options[0].votes, 2, 'the JSON is the record');
  const csv = fs.readFileSync(r.csv, 'utf8').trim().split('\n');
  eq(csv[0], 'kind,id,question,answer,count', 'a header');
  for (const row of ['poll,which,"Which, then?",This,2', 'reaction,,,clap,4', 'slide-reaction,3-poll,,clap,4',
                     'slide-pace,3-poll,,slower,1', 'rating,q1,Useful?,5,1', 'rating,q1,Useful?,3,0',
                     `answer,q2,Change?,"'=SUM(A1) ""quoted"", yes",1`]) {
    if (!csv.includes(row)) throw new Error(`no row ${row} in:\n${csv.join('\n')}`);
  }
  if (csv.some((l) => /^reaction,,,love/.test(l)) === false) throw new Error('a reaction nobody sent is still a row, at 0');
  if (csv.some((l) => /slide-reaction,3-poll,,love/.test(l))) throw new Error('a slide lists a reaction it never had');
  eq(path.basename(exportResults(TALK.dir, { into: out, root, session: '20260927-0900-aaaa' }).json),
     'minimal-20260927-0900-aaaa.json', 'an earlier session by name');
  let msg = '';
  try { exportResults(TALK.dir, { into: out, root, session: 'nope' }); } catch (err) { msg = err.message; }
  if (!/no session nope.*20260927-0900-aaaa/.test(msg)) throw new Error(`a wrong session is not named back: ${msg}`);
  msg = '';
  try { exportResults(path.join(ROOT, 'starters/stylish'), { into: out, root }); } catch (err) { msg = err.message; }
  if (!/no sessions of "Stylish"/.test(msg)) throw new Error(`a talk with none says so: ${msg}`);
  eq(toCsv({ polls: [], reactions: {}, slides: [], feedback: null }), 'kind,id,question,answer,count\n', 'an empty session is a header');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

check('a phone fills in the form and sends it whole, and the answers come out of `sipario results`', () => {
  /* In a window first: the form the phone shows. */
  const relay = createRelay({ deck: 'T', throttle: 0, tick: 0 });
  relay.fromDeck({ type: 'feedback-open', questions: [{ kind: 'rate', text: 'Useful?' }, { kind: 'ask', text: 'Change?' }] });
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const doc = phone.win.document;
  eq(doc.querySelectorAll('.scale button').length, 5, 'a score of 1 to 5');
  doc.querySelectorAll('.scale button')[3].click();
  const area = doc.querySelector('textarea');
  area.value = 'More demos';
  area.dispatchEvent(new phone.win.Event('input'));
  doc.querySelector('form').dispatchEvent(new phone.win.Event('submit', { cancelable: true }));
  eq(JSON.stringify(phone.posted[phone.posted.length - 1].msg.answers), '[4,"More demos"]', 'sent whole');
  relay.close();

  /* Then over the network and out the other end: a room served, a vote
     and a form sent to it as a phone would, and the CLI reading it back. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-results-talk-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(dir)}, { port: 0, log: quiet });
    const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
    const post = (port, p, body) => fetch('http://127.0.0.1:' + port + p,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
    (async () => {
      await up(s); await up(s.room.server);
      const deck = s.address().port, phone = s.room.port;
      const said = [
        await post(deck, '/audience/deck', { type: 'poll-open', id: 'how-you-present', question: 'Q?', options: ['A', 'B'] }),
        await post(phone, '/phone', { type: 'vote', token: 'phone-aaaa', poll: 'how-you-present', option: 1 }),
        await post(deck, '/audience/deck', { type: 'poll-close', id: 'how-you-present' }),
        await post(deck, '/audience/deck', { type: 'feedback-open', questions: [{ kind: 'rate', text: 'Useful?' }] }),
        await post(phone, '/phone', { type: 'feedback', token: 'phone-aaaa', answers: [5] }),
      ];
      s.room.relay.close();                   // what Ctrl-C does
      console.log(JSON.stringify(said));
      process.exit(0);
    })();
  `;
  const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
  eq(run.stdout.trim().split('\n').pop(), '[200,200,200,200,200]', 'every message was taken');
  const cwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-results-cwd-'));
  const cli = require('child_process').spawnSync('node', [path.join(ROOT, 'bin/sipario.js'), 'results', dir],
    { encoding: 'utf8', cwd });
  eq(cli.status, 0, `results ran (${cli.stderr.trim()})`);
  if (!/^\[results\] minimal-\S+\.json, minimal-\S+\.csv: 1 phone, 1 poll, 0 reactions, 1 feedback form$/m.test(cli.stdout)) {
    throw new Error(`it said: ${cli.stdout}`);
  }
  const csv = fs.readFileSync(path.join(cwd, fs.readdirSync(cwd).find((f) => f.endsWith('.csv'))), 'utf8');
  if (!csv.includes('poll,how-you-present,Q?,B,1') || !csv.includes('rating,q1,Useful?,5,1')) {
    throw new Error(`the CSV does not carry the vote and the score:\n${csv}`);
  }
  eq(fs.readdirSync(dir).some((f) => /\.(csv|json)$/.test(f)), false, 'and nothing was written into the talk');
  for (const d of [dir, cwd]) fs.rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------ the script, off the network

/* The presenter window, the print page and the notes inside the deck page
   are served to this machine and nobody else. Whether a request is from
   this machine is read off its socket, so it is checked two ways: the
   rule on its own, and a served talk asked for its pages over this
   machine's own network address, which reaches the server as another
   machine would. */

check('the script is for requests from this machine alone, read off the socket and not a header', () => {
  const { fromThisMachine } = require('./lib/server.js');
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  for (const a of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) eq(fromThisMachine(req(a)), true, a);
  for (const a of ['192.168.1.7', '::ffff:192.168.1.7', '10.0.0.2', 'fe80::1', '::', '', undefined]) {
    eq(fromThisMachine(req(a)), false, String(a));
  }
  for (const h of ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip']) {
    eq(fromThisMachine(req('127.0.0.1', { [h]: '203.0.113.9' })), false, `loopback carrying ${h}, as a tunnel would`);
  }
});

check('a deck opened from another machine carries no notes, and N and D open nothing there', () => {
  const { deckPage } = require('./lib/pages.js');
  const page = deckPage(MOVES_DECK, { notes: false });
  if (!page.includes('data-notes="off"')) throw new Error('the page does not say it has no notes');
  if (/The first movement holds one slide/.test(page)) throw new Error('a script reached the page');
  eq((page.match(/<aside class="notes"><\/aside>/g) || []).length, MOVES_DECK.steps, 'every step, its notes emptied');
  let opened = 0;
  const win = windowFor(bodyOf(page), [js], makeBus(), 'http://192.168.1.7:9999/',
    (w) => { w.open = () => { opened++; return null; }; });
  const key = (k) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: k }));
  key('n');
  eq(win.document.getElementById('dock'), null, 'N frames no notes window');
  eq(win.document.body.classList.contains('docked'), false, 'and nothing docks');
  if (!/machine giving the talk/.test(win.document.getElementById('ask').textContent)) {
    throw new Error('the deck does not say where the notes are');
  }
  key('d');
  eq(opened, 0, 'D opens no window');
  key('ArrowRight');
  eq(win.document.querySelector('.slide.current').id, '2-middle', 'and the deck still moves');
  /* On this machine the deck is as it was: N docks the notes. */
  const here = windowFor(bodyOf(deckPage(MOVES_DECK)), [js], makeBus());
  here.document.dispatchEvent(new here.KeyboardEvent('keydown', { key: 'n' }));
  if (!here.document.getElementById('dock-frame')) throw new Error('on this machine N no longer docks the notes');
});

{
  const lan = (() => {
    for (const list of Object.values(require('os').networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
    }
    return null;
  })();
  const name = 'over the network the script is not there: the notes window, the print page and ' +
    'every version are a 404, and the deck comes without its notes';
  if (!lan) {
    console.log(`  --    ${name}\n        not run: this machine has no network address to ask from`);
  } else {
    check(name, () => {
      /* A talk with no room, so the deck listens on every interface as it
         always has; a room binds it to this machine and the question
         would not arise. */
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-script-'));
      fs.cpSync(TALK.dir, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'deck.md'), MOVES_SRC);
      const probe = `
        const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
        const http = require('http');
        const quiet = { log(){}, warn(){}, error(){} };
        const s = serve(${JSON.stringify(dir)}, { port: 0, log: quiet });
        const get = (host, p, headers = {}) => new Promise((ok) => http.get({ host, port: s.address().port, path: p, headers }, (r) => {
          let body = ''; r.on('data', (c) => { body += c; }); r.on('end', () => ok({ status: r.statusCode, body }));
        }).on('error', (e) => ok({ status: 0, body: e.message })));
        (async () => {
          await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
          const out = {};
          for (const [who, host, headers] of [['here', '127.0.0.1', {}], ['lan', ${JSON.stringify(lan)}, {}],
                                              ['tunnel', '127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }]]) {
            out[who] = {};
            for (const p of ['/', '/presenter', '/presenter?v=1&tab=x', '/print', '/deck.md', '/js/presenter.js', '/events']) {
              if (p === '/events') continue;
              const r = await get(host, p, headers);
              out[who][p] = { status: r.status, notes: /The first movement holds one slide/.test(r.body),
                              off: /data-notes="off"/.test(r.body), body: r.body.slice(0, 20) };
            }
          }
          console.log(JSON.stringify(out));
          s.close(); process.exit(0);
        })();
      `;
      const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
      fs.rmSync(dir, { recursive: true, force: true });
      eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(stdout.trim().split('\n').pop());
      for (const p of ['/', '/presenter', '/presenter?v=1&tab=x', '/print']) {
        eq(out.here[p].status, 200, `from this machine, ${p}`);
        eq(out.here[p].notes, true, `from this machine, ${p} carries the script`);
      }
      for (const who of ['lan', 'tunnel']) {
        for (const p of ['/presenter', '/presenter?v=1&tab=x', '/print']) {
          eq(out[who][p].status, 404, `${who}: ${p}`);
          eq(out[who][p].body, 'not found', `${who}: ${p} says only that`);
        }
        eq(out[who]['/'].status, 200, `${who}: the deck is served`);
        eq(out[who]['/'].notes, false, `${who}: without its notes`);
        eq(out[who]['/'].off, true, `${who}: and says so`);
        eq(out[who]['/js/presenter.js'].status, 200, `${who}: the notes window's code is code, not a script`);
        eq(out[who]['/deck.md'].status, 404, `${who}: the source is never served`);
      }
    });
  }
}

// ------------------------------------------------------ the join QR code

/* A code that looks right and does not scan is the failure that matters
   here, so every code is read back by a decoder this repository did not
   write: jsQR, a devDependency the suite alone reaches for. What it is
   handed is the SVG's own path, drawn into pixels, so the reading covers
   the drawing and not only the matrix behind it. */

const qr = require('./js/qr.js');
const jsQR = require('jsqr');

/** The SVG's dark runs, drawn black on white at `scale` pixels a module. */
function rasterSvg(svg, scale = 6) {
  const w = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)[1]);
  const px = w * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < run * scale; dx++) {
        const i = ((Number(y) * scale + dy) * px + Number(x) * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return jsQR(data, px, px);
}

/* A matrix as an SVG path, the way qr.svg() draws one, for the checks
   that force a mask. */
const svgOf = (m) => {
  let d = '';
  m.dark.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${m.size + 8} ${m.size + 8}"><path d="${d}"/></svg>`;
};

check('the QR encoder agrees with the standard where the standard gives the answer', () => {
  /* ISO/IEC 18004's worked example: "01234567" at 1-M, its data
     codewords and the error correction they must produce. */
  eq(qr.ecc([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17], 10).join(','),
     '165,36,212,193,237,54,199,135,44,85', 'the Reed-Solomon codewords');
  eq([0, 1, 2, 3, 4, 5, 6, 7].map((m) => qr.formatBits(m).toString(2).padStart(15, '0')).join(' '),
     '101010000010010 101000100100101 101111001111100 101101101001011 ' +
     '100010111111001 100000011001110 100111110010111 100101010100000', 'the format information for level M');
  eq([7, 8, 9, 10].map((v) => qr.versionBits(v).toString(16)).join(' '), '7c94 85bc 9a99 a4d3',
     'the version information, 7 to 10');
});

check('a join address of any length it takes reads back as itself, at every version from 1 to 10', () => {
  const base = 'http://192.168.1.7:10000/' + 'abcdefghij'.repeat(30);
  /* Either side of each version's capacity, so every boundary is crossed. */
  const lengths = [1, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213];
  const versions = new Set();
  for (const n of lengths) {
    const text = base.slice(0, n);
    const m = qr.matrix(text);
    versions.add(m.version);
    const got = rasterSvg(qr.svg(text));
    if (!got) throw new Error(`${n} bytes, version ${m.version}: jsQR read nothing`);
    eq(got.data, text, `${n} bytes`);
    eq(got.version, m.version, `${n} bytes: the version it says it is`);
  }
  eq([...versions].sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7,8,9,10', 'every version was drawn');
  eq(rasterSvg(qr.svg('https://room.example/talks/ü–✓')).data, 'https://room.example/talks/ü–✓', 'UTF-8 survives');
  let msg = '';
  try { qr.svg('x'.repeat(214)); } catch (err) { msg = err.message; }
  if (!/holds 213 bytes.*214/.test(msg)) throw new Error(`a text too long is not refused by name: ${msg}`);
});

check('read back without correcting anything, every block of every version is a codeword with no error in it', () => {
  /* A decoder that corrects errors can read a code that is slightly
     wrong, and a fault in where the bits are laid then spends the damage
     a code can survive in a room before anyone has smudged it. So this
     reads the data back the way the standard lays it out, written here
     rather than borrowed from the encoder: the two-column zigzag from
     the bottom right with the timing column skipped, the eight masks, the
     block table for level M, and the Reed-Solomon syndromes, which are
     all zero for a block with no error and not otherwise. From the
     encoder it takes only which modules are fixed patterns, and checks
     how many are left against the standard's capacity. */
  const EXP = [], LOG = [];
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
  const TABLE = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
                  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
                  10: [26, [[4, 43], [1, 44]]] };
  const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
  const MASK = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
                (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
                (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  const base = 'http://192.168.1.7:10000/' + 'abcdefghij'.repeat(30);
  for (const n of [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]) {
    const m = qr.matrix(base.slice(0, n));
    const fixed = qr.reserved(m.version);
    const [ecn, groups] = TABLE[m.version];
    const total = groups.reduce((a, [k, d]) => a + k * (d + ecn), 0);
    const bits = [];
    let upward = true;
    for (let right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                                  // the timing column is never data
      for (let k = 0; k < m.size; k++) {
        const row = upward ? m.size - 1 - k : k;
        for (const c of [right, right - 1]) {
          if (fixed[row][c]) continue;
          bits.push(m.dark[row][c] !== MASK[m.mask](row, c) ? 1 : 0);
        }
      }
      upward = !upward;
    }
    eq(bits.length, total * 8 + REMAINDER[m.version], `version ${m.version}: data modules against the standard's capacity`);
    const words = [];
    for (let i = 0; i < total * 8; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
    const blocks = [];
    for (const [k, d] of groups) for (let i = 0; i < k; i++) blocks.push({ d, cw: [] });
    let at = 0;
    const longest = Math.max(...blocks.map((b) => b.d));
    for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d) b.cw.push(words[at++]);
    for (let i = 0; i < ecn; i++) for (const b of blocks) b.cw.push(words[at++]);
    blocks.forEach((b, bi) => {
      for (let j = 0; j < ecn; j++) {
        let s = 0;
        for (const c of b.cw) s = mul(s, EXP[j]) ^ c;                // the block at a^j
        if (s) throw new Error(`version ${m.version}, block ${bi + 1}: syndrome ${j} is ${s}, not 0`);
      }
    });
  }
});

check('every one of the eight masks reads back, and the one chosen has the lowest penalty', () => {
  for (const text of ['http://192.168.1.7:10000/', 'https://room.example/' + 'q'.repeat(120)]) {
    const chosen = qr.matrix(text);
    for (let mask = 0; mask < 8; mask++) {
      const m = qr.matrix(text, mask);
      eq(m.mask, mask, 'forced');
      const got = rasterSvg(svgOf(m));
      eq(got && got.data, text, `mask ${mask}, version ${m.version}`);
      if (m.score < chosen.score) throw new Error(`mask ${mask} scores ${m.score}, under the chosen ${chosen.mask}'s ${chosen.score}`);
    }
  }
});

check('the code is one path in currentColor, crisp, on a four-module quiet zone, and says what it is', () => {
  const svg = qr.svg('http://10.0.0.2:10000/?a="b"&c');
  const m = qr.matrix('http://10.0.0.2:10000/?a="b"&c');
  if (!svg.includes(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`)) throw new Error('the quiet zone is not four modules a side');
  eq((svg.match(/<path /g) || []).length, 1, 'one path');
  if (!/<path fill="currentColor"/.test(svg) || /fill="#|stroke|<rect/.test(svg)) throw new Error('the talk does not decide the ink');
  if (!svg.includes('shape-rendering="crispEdges"')) throw new Error('the edges are not kept crisp');
  if (!svg.includes('aria-label="QR code for http://10.0.0.2:10000/?a=&quot;b&quot;&amp;c"')) {
    throw new Error('the label is missing or not escaped');
  }
  const xs = [...svg.matchAll(/M(\d+) (\d+)/g)].flatMap((p) => [Number(p[1]), Number(p[2])]);
  eq(Math.min(...xs), 4, 'nothing is drawn in the quiet zone');
});

check('the join address is the room\'s network, not a VPN\'s or a bridge\'s, unless told otherwise', () => {
  const { joinHost } = require('./lib/server.js');
  const v4 = (address) => [{ family: 'IPv4', internal: false, address }];
  /* The machine this was written on: a VPN carrying all traffic owns the
     default route, a mesh VPN sits beside it, and the Wi-Fi is en0. */
  const laptop = { lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], utun33: v4('10.2.0.2'),
                   utun31: v4('100.66.145.39'), en0: v4('192.168.1.7'),
                   awdl0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }] };
  eq(joinHost({ env: {}, nets: laptop, route: '10.2.0.2' }).host, '192.168.1.7', 'a VPN on the default route is passed over');
  eq(joinHost({ env: {}, nets: laptop, route: '10.2.0.2' }).via, 'en0', 'and the interface is named');
  eq(joinHost({ env: {}, nets: { en0: v4('10.0.5.20'), en1: v4('192.168.1.7') }, route: '10.0.5.20' }).host,
     '10.0.5.20', 'the default route wins when it is the room\'s own network');
  eq(joinHost({ env: {}, nets: { docker0: v4('172.17.0.1'), en0: v4('192.168.1.7') }, route: null }).host,
     '192.168.1.7', 'a Docker bridge is passed over');
  eq(joinHost({ env: {}, nets: { en5: v4('169.254.3.3') }, route: null }).host, null, 'link-local is never an answer');
  eq(joinHost({ env: {}, nets: { utun3: v4('10.8.0.2') }, route: '10.8.0.2' }).host, '10.8.0.2',
     'a tunnel only when there is nothing else');
  eq(joinHost({ env: { SIPARIO_JOIN_HOST: 'talk.local' }, nets: laptop, route: '10.2.0.2' }).host, 'talk.local',
     'SIPARIO_JOIN_HOST is taken as it is');
  eq(joinHost({ env: { SIPARIO_JOIN_HOST: 'talk.local' }, nets: laptop, given: '10.9.9.9' }).host, '10.9.9.9',
     'and serve()\'s own joinHost over that');
});

check('a tunnel\'s address is the join address when given, an origin and nothing after it', () => {
  const { joinUrl } = require('./lib/server.js');
  eq(joinUrl({ env: {} }), null, 'nothing given, nothing taken');
  eq(joinUrl({ env: { SIPARIO_JOIN_URL: 'https://room.example.com' } }).url, 'https://room.example.com/',
     'SIPARIO_JOIN_URL is taken, with its slash');
  eq(joinUrl({ env: { SIPARIO_JOIN_URL: 'https://a.example.com/' }, given: 'https://b.example.com/' }).url,
     'https://b.example.com/', 'and serve()\'s own joinUrl over that');
  for (const bad of ['room.example.com', 'ftp://room.example.com/', 'https://room.example.com/talk',
                     'https://room.example.com/?x=1']) {
    eq(typeof joinUrl({ env: { SIPARIO_JOIN_URL: bad } }).error, 'string', `${bad} is refused`);
  }

  /* Served: the phones are told the tunnel's address, the banner says
     where it came from and which port to point the tunnel at, a bad one
     is said and the LAN address used, and the notes' link is untouched. */
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib', 'server.js'))});
    const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
    (async () => {
      const out = {};
      for (const [k, joinUrl] of [['good', 'https://room.example.com'], ['bad', 'https://room.example.com/talk']]) {
        const said = [];
        const log = { log(m) { said.push(m); }, warn(m) { said.push(m); }, error(m) { said.push(m); } };
        const s = serve(${JSON.stringify(path.join(ROOT, 'starters', 'minimal'))}, { port: 0, log, joinUrl });
        await up(s); await up(s.room.server);
        await new Promise((ok) => setTimeout(ok, 300));
        out[k] = { join: s.room.join(), port: s.room.port, said };
        s.room.relay.close(); s.close(); if (s.closeAllConnections) s.closeAllConnections();
      }
      console.log(JSON.stringify(out));
      process.exit(0);
    })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
  `;
  const run = require('child_process').spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 30000 });
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  if (out.error) throw new Error(out.error);
  eq(out.good.join, 'https://room.example.com/', 'phones are told the tunnel\'s address');
  const banner = out.good.said.find((m) => /phones join at/.test(m)) || '';
  eq(banner.includes('https://room.example.com/') && banner.includes(`port ${out.good.port}`), true,
     `the banner names it and the port it reaches (${banner})`);
  eq(/^http:\/\/[^/]+:\d+\/$/.test(out.bad.join), true, 'a bad one falls back to this network\'s address');
  eq(out.bad.said.some((m) => /must be an origin alone/.test(m)), true, 'and says why');
  eq(out.good.said.some((m) => /room\.example\.com/.test(m) && /presenter/.test(m)), false,
     'the notes\' link never carries it');
});

check('the deck draws the join code wherever a template marks one, and nowhere on paper', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, join: () => 'http://192.168.1.7:10000/' });
  const r = render(inRoom(MOVES_SRC), TALK);
  const deckRoom = roomWindow(bodyOf(pagesLib.deckPage(r)),
    [js, fs.readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8'), audienceJs], relay);
  const slot = deckRoom.win.document.querySelector('.template-title [data-join-qr]');
  if (!slot) throw new Error('the example\'s title template marks no data-join-qr');
  eq(slot.innerHTML, '', 'empty until the relay has said where');
  deckRoom.connect(deckRoom.room(), relay.onTally);
  const got = rasterSvg(slot.innerHTML);
  eq(got && got.data, 'http://192.168.1.7:10000/', 'drawn, and it reads back as the join address');
  eq(deckRoom.win.document.querySelector('.template-title [data-join]').textContent, '192.168.1.7:10000', 'with the address under it');
  const { printPage } = require('./lib/pages.js');
  const paper = printPage(render(fs.readFileSync(TALK.deck, 'utf8'), TALK));
  if (/<svg[^>]*QR code/.test(paper) || /qr\.js/.test(paper)) throw new Error('the print page carries a join code');
  relay.close();
});

check('a deck on a relay elsewhere draws that relay\'s address before it has answered', () => {
  const r = render(MOVES_SRC.replace('name: Moves', 'name: Moves\naudience: https://room.example/t/abc'), TALK);
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0 });
  const w = roomWindow(bodyOf(pagesLib.deckPage(r)), [js, fs.readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8'), audienceJs],
    relay, { down: true });
  eq(w.posted[0].url, 'https://room.example/t/abc/deck', 'the deck speaks to that relay');
  const got = rasterSvg(w.win.document.querySelector('.template-title [data-join-qr]').innerHTML);
  eq(got && got.data, 'https://room.example/t/abc', 'and its title slide already carries its code');
});

{
  /* The one reading that uses a real browser's pixels: the example served
     with its room, its title slide drawn by the browser, photographed, and
     the photograph read. A code the browser draws wrongly, too small, or
     under the title's own words fails here. */
  let browser = null;
  try { browser = require('./lib/browser.js').findBrowser(); } catch { /* none here */ }
  const name = 'drawn by a browser on each starter\'s title slide, the code reads back as the address phones join at';
  if (!browser) {
    console.log(`  --    ${name}\n        not run: no browser on this machine to draw it`);
  } else {
    check(name, () => {
      const probe = `
        const fs = require('fs'), zlib = require('zlib');
        const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
        const { launch } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
        const jsQR = require(${JSON.stringify(require.resolve('jsqr'))});
        /* A PNG read back: its IDAT inflated and each row unfiltered. */
        function png(buf) {
          let p = 8, w, h, type; const idat = [];
          while (p < buf.length) {
            const len = buf.readUInt32BE(p), kind = buf.toString('ascii', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
            if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9]; }
            if (kind === 'IDAT') idat.push(body);
            p += 12 + len;
          }
          const ch = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat));
          const out = new Uint8ClampedArray(w * h * 4), stride = w * ch;
          let prev = Buffer.alloc(stride);
          for (let y = 0; y < h; y++) {
            const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
            for (let i = 0; i < stride; i++) {
              const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
              const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
              line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
            }
            for (let x = 0; x < w; x++) {
              for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = line[x * ch + k];
              out[(y * w + x) * 4 + 3] = 255;
            }
            prev = line;
          }
          return { w, h, data: out };
        }
        const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
        (async () => {
          const out = {};
          for (const st of ['minimal', 'stylish']) {
            const s = serve(${JSON.stringify(path.join(ROOT, 'starters'))} + '/' + st, { port: 0, log: { log(){}, warn(){}, error(){} } });
            await up(s); await up(s.room.server);
            const b = await launch();
            try {
              await b.page.open('http://127.0.0.1:' + s.address().port + '/#1-a-slide-of-every-template');
              const box = await b.page.evaluate(\`new Promise((ok) => { const t0 = Date.now(); (function wait() {
                const el = document.querySelector('.slide.current [data-join-qr] svg');
                if (el || Date.now() - t0 > 8000) {
                  const r = el && document.querySelector('.slide.current').getBoundingClientRect();
                  ok(r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null);
                } else setTimeout(wait, 100); })(); })\`);
              if (!box) { out[st] = { drawn: false }; continue; }
              await new Promise((ok) => setTimeout(ok, 200));
              const img = png(await b.page.screenshot(box));
              const got = jsQR(img.data, img.w, img.h);
              out[st] = { drawn: true, read: got && got.data, join: s.room.join() };
            } finally { await b.close(); s.room.relay.close(); s.close(); if (s.closeAllConnections) s.closeAllConnections(); }
          }
          console.log(JSON.stringify(out));
          process.exit(0);
        })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
      `;
      const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 90000 });
      eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(run.stdout.trim().split('\n').pop());
      if (out.error) throw new Error(out.error);
      for (const st of ['minimal', 'stylish']) {
        eq(out[st].drawn, true, `${st}: the browser drew a code`);
        eq(out[st].read, out[st].join, `${st}: and its photograph reads as the join address`);
      }
    });
  }
}

{
  /* A browser opens six connections at once to one origin and no more,
     and an event stream holds one for as long as its page is open. Each
     page used to hold one per thing it listened to, so two deck windows
     and the notes were more than six, and the notes, last to ask, waited
     for ever: the room's figures never arrived, and nothing said so. The
     windows here are frames of one page, which share the one pool as
     windows do, held by the print page because it streams nothing and
     never reloads. Four decks and the notes: the notes must hear the
     room, and one save must reach all five. */
  let browser = null;
  try { browser = require('./lib/browser.js').findBrowser(); } catch { /* none here */ }
  const name = 'in a browser, four deck windows and the notes fit in the six connections one origin is allowed: ' +
    'the notes hear the room, and a save reaches every window';
  if (!browser) {
    console.log(`  --    ${name}\n        not run: no browser on this machine to open them in`);
  } else {
    check(name, () => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-pool-'));
      fs.cpSync(TALK.dir, dir, { recursive: true });
      const probe = `
        const fs = require('fs');
        const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
        const { launch } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
        const s = serve(${JSON.stringify(dir)}, { port: 0, log: { log(){}, warn(){}, error(){} } });
        const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
        (async () => {
          await up(s); await up(s.room.server);
          const b = await launch();
          const out = {};
          try {
            await b.page.open('http://127.0.0.1:' + s.address().port + '/print');
            out.before = await b.page.evaluate(\`new Promise((ok) => {
              const add = (src) => { const f = document.createElement('iframe'); f.src = src; f.width = 480; f.height = 270;
                                     document.body.prepend(f); return f; };
              window.decks = [0, 1, 2, 3].map(() => add('/'));
              window.notes = add('/presenter?tab=suite');
              const t0 = Date.now();
              (function wait() {
                const bar = notes.contentDocument && notes.contentDocument.querySelector('[data-room-phones]');
                const decksUp = decks.filter((f) => f.contentDocument && f.contentDocument.querySelector('.slide.current')).length;
                if ((bar && bar.textContent && decksUp === 4) || Date.now() - t0 > 8000) {
                  decks.forEach((f) => { if (f.contentWindow) f.contentWindow.__before = true; });
                  ok({ phones: bar ? bar.textContent : '', decksUp });
                } else setTimeout(wait, 100);
              })();
            })\`);
            await new Promise((ok) => setTimeout(ok, 300));
            fs.appendFileSync(${JSON.stringify(path.join(dir, 'deck.md'))}, '\\n');
            out.after = await b.page.evaluate(\`new Promise((ok) => {
              const t0 = Date.now();
              const fresh = (f) => !!(f.contentWindow && !f.contentWindow.__before && f.contentDocument.querySelector('.slide.current'));
              /* The notes do not reload: they fetch their page again, by version. */
              const fetched = () => notes.contentWindow.performance.getEntriesByType('resource')
                .some((e) => /\\\\/presenter\\\\?.*[?&]v=/.test(e.name));
              (function wait() {
                if ((decks.every(fresh) && fetched()) || Date.now() - t0 > 8000) {
                  ok({ decks: decks.filter(fresh).length, notes: fetched() });
                } else setTimeout(wait, 100);
              })();
            })\`);
          } finally { await b.close(); s.room.relay.close(); s.close(); if (s.closeAllConnections) s.closeAllConnections(); }
          console.log(JSON.stringify(out));
          process.exit(0);
        })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
      `;
      const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 60000 });
      fs.rmSync(dir, { recursive: true, force: true });
      eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(run.stdout.trim().split('\n').pop());
      if (out.error) throw new Error(out.error);
      eq(out.before.decksUp, 4, 'all four deck windows load');
      if (!/^\d+ phones?$/.test(out.before.phones)) throw new Error(`the notes' header says "${out.before.phones}", not the room's phones`);
      eq(out.after.decks, 4, 'a save reloads every deck window');
      eq(out.after.notes, true, 'and reaches the notes, which fetch the new version');
    });
  }
}

// --------------------------------------------------- the slide on a phone

check('a phone is served what the room has been shown, and nothing ahead of it', () => {
  const relay = createRelay({ throttle: 0, tick: 0, grace: 0 });
  eq(relay.reached('2-middle', 0), false, 'nothing before the deck has said where it is');
  relay.fromDeck({ type: 'slide', id: '1-three-movements', step: 0 });
  relay.fromDeck({ type: 'slide', id: '2-one-line-then-two', step: 0 });
  eq(relay.reached('2-one-line-then-two', 0), true, 'the step on stage');
  eq(relay.reached('2-one-line-then-two', 1), false, 'not the next step of its build');
  eq(relay.reached('2-middle', 0), false, 'nor a slide the speaker jumped past');
  eq(relay.reached('3-end', 0), false, 'nor one further on');
  relay.fromDeck({ type: 'slide', id: '2-one-line-then-two', step: 1 });
  relay.fromDeck({ type: 'slide', id: '1-three-movements', step: 0 });
  eq(relay.reached('2-one-line-then-two', 1), true, 'going back, what was shown stays shown');
  eq(JSON.stringify(relay.stage().slide), '{"id":"1-three-movements","step":0,"v":0}', 'and the phones are told where the talk is');
  for (const bad of [-1, 1.5, '0']) eq(relay.reached('1-three-movements', bad), false, `step ${JSON.stringify(bad)}`);
  relay.close();
});

check('a phone knows whether the deck is there, and a reload on save is not a loss', () => {
  const relay = createRelay({ throttle: 0, tick: 0, grace: 0 });
  eq(relay.stage().live, false, 'no deck yet');
  const offPresenter = relay.onTally(() => {}, { of: 'win-a' });
  eq(relay.stage().live, false, 'a presenter window is not a deck');
  const offDeck = relay.onTally(() => {}, { deck: 'win-a' });
  eq(relay.stage().live, true, 'a deck window is');
  offDeck();
  eq(relay.stage().live, false, 'and when it goes, the phones are told');
  offPresenter();
  relay.close();
  /* With the grace the server gives it, a deck that drops and comes back
     at once, as it does on every save, never reads as gone. */
  const kind = createRelay({ throttle: 0, tick: 0 });
  const staged = [];
  kind.onStage((s) => staged.push(s.live));
  const off = kind.onTally(() => {}, { deck: 'win-a' });
  off();
  kind.onTally(() => {}, { deck: 'win-a' });
  eq(staged.filter((l) => l === false).length, 1, 'the only "gone" is the one from before any deck came');
  kind.close();
});

check('a phone\'s copy of a step has no script and nothing the step has not reached', () => {
  const { slidePage } = require('./lib/pages.js');
  const r = render(fs.readFileSync(TALK.deck, 'utf8'), TALK);
  const first = slidePage(r, '3-an-icon-list-builds-a-row-at-a-time', 0);
  const second = slidePage(r, '3-an-icon-list-builds-a-row-at-a-time', 1);
  if (!first || !second) throw new Error('the example\'s icon-list build is not served');
  if (/Discovered, not listed/.test(first)) throw new Error('step one carries the row step two adds');
  if (!/Discovered, not listed/.test(second)) throw new Error('step two lost its own row');
  for (const page of [first, second]) {
    /* What a step holds for later survives as a box and nothing else: its
       tag and classes, a size, and no content. */
    for (const m of page.matchAll(/<([a-z][\w-]*) class="[^"]*\b(?:hidden-step|ghost)\b[^"]*"([^>]*)>([\s\S]{0,12})/g)) {
      if (m[2].replace(/ style="[^"]*"/, '').trim()) throw new Error(`a held <${m[1]}> kept an attribute: ${m[2]}`);
      if (!m[3].startsWith(`</${m[1]}>`) && m[1] !== 'img') throw new Error(`a held <${m[1]}> kept its content: ${m[3]}`);
    }
    if (/<aside class="notes">\s*[^<\s]/.test(page)) throw new Error('a script survived');
    if (/<script/.test(page)) throw new Error('a runtime came with it');
    /* Served at /slide/<id>/<step>, and a template writes its figures as
       `images/…`: without a root base they resolve under /slide/ and
       404, which is what a real talk showed before this line. */
    if (!page.includes('<base href="/">')) throw new Error('the step does not resolve its images from the root');
    eq((page.match(/<section class="slide /g) || []).length, 1, 'one step, alone');
    if (!/<section class="slide [^"]*\bcurrent\b/.test(page)) throw new Error('the step is not the current one');
  }
  eq(slidePage(r, '3-an-icon-list-builds-a-row-at-a-time', 2), null, 'a step the build does not have');
  /* Given the sizes the deck measured, each held box takes exactly that
     room; given a count that disagrees with this render, none. */
  const heldCount = (first.match(/class="[^"]*\b(?:hidden-step|ghost)\b/g) || []).length;
  const sized = slidePage(r, '3-an-icon-list-builds-a-row-at-a-time', 0,
    Array.from({ length: heldCount }, (_, i) => [1128, 100 + i]));
  eq((sized.match(/style="box-sizing:border-box;flex:none;width:1128px;height:10\dpx;/g) || []).length, heldCount,
     'every held box sized as measured');
  eq(slidePage(r, '3-an-icon-list-builds-a-row-at-a-time', 0, [[1, 1]]).includes('style="box-sizing'), false,
     'and none when the deck counted a different step');
  eq(slidePage(r, 'no-such-slide', 0), null, 'or a slide the talk does not have');
});

check('the phone shows the slide on stage, swaps it without moving, and says when the deck has gone', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, grace: 0 });
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const doc = phone.win.document;
  eq(doc.querySelectorAll('#screen iframe').length, 0, 'nothing on screen before the deck says where it is');
  const off = relay.onTally(() => {}, { deck: 'win-a' });
  relay.fromDeck({ type: 'slide', window: 'win-a', id: '2-one-line-then-two', step: 1 });
  const frames = () => [...doc.querySelectorAll('#screen iframe')].map((f) => f.getAttribute('src'));
  eq(frames().join(' '), '/slide/2-one-line-then-two/1', 'the step on stage, asked for alone');
  relay.fromDeck({ type: 'slide', window: 'win-a', id: '2-rows', step: 0 });
  eq(frames().join(' '), '/slide/2-one-line-then-two/1 /slide/2-rows/0', 'the next waits behind the last until it has loaded');
  const incoming = doc.querySelectorAll('#screen iframe')[1];
  incoming.dispatchEvent(new phone.win.Event('load'));
  eq(frames().join(' '), '/slide/2-rows/0', 'then replaces it');
  eq(doc.querySelector('.slide, #compass, #minimap'), null, 'the deck and its chrome are not on the phone\'s own page');
  off();
  if (!/gone quiet; this is the last slide/.test(doc.getElementById('status').textContent)) {
    throw new Error(`the phone says: ${doc.getElementById('status').textContent}`);
  }
  eq(frames().join(' '), '/slide/2-rows/0', 'and keeps the last slide showing');
  const before = phone.posted.length;
  for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', 'n', 'N']) doc.dispatchEvent(new phone.win.KeyboardEvent('keydown', { key: k }));
  eq(phone.posted.length, before, 'and no key on the phone moves anything');
  eq(relay.state.slide.id, '2-rows', 'the talk is where the deck put it');
  relay.close();
});

check('over the network a phone never receives a script, nor a slide before the room has seen it, in either starter', () => {
  /* Each starter served with its room, driven through every step from the
     deck's side, and at each step every route a phone can reach asked
     for: the phone page, its script and sheet, the talk's look, and every
     step reached so far. Every ```notes block of the deck is looked for in
     all of it, and every step not yet reached is asked for and refused. */
  const { parse: parseDeck } = require('./lib/render.js');
  const noteLines = (src) => parseDeck(src).flatMap((sl) => sl.steps.map((st) => st.note))
    .flatMap((n) => n.split(/\n\s*\n/)).map((p) => p.replace(/\s+/g, ' ').trim())
    .map((p) => (p.match(/[A-Za-z]+(?: [A-Za-z]+){4}/) || [])[0]).filter(Boolean);
  for (const st of ['minimal', 'stylish']) {
    const dir = path.join(ROOT, 'starters', st);
    const t = talk(dir);
    const src = fs.readFileSync(t.deck, 'utf8');
    const steps = [];
    for (const sl of parseDeck(src)) sl.steps.forEach((_, k) => steps.push({ id: sl.meta.id, step: k }));
    const pollAt = steps.findIndex((x) => /poll/.test(x.id));
    if (pollAt < 1) throw new Error(`${st}: no poll slide to look ahead to`);
    const probe = `
      const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
      const quiet = { log(){}, warn(){}, error(){} };
      const s = serve(${JSON.stringify(dir)}, { port: 0, log: quiet });
      const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
      const steps = ${JSON.stringify(steps)};
      const pollAt = ${pollAt};
      const lines = ${JSON.stringify(noteLines(src))};
      (async () => {
        await up(s); await up(s.room.server);
        const deck = s.address().port, phone = s.room.port;
        const get = async (p) => { const r = await fetch('http://127.0.0.1:' + phone + p); return { status: r.status, body: await r.text() }; };
        const move = (id, step) => fetch('http://127.0.0.1:' + deck + '/audience/deck', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'slide', id, step }) });
        const out = { bodies: [], ahead: [], pollSeenEarly: false };
        /* What a phone has been sent, and whether any of it gave away the
           poll's question before the poll's slide was on the stage. */
        const saw = (i, body) => {
          out.bodies.push(body);
          if (i < pollAt && /What do you give a talk from today/.test(body)) out.pollSeenEarly = true;
        };
        const fixed = ['/', '/phone.js', '/phone.css', '/css/theme.css', '/deck.css'];
        for (const p of fixed) saw(-1, (await get(p)).body);
        for (let i = 0; i < steps.length; i++) {
          const next = steps[i];
          const early = await get('/slide/' + encodeURIComponent(next.id) + '/' + next.step);
          if (early.status !== 404) out.ahead.push(next.id + '/' + next.step + ' before: ' + early.status);
          await move(next.id, next.step);
          for (let j = 0; j <= i; j++) {
            const r = await get('/slide/' + encodeURIComponent(steps[j].id) + '/' + steps[j].step);
            if (r.status !== 200) out.ahead.push(steps[j].id + '/' + steps[j].step + ' after: ' + r.status);
            saw(i, r.body);
          }
          saw(i, early.body);
        }
        const all = out.bodies.join(' ');
        const leaked = lines.filter((l) => all.includes(l));
        console.log(JSON.stringify({ ahead: out.ahead, pollSeenEarly: out.pollSeenEarly, lines: lines.length,
                                     sent: out.bodies.length, leaked }));
        s.room.relay.close(); s.close(); process.exit(0);
      })();
    `;
    const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    eq(run.status, 0, `${st}: the probe ran (${run.stderr.trim().split('\n')[0]})`);
    const out = JSON.parse(run.stdout.trim().split('\n').pop());
    eq(out.ahead.join('; '), '', `${st}: every step refused until reached, and served once it was`);
    eq(out.pollSeenEarly, false, `${st}: the poll's question reached no phone before its slide`);
    if (out.lines < 20) throw new Error(`${st}: only ${out.lines} script lines to look for`);
    if (out.leaked.length) throw new Error(`${st}: a phone was sent the script: "${out.leaked[0]}"`);
    if (out.sent < steps.length) throw new Error(`${st}: only ${out.sent} responses were read`);
  }
});

{
  /* The phone's copy of a step against the stage, where it matters: every
     step of every build in both starters, drawn by a browser on the stage
     and in the phone's copy, the box of every visible element compared at
     1280x720. The phone keeps what a step holds for later as empty boxes
     the deck measured, so the two must agree; dropping those boxes moved
     rows by 258px on a spread list, which is what Paul's phone showed. */
  let browser = null;
  try { browser = require('./lib/browser.js').findBrowser(); } catch { /* none here */ }
  const name = "on a phone every step of every build is laid out as it is on the stage, in both starters";
  if (!browser) {
    console.log(`  --    ${name}\n        not run: no browser on this machine to lay them out`);
  } else {
    check(name, () => {
      const probe = `
        const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
        const { launch } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
        const { parse } = require(${JSON.stringify(path.join(ROOT, 'lib/render.js'))});
        const fs = require('fs');
        const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
        const MEASURE = \`(async () => {
          await document.fonts.ready;
          await new Promise((ok) => setTimeout(ok, 300));
          const s = document.querySelector('.slide.current');
          const base = s.getBoundingClientRect(), k = 1280 / base.width;
          return [...s.querySelectorAll('.stage *')]
            .filter((el) => !el.closest('.hidden-step, .ghost') && getComputedStyle(el).visibility !== 'hidden')
            .map((el) => { const r = el.getBoundingClientRect();
              return [el.tagName.toLowerCase(), (r.x - base.x) * k, (r.y - base.y) * k, r.width * k, r.height * k]; })
            .filter((b) => b[3] > 0 || b[4] > 0);
        })()\`;
        (async () => {
          const out = {};
          for (const st of ['minimal', 'stylish']) {
            const dir = ${JSON.stringify(path.join(ROOT, 'starters'))} + '/' + st;
            const s = serve(dir, { port: 0, log: { log(){}, warn(){}, error(){} } });
            await up(s); await up(s.room.server);
            const b = await launch();
            const r = out[st] = { steps: 0, elements: 0, worst: 0, at: '', apart: [] };
            try {
              for (const sl of parse(fs.readFileSync(dir + '/deck.md', 'utf8'))) {
                if (sl.steps.length < 2) continue;
                for (let k = 0; k < sl.steps.length; k++) {
                  const stepId = sl.meta.id + (k ? '-' + (k + 1) : '');
                  await b.page.open('http://127.0.0.1:' + s.address().port + '/#' + encodeURIComponent(stepId));
                  const stage = await b.page.evaluate(MEASURE);
                  await b.page.open('http://127.0.0.1:' + s.room.port + '/slide/' + encodeURIComponent(sl.meta.id) + '/' + k);
                  const phone = await b.page.evaluate(MEASURE);
                  r.steps++;
                  if (stage.length !== phone.length) { r.apart.push(stepId + ': ' + stage.length + ' against ' + phone.length); continue; }
                  stage.forEach((a, i) => {
                    r.elements++;
                    const d = Math.max(...[1, 2, 3, 4].map((j) => Math.abs(a[j] - phone[i][j])));
                    if (a[0] !== phone[i][0]) r.apart.push(stepId + ': ' + a[0] + ' against ' + phone[i][0]);
                    if (d > r.worst) { r.worst = d; r.at = stepId + ' <' + a[0] + '>'; }
                  });
                }
              }
            } finally { await b.close(); s.room.relay.close(); s.close(); if (s.closeAllConnections) s.closeAllConnections(); }
          }
          console.log(JSON.stringify(out));
          process.exit(0);
        })().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
      `;
      const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 180000 });
      eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(run.stdout.trim().split('\n').pop());
      if (out.error) throw new Error(out.error);
      for (const st of ['minimal', 'stylish']) {
        const r = out[st];
        if (r.steps < 5) throw new Error(`${st}: only ${r.steps} build steps compared`);
        eq(r.apart.join('; '), '', `${st}: the same elements show on both`);
        if (r.worst > 2) throw new Error(`${st}: ${r.at} is ${r.worst.toFixed(1)}px out on the phone`);
      }
    });
  }
}

check('what a phone may fetch from images/ is what the room has been shown, and the look of the talk', () => {
  const { references } = require('./lib/pages.js');
  eq(references('<img src="images/a.png"><img srcset="images/b.png 1x, images/c.png 2x">' +
    '<svg><image href="images/d.png"/><image xlink:href="images/e.png"/></svg><video poster="images/f.png"></video>' +
    '<div style="background:url(&quot;images/g.png&quot;)"></div><a href="images/h.png?x=1&amp;y=2">h</a>').join(' '),
     'images/a.png images/d.png images/e.png images/f.png images/h.png?x=1&y=2 images/b.png images/c.png images/g.png',
     'every kind of reference markup can make, entities decoded');

  /* Each starter served with its room and walked through from the deck's
     side, the images asked for as a phone would, before and after the
     step that first shows them. */
  for (const st of ['minimal', 'stylish']) {
    const dir = path.join(ROOT, 'starters', st);
    const probe = `
      const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
      const s = serve(${JSON.stringify(dir)}, { port: 0, log: { log(){}, warn(){}, error(){} } });
      const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
      (async () => {
        await up(s); await up(s.room.server);
        const get = async (p) => (await fetch('http://127.0.0.1:' + s.room.port + p)).status;
        const move = (id, step) => fetch('http://127.0.0.1:' + s.address().port + '/audience/deck', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'slide', id, step }) });
        const ask = async () => { const o = {}; for (const p of [
          '/images/icon-folder.svg', '/images/icon-file-text.svg', '/images/one-piece.svg', '/images/in-layers.svg',
          '/images/bg-blob.svg', '/images/bg-grid.svg', '/images/ICON-FOLDER.SVG', '/images/icon-folder.svg?x=1',
          '/images/./icon-folder.svg', '/images/%69con-folder.svg', '/images/..%2fdeck.md', '/images/%2e%2e/deck.md',
          '/images/icon-folder.svg%00', '/images/../images/icon-folder.svg', '/images/'] ) o[p] = await get(p); return o; };
        const out = {};
        await move('1-a-slide-of-every-template', 0);
        out.start = await ask();
        await move('3-an-icon-list-builds-a-row-at-a-time', 0);
        out.rowOne = await ask();
        await move('3-an-icon-list-builds-a-row-at-a-time', 1);
        out.rowTwo = await ask();
        await move('3-a-figure-that-arrives-whole', 0);
        out.figure = await ask();
        await move('1-a-slide-of-every-template', 0);
        out.back = await ask();
        console.log(JSON.stringify(out));
        s.room.relay.close(); s.close(); process.exit(0);
      })();
    `;
    const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 30000 });
    eq(run.status, 0, `${st}: the probe ran (${run.stderr.trim().split('\n')[0]})`);
    const o = JSON.parse(run.stdout.trim().split('\n').pop());
    const css = st === 'minimal';                        // minimal's sheets name two images; stylish's none
    eq(o.start['/images/bg-blob.svg'], css ? 200 : 404, `${st}: an image deck.css names, from the first slide`);
    eq(o.start['/images/bg-grid.svg'], css ? 200 : 404, `${st}: and one a template's sheet names`);
    for (const p of ['/images/icon-folder.svg', '/images/icon-file-text.svg', '/images/one-piece.svg',
                     '/images/ICON-FOLDER.SVG', '/images/icon-folder.svg?x=1', '/images/./icon-folder.svg',
                     '/images/%69con-folder.svg']) {
      eq(o.start[p], 404, `${st}: ${p} on the first slide`);
    }
    eq(o.rowOne['/images/icon-file-text.svg'], 200, `${st}: the icon of the row on stage`);
    eq(o.rowOne['/images/icon-folder.svg'], 404, `${st}: not the icon of a row this build has still to show`);
    eq(o.rowTwo['/images/icon-folder.svg'], 200, `${st}: which is sent once its step is on the stage`);
    eq(o.rowTwo['/images/icon-folder.svg?x=1'], 200, `${st}: a query changes nothing`);
    eq(o.rowTwo['/images/%69con-folder.svg'], 200, `${st}: nor does an encoded letter`);
    eq(o.rowTwo['/images/one-piece.svg'], 404, `${st}: a later slide's figure is still refused`);
    eq(o.figure['/images/one-piece.svg'], 200, `${st}: until its slide`);
    eq(o.back['/images/one-piece.svg'], 200, `${st}: and going back takes nothing away`);
    for (const stage of ['start', 'figure']) {
      eq(o[stage]['/images/in-layers.svg'], 404, `${st}: a figure drawn into the page is never fetched, so never sent`);
      for (const p of ['/images/..%2fdeck.md', '/images/%2e%2e/deck.md', '/images/icon-folder.svg%00', '/images/']) {
        eq(o[stage][p], 404, `${st}: ${p}`);
      }
    }
  }
});

check('the reactions and the pace stay on the phone while a poll or the form is asked, under it', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, grace: 0 });
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const doc = phone.win.document;
  const order = () => [...doc.querySelectorAll('#phone > * > section, #phone > * > form')].map((e) => e.className).join(' ');
  eq(order(), 'react', 'nothing asked: reactions and pace, as before');
  relay.fromDeck({ type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That'] });
  eq(order(), 'poll react', 'a poll: the question first, the reactions and the pace still there under it');
  eq(doc.querySelectorAll('.reactions button').length, 5, 'every reaction');
  eq(doc.querySelectorAll('.pace button').length, 3, 'and the pace');
  relay.fromDeck({ type: 'poll-close', id: 'which' });
  relay.fromDeck({ type: 'feedback-open', questions: [{ kind: 'rate', text: 'Useful?' }, { kind: 'ask', text: 'Change?' }] });
  eq(order(), 'feedback react', 'the form, and still the reactions and the pace');
  relay.fromDeck({ type: 'poll-open', id: 'late', question: 'One more?', options: ['Yes', 'No'] });
  eq(order(), 'poll feedback react', 'a poll over the form hides neither');
  relay.close();
});

check('what somebody is typing into the form survives the talk moving on under them', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, grace: 0 });
  relay.fromDeck({ type: 'feedback-open', questions: [{ kind: 'rate', text: 'Useful?' }, { kind: 'ask', text: 'Change?' }] });
  const phone = roomPhone(relay);
  phone.connect(phone.room(), relay.onStage);
  const doc = phone.win.document;
  const area = doc.querySelector('textarea');
  area.focus();
  area.value = 'More demos, fewer';
  area.dispatchEvent(new phone.win.Event('input'));
  doc.querySelectorAll('.scale button')[4].click();
  /* The slide changes, a poll opens and closes over the form, the deck
     comes and goes, and the person presses a reaction and the pace. */
  relay.fromDeck({ type: 'slide', id: '2-middle', step: 0 });
  relay.fromDeck({ type: 'poll-open', id: 'late', question: 'One more?', options: ['Yes', 'No'] });
  relay.fromDeck({ type: 'slide', id: '2-rows', step: 1 });
  const off = relay.onTally(() => {}, { deck: 'win-a' });
  off();
  relay.fromDeck({ type: 'poll-close', id: 'late' });
  doc.querySelector('.reactions button').click();
  doc.querySelectorAll('.pace button')[2].click();
  area.focus();                                         // a tap elsewhere moved focus; it is theirs to move back
  relay.fromDeck({ type: 'slide', id: '3-end', step: 0 });
  eq(doc.querySelector('textarea'), area, 'the same box, never rebuilt');
  eq(area.value, 'More demos, fewer', 'with what they had typed');
  eq(doc.activeElement, area, 'and the cursor still in it');
  eq(doc.querySelectorAll('.scale button')[4].getAttribute('aria-pressed'), 'true', 'and the score they had chosen');
  relay.close();
});

check('the pace goes on counting while a poll is open, and the presenter window goes on showing it', () => {
  const relay = createRelay({ deck: 'T', throttle: 0, tick: 0 });
  const pres = roomPresenter(render(pollDeck(GOOD_POLL), TALK), relay);
  pres.connect(pres.room(), relay.onTally);
  relay.fromDeck({ type: 'poll-open', id: 'which', question: 'Which one?', options: ['This', 'That'] });
  for (const [tok, v] of [['phone-aaaa', 1], ['phone-bbbb', 1], ['phone-cccc', 0]]) {
    eq(relay.fromPhone({ type: 'pace', token: tok, value: v }).status, 200, `pace from ${tok} during the poll`);
  }
  relay.fromPhone({ type: 'vote', token: 'phone-aaaa', poll: 'which', option: 1 });
  const doc = pres.win.document;
  if (!/0 slower · 1 fine · 2 faster/.test(doc.querySelector('[data-room-pace]').textContent)) {
    throw new Error(`the panel says: ${doc.querySelector('[data-room-pace]').textContent}`);
  }
  eq(doc.querySelector('.notes-bar [data-room-alert]').textContent, 'poll which: 1 answer', 'beside the poll\'s count');
  relay.close();
});

/* A movement holding two polls, and a movement after it. */
const TWO_POLLS = `name: Polls
audience: local

# One

## 1.1 First
id: 1-first
template: statement

One.

\`\`\`notes
n
\`\`\`

## 1.2 Asked
id: 1-asked
template: poll

\`\`\`poll
id: which
question: Which one?
- This
- That
\`\`\`

\`\`\`notes
n
\`\`\`

## 1.3 After
id: 1-after
template: statement

After.

\`\`\`notes
n
\`\`\`

## 1.4 Again
id: 1-again
template: poll

\`\`\`poll
id: again
question: And now?
- Yes
- No
\`\`\`

\`\`\`notes
n
\`\`\`

## 1.5 Last
id: 1-last
template: statement

Last.

\`\`\`notes
n
\`\`\`

# Two

## 2.1 Next
id: 2-next
template: statement

Next.

\`\`\`notes
n
\`\`\`
`;

check('a poll stays open for the rest of its movement, the relay deciding from where the deck is', () => {
  const relay = createRelay({ deck: 'Polls', throttle: 0, tick: 0 });
  const r = render(TWO_POLLS, TALK);
  const deckRoom = roomDeck(r, relay);
  const hello = deckRoom.posted.find((p) => p.msg.type === 'hello').msg;
  eq(hello.polls.map((p) => `${p.id}@${p.at}/${p.movement}/${p.slide}`).join(' '), 'which@1/0/1-asked again@3/0/1-again',
     'the deck tells the relay where each poll sits');
  const pres = roomPresenter(r, relay);
  pres.connect(pres.room(), relay.onTally);
  deckRoom.connect(deckRoom.room(), relay.onTally);
  const doc = deckRoom.win.document;
  const key = (k) => doc.dispatchEvent(new deckRoom.win.KeyboardEvent('keydown', { key: k }));
  const walk = [];
  const note = () => walk.push(`${doc.querySelector('.slide.current').id}:${relay.tally().poll || '-'}`);
  note();
  for (let i = 0; i < 4; i++) { key('ArrowDown'); note(); }
  key('ArrowRight'); note();
  key('ArrowLeft'); note();
  key('ArrowUp'); key('ArrowUp'); note();
  key('ArrowUp'); key('ArrowUp'); note();
  eq(walk.join(' '), '1-first:- 1-asked:which 1-after:which 1-again:again 1-last:again 2-next:- ' +
     '1-last:again 1-after:which 1-first:-',
     'opened at its step, open through the rest of the movement, replaced by a later one, closed outside it and before it');

  /* Off its slide the poll still takes votes, the presenter is told the
     phones still show it, and the bars on its slide have them all. */
  key('ArrowDown'); key('ArrowDown');                   // 1-after, `which` open off its slide
  eq(relay.fromPhone({ type: 'vote', token: 'phone-aaaa', poll: 'which', option: 1 }).status, 200, 'a vote off its slide counts');
  eq(relay.fromPhone({ type: 'vote', token: 'phone-aaaa', poll: 'again', option: 0 }).status, 409, 'a poll not open is refused');
  eq(pres.win.document.querySelector('.notes-bar [data-room-alert]').textContent, 'poll open: Which one? · 1 answer',
     'the presenter window says the phones still show it');
  key('ArrowUp');                                       // back on 1-asked
  eq(pres.win.document.querySelector('.notes-bar [data-room-alert]').textContent, 'poll which: 1 answer', 'and on its slide says so plainly');
  eq(doc.querySelector('.slide.current [data-option="1"]').getAttribute('data-votes'), '1', 'the bars hold the vote made off the slide');
  eq(doc.querySelector('.slide.current [data-option="1"]').style.getPropertyValue('--share'), '1', 'as its share');

  /* A phone that voted sees its choice again when the poll comes back. */
  const phone = roomPhone(relay);
  phone.win.localStorage.setItem(`sipario-vote:${relay.session}:which`, '1');
  phone.connect(phone.room(), relay.onStage);
  key('ArrowRight');                                    // into movement two: closed
  eq(phone.win.document.querySelector('.poll'), null, 'closed, the phone shows no poll');
  key('ArrowLeft');                                     // back to where movement one was left: 1-asked
  eq(phone.win.document.querySelector('.options button[aria-pressed="true"]').textContent, 'That',
     'back in the movement, the phone shows the answer it gave');
  relay.close();
});

// ------------------------------------------------ one window drives the room

check('the room takes position from one deck window, the first to arrive until another claims it', () => {
  const relay = createRelay({ throttle: 0, tick: 0, grace: 0 });
  const heard = { a: [], b: [], notesOfB: [] };
  const offA = relay.onTally((t) => heard.a.push(t.room), { deck: 'win-a' });
  const offB = relay.onTally((t) => heard.b.push(t.room), { deck: 'win-b' });
  relay.onTally((t) => heard.notesOfB.push(t.room), { of: 'win-b' });
  const last = (k) => heard[k][heard[k].length - 1];
  const move = (w, id, step = 0) => relay.fromDeck({ type: 'slide', window: w, id, step });
  move('win-a', '1-first');
  eq(relay.state.slide.id, '1-first', 'the first window to arrive holds the room');
  eq(move('win-b', '2-later').body.ignored, 'another window holds the room', 'a second window is told it does not');
  eq(relay.state.slide.id, '1-first', 'and does not move the room');
  eq(relay.reached('2-later', 0), false, 'nor mark anything reached');
  relay.fromDeck({ type: 'slide', id: '2-later', step: 0 });
  eq(relay.state.slide.id, '1-first', 'nor does a message that names no window, once a window holds the room');
  eq(`${last('a')} ${last('b')} ${last('notesOfB')}`, 'yours other other', 'each window, and each deck\'s notes, is told which it is');
  eq(relay.fromDeck({ type: 'claim', window: 'win-b', id: '2-later', step: 1 }).status, 200, 'the second window claims the room');
  eq(`${relay.state.slide.id}/${relay.state.slide.step}`, '2-later/1', 'and the room moves to where it is, at once');
  eq(relay.reached('2-later', 1), true, 'from then on, what it shows is reached');
  move('win-a', '1-second');
  eq(relay.state.slide.id, '2-later', 'now the first window is the one ignored');
  eq(`${last('a')} ${last('notesOfB')}`, 'other yours', "and the second window's notes are told their deck holds it");
  eq(relay.fromDeck({ type: 'claim', window: 'notes-window', id: '9-x', step: 0 }).status, 409,
     'a window that is not a connected deck, such as a notes window, cannot claim');
  offB();
  eq(last('a'), 'none', 'the holder gone, the room is held by nobody');
  eq(relay.stage().live, false, 'the phones are told the deck has gone');
  eq(relay.stage().slide.id, '2-later', 'and keep the last slide it showed');
  move('win-a', '1-third');
  eq(relay.stage().slide.id, '2-later', 'no other window takes over by itself');
  relay.fromDeck({ type: 'claim', window: 'win-a', id: '1-third', step: 0 });
  eq(`${relay.stage().slide.id} ${relay.stage().live}`, '1-third true', 'until one claims it');
  offA();
  relay.close();
});

check('the holder reloading on a save keeps the room, and only past the grace does it lose it', () => {
  const relay = createRelay({ throttle: 0, tick: 0, grace: 60000 });
  const offA = relay.onTally(() => {}, { deck: 'win-a' });
  relay.onTally(() => {}, { deck: 'win-b' });
  relay.fromDeck({ type: 'claim', window: 'win-a', id: '1-first', step: 0 });
  offA();                                               // the page unloads...
  relay.onTally(() => {}, { deck: 'win-a' });           // ...and the same tab, the same id, comes back
  relay.fromDeck({ type: 'slide', window: 'win-b', id: '2-later', step: 0 });
  eq(relay.state.slide.id, '1-first', 'the other window still cannot move it');
  relay.fromDeck({ type: 'slide', window: 'win-a', id: '1-second', step: 0 });
  eq(relay.state.slide.id, '1-second', 'the reloaded holder can');
  eq(relay.stage().live, true, 'and the phones never saw it go');
  relay.close();
});

check('in the browser, a second deck window is ignored until it claims, by H or by going full screen', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0, grace: 0 });
  const bus = makeBus();
  const one = roomDeck(ROOM_DECK, relay, { bus });
  one.connect(one.room(), asWindow(relay, one.room()));
  const two = roomDeck(ROOM_DECK, relay, { bus, url: 'http://localhost:9999/#2-middle' });
  two.connect(two.room(), asWindow(relay, two.room()));
  const idOf = (w) => w.win.document.getElementById('deck').getAttribute('data-window');
  if (idOf(one) === idOf(two)) throw new Error('two tabs share an id');
  const pres = roomPresenter(ROOM_DECK, relay, { bus, url: `http://localhost:9999/presenter?tab=${idOf(two)}` });
  pres.connect(pres.room(), asWindow(relay, pres.room()));
  const hold = () => pres.win.document.querySelector('.notes-bar [data-room-alert]').textContent;
  const key = (w, k) => w.win.document.dispatchEvent(new w.win.KeyboardEvent('keydown', { key: k }));
  eq(relay.state.slide.id, '1-three-movements', 'the first window holds the room');
  eq(hold(), 'Another window holds the room. Press H in this deck, or go full screen, to take it.',
     "the second deck's notes say so, and how to take it");
  key(two, 'ArrowDown');
  eq(relay.state.slide.id, '1-three-movements', "the second window's moves are ignored");
  eq(relay.reached('2-one-line-then-two', 0), false, 'and reach nothing');
  key(two, 'h');
  eq(relay.state.slide.id, '2-one-line-then-two', 'H takes the room, where the window is');
  eq(hold(), '', 'and its notes have nothing to warn of');
  key(one, 'ArrowRight');
  eq(relay.state.slide.id, '2-one-line-then-two', "now the first window's moves are ignored");
  Object.defineProperty(one.win.document, 'fullscreenElement', { value: one.win.document.documentElement, configurable: true });
  one.win.document.dispatchEvent(new one.win.Event('fullscreenchange'));
  eq(relay.state.slide.id, '2-middle', 'going full screen takes it back, where that window is');
  Object.defineProperty(one.win.document, 'fullscreenElement', { value: null, configurable: true });
  one.win.document.dispatchEvent(new one.win.Event('fullscreenchange'));
  key(one, 'ArrowDown');
  eq(relay.state.slide.id, '2-one-line-then-two', 'and leaving full screen keeps it');
  eq(pres.posted.length, 0, 'the notes window never says anything that could hold the room');
  relay.close();
});

check('a tab the browser duplicates, sessionStorage and all, is given an id of its own', () => {
  const relay = createRelay({ deck: 'Moves', throttle: 0, tick: 0 });
  const bus = makeBus();
  const one = roomDeck(ROOM_DECK, relay, { bus });
  const original = one.win.document.getElementById('deck').getAttribute('data-window');
  /* The copy arrives later, carrying the original's sessionStorage. */
  const copy = roomDeck(ROOM_DECK, relay, { bus, before: (w) => {
    w.sessionStorage.setItem('notes-tab', original);
    const real = w.Date.now.bind(w.Date);
    w.Date.now = () => real() + 5000;
  } });
  const now = copy.win.document.getElementById('deck').getAttribute('data-window');
  if (!now || now === original) throw new Error(`the copy still answers to ${original}`);
  eq(copy.win.sessionStorage.getItem('notes-tab'), now, 'and keeps its new one for its own reloads');
  eq(one.win.document.getElementById('deck').getAttribute('data-window'), original, 'the original keeps its own');
  eq(copy.room().url.endsWith(`deck=${now}`), true, 'and the copy speaks to the room as the new window');
  relay.close();
});

check('over the network a deck window that does not hold the room cannot make a slide reachable', () => {
  /* The 7.2 spoiler, in the starter: a second window at a later slide,
     never claiming. The phones must not be able to fetch it. Where each
     slide sits is said as the deck says it: its place among every step,
     and its movement. */
  const { parse: parseDeck, grouped: groupedDeck } = require('./lib/render.js');
  const place = {};
  let n = 0;
  groupedDeck(parseDeck(fs.readFileSync(TALK.deck, 'utf8'))).forEach((g, gi) => g.slides.forEach((sl) => {
    place[sl.meta.id] = { at: n, movement: gi };
    n += sl.steps.length;
  }));
  const pollSlide = place['3-a-poll-put-to-the-room'];
  const probe = `
    const place = ${JSON.stringify(place)};
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const s = serve(${JSON.stringify(TALK.dir)}, { port: 0, log: { log(){}, warn(){}, error(){} } });
    const up = (srv) => new Promise((ok) => srv.listening ? ok() : srv.once('listening', ok));
    const http = require('http');
    (async () => {
      await up(s); await up(s.room.server);
      const deck = s.address().port;
      const post = (body) => fetch('http://127.0.0.1:' + deck + '/audience/deck', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      const open = (id) => new Promise((ok) => http.get({ host: '127.0.0.1', port: deck, path: '/events?deck=' + id }, (r) => {
        r.once('data', () => ok(r));
      }));
      const phone = async (p) => (await fetch('http://127.0.0.1:' + s.room.port + p)).status;
      const at = (id) => ({ id, step: 0, at: place[id].at, movement: place[id].movement });
      await post({ type: 'hello', deck: 'sipario:minimal', name: 'Minimal', polls: [{ id: 'how-you-present',
        question: 'What do you give a talk from today?', options: ['A', 'B'], slide: '3-a-poll-put-to-the-room',
        at: ${pollSlide.at}, movement: ${pollSlide.movement} }] });
      const a = await open('win-a');
      await post({ type: 'slide', window: 'win-a', ...at('1-a-slide-of-every-template') });
      const b = await open('win-b');
      const said = await post({ type: 'slide', window: 'win-b', ...at('3-a-poll-put-to-the-room') });
      const out = { said, before: await phone('/slide/3-a-poll-put-to-the-room/0'),
                    held: await phone('/slide/1-a-slide-of-every-template/0'), poll: s.room.relay.tally().poll };
      await post({ type: 'claim', window: 'win-b', ...at('3-a-poll-put-to-the-room') });
      out.after = await phone('/slide/3-a-poll-put-to-the-room/0');
      out.pollAfter = s.room.relay.tally().poll;
      console.log(JSON.stringify(out));
      a.destroy(); b.destroy(); s.room.relay.close(); s.close(); process.exit(0);
    })();
  `;
  const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(run.stdout.trim().split('\n').pop());
  eq(out.said.ignored, 'another window holds the room', 'the second window is told it does not hold the room');
  eq(out.before, 404, 'its slide is not fetchable');
  eq(out.held, 200, "the holder's is");
  eq(out.poll, null, 'nor does it open the poll on that slide');
  eq(out.after, 200, 'once it claims the room, its slide is');
  eq(out.pollAfter, 'how-you-present', 'and its poll');
});

// ------------------------------------------- the notes on another device

/* The notes page on a phone or a tablet, reached by a secret link, and
 * the deck moved from there. The hub is state in this process, so its
 * rules are checked by calling it; the pages are run in jsdom with their
 * requests and streams wired straight to it; and the server is started
 * in a process of its own and asked over this machine's own network
 * address, as another device would ask it. */

const { createRemote } = require('./lib/remote.js');
const remoteJs = fs.readFileSync(path.join(ROOT, 'js/remote.js'), 'utf8');
const qrJs = fs.readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8');

/* A window whose requests reach `hub` as the server would hand them over.
   Its streams connect once its scripts have run, as a stream connects
   after the script that opened it; `connect()` again after a page opens
   another. `before(w, timers)` may keep the page's timers to run by hand. */
function hubWindow(body, scripts, hub, { bus = makeBus(), url = 'http://localhost:9999/', before, fetch } = {}) {
  const streams = [];
  const posted = [];
  const timers = [];
  const win = windowFor(body, scripts, bus, url, (w) => {
    if (before) before(w, timers);
    w.fetch = (u, init) => {
      const msg = init && init.body ? JSON.parse(init.body) : null;
      posted.push({ url: u, msg });
      if (fetch) return fetch(u, init);
      const r = u.startsWith('/remote/window') ? hub.fromWindow(msg)
        : u.startsWith('/remote/command') ? hub.fromDevice(msg) : { status: 404, body: {} };
      return Promise.resolve({ ok: r.status === 200, status: r.status, json: () => Promise.resolve(r.body) });
    };
    w.EventSource = fakeStream(streams);
  });
  /* A page's one stream, wired as the server wires it: a deck window's
     half of the channel by the id it asks with, a device's by its key. */
  const connect = () => streams.forEach((es) => {
    if (es.off || es.readyState === 2) return;
    const deliver = (event) => es.emit('remote', event);
    const q = new URL(es.url, 'http://x').searchParams;
    if (q.get('window')) {
      es.off = hub.onWindow(q.get('window'), deliver);
    } else if (q.has('key')) {
      es.off = hub.onDevice(deliver, () => es.close());
    }
  });
  connect();
  const key = (k) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: k }));
  return { win, streams, posted, timers, connect, key };
}

const REMOTE_DECK = bodyOf(pagesLib.deckPage(MOVES_DECK, { remote: true }));
const DEVICE_PAGE = bodyOf(pagesLib.presenterPage(MOVES_DECK, 9999, '', 'device'));
const NOTES_PAGE = bodyOf(pagesLib.presenterPage(MOVES_DECK, 9999, '', 'notes'));

check('the link is a secret of 192 bits, taken whole or not at all, and a new one cuts off every device at once', () => {
  const hub = createRemote();
  const key = hub.key();
  if (!/^[A-Za-z0-9_-]{32}$/.test(key)) throw new Error(`the key is ${key}`);
  if (createRemote().key() === key) throw new Error('two runs made the same key');
  eq(hub.allows(key), true, 'the key is taken');
  for (const [bad, what] of [[key.slice(0, -1), 'one short'], [key + 'x', 'one long'],
                             [key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'), 'one letter out'],
                             ['', 'empty'], [undefined, 'none'], [null, 'null']]) {
    eq(hub.allows(bad), false, what);
  }
  /* Compared as digests of equal length, in constant time. */
  if (!/timingSafeEqual\(digest\(given\), digest\(key\)\)/.test(fs.readFileSync(path.join(ROOT, 'lib/remote.js'), 'utf8'))) {
    throw new Error('the key is not compared in constant time');
  }
  let cut = 0;
  hub.onDevice(() => {}, () => { cut++; });
  hub.onDevice(() => {}, () => { cut++; });
  const fresh = hub.rotate();
  eq(cut, 2, 'a new link ends every device stream');
  eq(hub.devices(), 0, 'and forgets them');
  eq(hub.allows(key), false, 'the old key is refused');
  eq(hub.allows(fresh), true, 'the new one taken');
});

check('a device drives the deck window that holds the room and no other, and follows where that window is', () => {
  let t = 0;
  const hub = createRemote({ now: () => t });
  const got = { a: [], b: [], dev: [], other: [] };
  const offA = hub.onWindow('win-a', (e) => got.a.push(e));
  const offB = hub.onWindow('win-b', (e) => got.b.push(e));
  hub.onDevice((e) => got.dev.push(e), () => {});
  hub.onDevice((e) => got.other.push(e), () => {});
  const sent = (k) => got[k].filter((e) => e.type === 'message').map((e) => e.msg.type + (e.msg.dir ? ':' + e.msg.dir : ''));
  const last = (k) => got[k].filter((e) => e.type === 'message' && e.msg.type === 'state').pop().msg;
  eq(hub.holder(), 'win-a', 'the first window to connect holds the room');
  hub.fromWindow({ type: 'state', window: 'win-a', channel: 'c', g: 1, s: 0, y: 0 });
  hub.fromWindow({ type: 'state', window: 'win-b', channel: 'c', g: 3, s: 0, y: 0 });
  eq(`${last('dev').tab} ${last('dev').g}`, 'win-a 1', 'a device hears where the holder is, and not the other');
  eq(last('other').g, 1, 'as does every device');
  eq(hub.fromDevice({ type: 'next' }).status, 200, 'a device says next');
  hub.fromDevice({ type: 'go', dir: 'right' });
  eq(sent('a').join(' '), 'next go:right', 'and the holder is told, as its notes would tell it');
  eq(sent('b').length, 0, 'the other window is told nothing');
  for (const type of ['attach', 'close', 'detach', 'jump', 'panel', 'dance']) {
    eq(hub.fromDevice({ type }).status, 400, `a device cannot send ${type}`);
  }
  eq(hub.fromDevice({ type: 'go', dir: 'sideways' }).status, 400, 'nor a direction there is not');
  eq(hub.fromWindow({ type: 'claim', window: 'win-z' }).status, 409, 'a window not connected cannot claim');
  hub.fromWindow({ type: 'claim', window: 'win-b' });
  eq(hub.holder(), 'win-b', 'a claim moves the room');
  eq(last('dev').g, 3, 'and the device is shown where the new holder is at once');
  hub.fromDevice({ type: 'back' });
  eq(sent('b').join(' '), 'back', 'which is the one moved now');
  eq(sent('a').length, 2, 'and the first is not');
  /* The clock: a device's reaches the other devices and the holder's
     notes, through its deck; a window that does not hold the room is
     not heard. */
  hub.fromDevice({ type: 'clock', elapsed: 5000, running: true, paused: false });
  eq(sent('b').pop(), 'clock', "a device's clock reaches the holder");
  eq(sent('other').pop(), 'clock', 'and the other devices');
  t += 2000;
  hub.fromWindow({ type: 'clock', window: 'win-a', elapsed: 0, running: false });
  const clocks = got.other.filter((e) => e.type === 'message' && e.msg.type === 'clock');
  eq(clocks.length, 1, "a window that does not hold the room does not set the clock");
  offB();
  eq(hub.live(), false, 'the holder gone, nothing holds the room');
  eq(got.dev.filter((e) => e.type === 'live').pop().live, false, 'and the devices are told');
  eq(hub.fromDevice({ type: 'next' }).status, 409, 'a command then moves nothing');
  eq(sent('a').length, 2, 'and in particular not the window left behind');
  /* A new device is told the clock as it reads now. */
  const late = [];
  hub.onDevice((e) => late.push(e), () => {});
  eq(late.find((e) => e.msg && e.msg.type === 'clock').msg.elapsed, 7000, 'a device joining late is told the clock as it reads now');
  t += 5000;
  let refused = 0;
  for (let i = 0; i < 25; i++) if (hub.fromDevice({ type: 'hello' }).status === 429) refused++;
  eq(refused, 5, 'twenty requests in two seconds, from all devices together, and then a pause');
  offA();
});

check('with a room open, a device follows the window the room follows, and the room alone decides which', () => {
  let hub = null;
  const relay = createRelay({ throttle: 0, tick: 0, grace: 0, held: () => { if (hub) hub.changed(); } });
  hub = createRemote({ holding: () => relay.holding() });
  const got = { a: [], b: [], dev: [] };
  hub.onWindow('win-a', (e) => got.a.push(e));
  hub.onWindow('win-b', (e) => got.b.push(e));
  hub.onDevice((e) => got.dev.push(e), () => {});
  relay.onTally(() => {}, { deck: 'win-b' });
  relay.onTally(() => {}, { deck: 'win-a' });
  eq(hub.holder(), 'win-b', 'the window the room took first, not the first to reach the notes');
  hub.fromWindow({ type: 'state', window: 'win-a', g: 1, s: 0, y: 0 });
  eq(hub.fromWindow({ type: 'claim', window: 'win-a' }).body.ignored, 'the room decides', 'a claim made to the notes alone is not taken');
  hub.fromDevice({ type: 'next' });
  eq(`${got.a.length} ${got.b.filter((e) => e.msg && e.msg.type === 'next').length}`, '0 1', 'the room\'s holder is moved');
  relay.fromDeck({ type: 'claim', window: 'win-a', id: '1-x', step: 0 });
  eq(hub.holder(), 'win-a', 'a claim to the room moves the device with it');
  eq(got.dev.filter((e) => e.msg && e.msg.type === 'state').pop().msg.tab, 'win-a', 'which is shown where that window is at once');
  hub.fromDevice({ type: 'next' });
  eq(got.a.filter((e) => e.msg && e.msg.type === 'next').length, 1, 'and moves it');
  relay.close();
});

check('in the browser, the device moves the deck that holds the room, by key or by touch, and follows it wherever it is moved from', () => {
  const hub = createRemote();
  const bus = makeBus();
  const one = hubWindow(REMOTE_DECK, [js, remoteJs], hub, { bus });
  const two = hubWindow(REMOTE_DECK, [js, remoteJs], hub, { bus, url: 'http://localhost:9999/#2-labels' });
  const idOf = (w) => w.win.document.getElementById('deck').getAttribute('data-window');
  const at = (w) => w.win.document.querySelector('.slide.current').id;
  const scriptOf = (w) => w.win.document.querySelector('.slide.current .notes').textContent.trim();
  const device = hubWindow(DEVICE_PAGE, [remoteJs, presenterJs], hub, {
    url: 'http://192.168.1.7:5555/presenter?key=k',
    before: (w, timers) => { w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; }; },
  });
  const doc = device.win.document;
  const script = () => doc.getElementById('notes').textContent.trim();
  const press = (command) => doc.querySelector(`#remote-controls [data-command="${command}"]`).click();

  eq(hub.holder(), idOf(one), 'the first deck window holds the room');
  eq(doc.body.classList.contains('live'), true, 'the device says it is following a deck');
  eq(script(), scriptOf(one), 'and shows the script of where that window is');
  device.key('PageDown');
  eq(at(one), '2-middle', 'PageDown on the device moves the deck that holds the room');
  eq(at(two), '2-labels', 'and not the other');
  eq(script(), scriptOf(one), 'and the device follows it there');
  one.key('ArrowDown');
  eq(at(one), '2-one-line-then-two', 'a move made on the laptop');
  eq(script(), scriptOf(one), 'reaches the device too');
  press('next');
  eq(at(one), '2-one-line-then-two-2', 'the Next button steps a build');
  press('back');
  press('left');
  eq(at(one), '1-three-movements', 'and the movement buttons move by movement');
  press('right');
  eq(at(one), '2-one-line-then-two', 'back to where that movement was left');
  eq(script(), scriptOf(one), 'the device following every one of them');
  two.key('ArrowUp');
  eq(script(), scriptOf(one), "the other window's moves do not reach the device");

  /* One clock between the device and the notes on the laptop. */
  const notes = hubWindow(NOTES_PAGE, [presenterJs, qrJs, remoteJs], hub,
    { bus, url: `http://localhost:9999/presenter?tab=${idOf(one)}` });
  const running = (w) => w.win.document.getElementById('clock').classList.contains('running');
  device.key('t');
  eq(running(notes), true, "the device's T starts the clock in the laptop's notes");
  notes.key('t');
  eq(running(device), false, "and the laptop's T pauses the device's");
  device.key('t');
  device.key('t');
  eq(notes.win.document.getElementById('clock').textContent, '00:00', 'a reset on the device resets the laptop');
  eq(at(one), '1-three-movements', 'and takes the deck back to the start, as the notes do');

  /* The keys that move the notes around have nowhere to go. */
  device.key('n');
  device.key('d');
  const asked = device.posted.map((p) => p.msg && p.msg.type);
  for (const t of ['close', 'attach', 'detach']) if (asked.includes(t)) throw new Error(`the device sent ${t}`);
  if (doc.getElementById('attach-btn') || doc.getElementById('close-btn') || doc.getElementById('remote-btn')) {
    throw new Error('the device page carries a control for the notes on the laptop');
  }

  two.key('h');
  eq(hub.holder(), idOf(two), 'H in another deck window takes the device with it');
  eq(script(), scriptOf(two), 'which is shown where that window is at once');
  device.key('PageUp');
  eq(`${at(one)} ${at(two)}`, '1-three-movements 2-rows', 'and it is that window the device moves now');

  /* The deck goes: the device says so, a moment later, and keeps the
     last slide it showed. */
  const kept = script();
  two.streams.filter((es) => /[?&]window=/.test(es.url)).forEach((es) => es.close());
  device.timers.filter((x) => x.ms === 3000).forEach((x) => x.fn());
  const status = doc.getElementById('remote-status').textContent;
  if (!/has gone/.test(status)) throw new Error(`the device says: "${status}"`);
  eq(script(), kept, 'and keeps the last slide');

  /* A new link: the stream is ended, the browser's retry refused. */
  const es = device.streams.find((s) => /[?&]key=/.test(s.url));
  hub.rotate();
  eq(doc.body.classList.contains('cut'), true, 'a device whose link was replaced is told, and says it is cut off');
  eq(es.readyState, 2, 'its stream ended');
  if (!/no longer works/.test(doc.getElementById('remote-status').textContent)) throw new Error('and does not say why');
});

check('the link is shown in the notes on this machine alone, asked for when opened, and on no page anyone else is sent', () => {
  const { deckPage, presenterPage, printPage, phonePage, slidePage } = pagesLib;
  const room = render(fs.readFileSync(TALK.deck, 'utf8'), TALK);
  const here = presenterPage(room, 9999, '1', 'notes');
  if (!here.includes('id="remote-btn"')) throw new Error("the laptop's notes have no control for another device");
  const elsewhere = [['the device', presenterPage(room, 9999, '1', 'device')], ['a notes page with no remote', presenterPage(room, 9999, '1')],
    ['the deck', deckPage(room, { remote: true })], ['a deck sent elsewhere', deckPage(room, { notes: false, remote: true })],
    ['paper', printPage(room)], ['a phone', phonePage('Minimal')], ['a slide on a phone', slidePage(room, '1-a-slide-of-every-template', 0)]];
  for (const [what, page] of elsewhere) if (/remote-btn|remote-panel|\/remote\/link/.test(page)) throw new Error(`${what} carries the link's control`);
  if (/data-remote|remote\.js/.test(deckPage(room, { notes: false, remote: true }))) throw new Error('a deck sent elsewhere can reach for the notes');
  if (!/data-remote="window"[\s\S]*\/js\/remote\.js/.test(deckPage(room, { remote: true }))) throw new Error('the deck on this machine does not speak to the server');

  /* Answered at once, so the page's chain of thens runs inside the check. */
  const sync = (v) => ({ then: (f) => { const out = f ? f(v) : v; return out && typeof out.then === 'function' ? out : sync(out); },
                         catch() { return this; } });
  let link = 'http://192.168.1.7:5555/presenter?key=first-key-0000000000000000000000';
  const asked = [];
  const notes = hubWindow(NOTES_PAGE, [presenterJs, qrJs, remoteJs], createRemote(), {
    fetch: (u, init) => {
      asked.push(`${(init && init.method) || 'GET'} ${u}`);
      if (u === '/remote/rotate') link = link.replace('first', 'fresh');
      return sync({ ok: true, status: 200, json: () => sync({ url: link }) });
    },
  });
  const d = notes.win.document;
  eq(d.getElementById('remote-panel').hidden, true, 'the link is not showing until asked for');
  eq(asked.length, 0, 'nor asked for');
  d.getElementById('remote-btn').click();
  eq(d.getElementById('remote-panel').hidden, false, 'opened, it shows');
  eq(asked.join(' '), 'GET /remote/link', 'and asks the server for the link');
  eq(d.getElementById('remote-url').textContent, link, 'the link, as text');
  const read = rasterSvg(d.getElementById('remote-qr').innerHTML);
  eq(read && read.data, link, 'and as a QR code that reads back as the link');
  const again = d.getElementById('remote-rotate');
  again.click();
  eq(asked.length, 1, 'a new link is asked for twice before it is made');
  again.click();
  eq(asked.pop(), 'POST /remote/rotate', 'and then made');
  eq(d.getElementById('remote-url').textContent, link, 'and shown in place of the old');
  if (!/fresh/.test(link)) throw new Error('the check did not rotate');
  d.getElementById('remote-btn').click();
  eq(d.getElementById('remote-panel').hidden, true, 'closed again, it goes');
});

/* The same over the network, in both arrangements: a talk with no room,
   whose deck listens on every interface, and a talk with one, whose deck
   listens on this machine alone. Asked from this machine's own network
   address, as another device would ask. */
{
  const lan = (() => {
    for (const list of Object.values(require('os').networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
    }
    return null;
  })();

  /* What every probe below shares: a served talk, and a way to ask it for
     a page, a POST, and the events of a stream as they arrive. */
  const helpers = (dir) => `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const http = require('http');
    const LAN = ${JSON.stringify(lan)};
    const s = serve(${JSON.stringify(dir)}, { port: 0, log: { log(){}, warn(){}, error(){} } });
    const up = (srv) => new Promise((ok) => (srv.listening ? ok() : srv.once('listening', ok)));
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const get = (host, port, p, headers = {}) => new Promise((ok) => http.get({ host, port, path: p, headers }, (r) => {
      let body = ''; r.on('data', (c) => { body += c; });
      r.on('end', () => ok({ status: r.statusCode, body, cookie: (r.headers['set-cookie'] || [''])[0] }));
    }).on('error', (e) => ok({ status: 0, body: e.message, cookie: '' })));
    const req = (host, port, p, body, headers = {}) => new Promise((ok) => {
      const q = http.request({ host, port, path: p, method: 'POST',
        headers: { 'content-type': 'application/json', ...headers } }, (r) => {
        let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode, body: b }));
      });
      q.on('error', (e) => ok({ status: 0, body: e.message }));
      q.end(JSON.stringify(body));
    });
    /* A stream's events of one name as they arrive, those with no name
       when none is given, and whether the server ended it. */
    const events = (host, port, p, name = 'message', headers = {}) => {
      const got = []; let ended = false; let status = 0;
      const q = http.get({ host, port, path: p, headers }, (r) => {
        status = r.statusCode; r.setEncoding('utf8'); let buf = '';
        r.on('data', (c) => {
          buf += c;
          for (let i = buf.indexOf('\\n\\n'); i > -1; i = buf.indexOf('\\n\\n')) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const kind = (/^event: (.*)$/m.exec(block) || [])[1] || 'message';
            const m = /^data: (.*)$/m.exec(block);
            if (m && kind === name) got.push(JSON.parse(m[1]));
          }
        });
        r.on('end', () => { ended = true; });
      });
      q.on('error', () => { ended = true; });
      return { got, ended: () => ended, status: () => status, close: () => q.destroy(),
               sent: () => got.filter((e) => e.type === 'message').map((e) => e.msg.type) };
    };
  `;

  const noRoom = 'over the network, with no room, the notes on another device need the link: ' +
    'without it or with one letter wrong nothing answers, with it the script does, and a new link cuts the old one off';
  const inRoomName = 'over the network, with the room open, the link reaches the notes and nothing an attendee ' +
    'can fetch carries it, and the device drives the window the room follows';

  if (!lan) {
    for (const name of [noRoom, inRoomName]) console.log(`  --    ${name}\n        not run: this machine has no network address to ask from`);
  } else {
    check(noRoom, () => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-remote-'));
      fs.cpSync(TALK.dir, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'deck.md'), MOVES_SRC);
      const probe = helpers(dir) + `
        (async () => {
          await up(s); await up(s.remote.server);
          const D = s.address().port, R = s.remote.port, key = s.remote.hub.key();
          const wrong = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
          const script = (b) => /The first movement holds one slide/.test(b);
          const out = { hostD: s.address().address, hostR: s.remote.server.address().address };
          out.none = await get(LAN, R, '/presenter');
          out.wrong = await get(LAN, R, '/presenter?key=' + wrong);
          const page = await get(LAN, R, '/presenter?key=' + key);
          out.page = { status: page.status, script: script(page.body), key: page.body.includes(key), cookie: page.cookie };
          const jar = page.cookie.split(';')[0];
          out.sheet = { none: (await get(LAN, R, '/css/presenter.css')).status,
                        wrongCookie: (await get(LAN, R, '/css/presenter.css', { cookie: jar.replace(key, wrong) })).status,
                        cookie: (await get(LAN, R, '/css/presenter.css', { cookie: jar })).status,
                        image: (await get(LAN, R, '/images/one-piece.svg', { cookie: jar })).status };
          out.noKeyAnywhere = {};
          for (const p of ['/', '/js/presenter.js', '/deck.css', '/events', '/images/one-piece.svg']) {
            out.noKeyAnywhere[p] = (await get(LAN, R, p)).status;
          }
          out.noKeyPost = (await req(LAN, R, '/remote/command', { type: 'next' })).status;
          out.withKeyNotHere = {};
          for (const p of ['/', '/print', '/remote/link', '/remote/window?window=x']) {
            out.withKeyNotHere[p] = (await get(LAN, R, p + (p.includes('?') ? '&' : '?') + 'key=' + key)).status;
          }
          /* The deck's listener, from the network: the deck, without its
             notes, as ever; nothing of the link, and the key opens nothing. */
          out.deck = {};
          for (const p of ['/remote/link', '/presenter?key=' + key, '/remote/window?window=x']) out.deck[p] = (await get(LAN, D, p)).status;
          out.deckRotate = (await req(LAN, D, '/remote/rotate', {})).status;
          out.deckWindowPost = (await req(LAN, D, '/remote/window', { type: 'state', window: 'x', g: 0, s: 0, y: 0 })).status;
          out.rebound = (await get('127.0.0.1', D, '/remote/link', { host: 'rebound.example:' + D })).status;
          const link = await get('127.0.0.1', D, '/remote/link');
          out.link = JSON.parse(link.body).url;
          out.keyIn = [];
          for (const [host, p] of [[LAN, '/'], ['127.0.0.1', '/'], ['127.0.0.1', '/presenter'], ['127.0.0.1', '/presenter?tab=x']]) {
            if ((await get(host, D, p)).body.includes(key)) out.keyIn.push(host + p);
          }

          /* A deck window's half of the channel is this machine's alone,
             asked for by name: from the network, or by a page that reached
             loopback by another name, the stream is answered without it,
             and neither can take the device before a window of this
             machine's has. */
          const lanWin = events(LAN, D, '/events?window=win-lan', 'remote');
          const rebound = events('127.0.0.1', D, '/events?window=win-rebound', 'remote', { host: 'rebound.example:' + D });
          await wait(80);
          out.strangers = { holder: s.remote.hub.holder(), heard: lanWin.got.length + rebound.got.length,
                            open: lanWin.status() + ' ' + rebound.status() };

          /* Two deck windows on this machine, and a device. */
          const a = events('127.0.0.1', D, '/events?window=win-a', 'remote');
          await wait(80);
          const b = events('127.0.0.1', D, '/events?window=win-b', 'remote');
          const dev = events(LAN, R, '/events?key=' + key, 'remote');
          await wait(120);
          await req('127.0.0.1', D, '/remote/window', { type: 'state', window: 'win-a', channel: 'c', g: 1, s: 0, y: 0 });
          await req('127.0.0.1', D, '/remote/window', { type: 'state', window: 'win-b', channel: 'c', g: 2, s: 1, y: 0 });
          await wait(80);
          out.followed = dev.got.filter((e) => e.type === 'message').map((e) => e.msg.tab + ':' + e.msg.g);
          out.next = (await req(LAN, R, '/remote/command?key=' + key, { type: 'next' })).status;
          out.plain = (await req(LAN, R, '/remote/command?key=' + key, { type: 'next' }, { 'content-type': 'text/plain' })).status;
          await wait(80);
          out.first = { a: a.sent(), b: b.sent() };
          out.claim = (await req('127.0.0.1', D, '/remote/window', { type: 'claim', window: 'win-b' })).status;
          await req(LAN, R, '/remote/command?key=' + key, { type: 'go', dir: 'right' });
          await wait(80);
          out.second = { a: a.sent(), b: b.sent() };
          out.followedAfter = dev.got.filter((e) => e.type === 'message').pop().msg.tab;

          /* A new link. */
          out.rotatePlain = (await req('127.0.0.1', D, '/remote/rotate', {}, { 'content-type': 'text/plain' })).status;
          out.stillOpen = !dev.ended();
          const rotated = await req('127.0.0.1', D, '/remote/rotate', {});
          const fresh = JSON.parse(rotated.body).url.split('key=')[1];
          await wait(120);
          out.cut = dev.ended();
          out.fresh = fresh !== key && fresh.length === key.length;
          out.old = { page: (await get(LAN, R, '/presenter?key=' + key)).status,
                      cookie: (await get(LAN, R, '/css/presenter.css', { cookie: jar })).status,
                      stream: (await get(LAN, R, '/events?key=' + key)).status,
                      command: (await req(LAN, R, '/remote/command?key=' + key, { type: 'next' })).status };
          out.fresh = { same: !out.fresh, page: (await get(LAN, R, '/presenter?key=' + fresh)).status };
          out.keyWas = key;
          a.close(); b.close(); lanWin.close(); rebound.close();
          console.log(JSON.stringify(out));
          s.close(); process.exit(0);
        })();
      `;
      const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
      fs.rmSync(dir, { recursive: true, force: true });
      eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(run.stdout.trim().split('\n').pop());
      eq(out.hostR, '0.0.0.0', 'the notes have a listener of their own on the network');
      eq(`${out.none.status} ${out.none.body}`, '404 not found', 'without the link, /presenter does not exist');
      eq(`${out.wrong.status} ${out.wrong.body}`, '404 not found', 'nor with one letter of it wrong');
      eq(out.page.status, 200, 'with the link it does');
      eq(out.page.script, true, 'and carries the script');
      eq(out.page.key, false, 'though not the key, which only the address holds');
      if (!/^sipario-remote-\d+=[A-Za-z0-9_-]{32}; Path=\/; HttpOnly; SameSite=Strict$/.test(out.page.cookie)) {
        throw new Error(`the page's cookie is ${out.page.cookie}`);
      }
      eq(`${out.sheet.none} ${out.sheet.wrongCookie} ${out.sheet.cookie} ${out.sheet.image}`, '404 404 200 200',
         "the page's sheets and images need the key too, which its cookie carries");
      for (const [p, code] of Object.entries(out.noKeyAnywhere)) eq(code, 404, `without the key, ${p}`);
      eq(out.noKeyPost, 404, 'and a command');
      for (const [p, code] of Object.entries(out.withKeyNotHere)) eq(code, 404, `even with the key, ${p} is not on this listener`);
      for (const [p, code] of Object.entries(out.deck)) eq(code, 404, `from the network, the deck's listener answers ${p} with nothing`);
      eq(out.deckRotate, 404, 'and no one on the network can make a new link');
      eq(out.deckWindowPost, 404, 'nor speak for a deck window');
      eq(out.rebound, 404, 'nor a page that reached this machine by another name');
      eq(out.strangers.open, '200 200', "the deck's stream answers them, for its reload");
      eq(`${out.strangers.holder} ${out.strangers.heard}`, 'null 0', "but without a deck window's half of the channel");
      if (!out.link.startsWith(`http://`) || !out.link.endsWith(`/presenter?key=${out.keyWas}`)) throw new Error(`the link is ${out.link}`);
      eq(out.keyIn.join(' '), '', "the key is in no page the server sends, the laptop's included");
      eq(out.followed.join(' '), 'win-a:1', 'the device follows the window that holds the room, and not the other');
      eq(out.next, 200, 'a command with the key is taken');
      eq(out.plain, 415, 'and one that does not say it is JSON is not');
      eq(`${out.first.a.join(',')} | ${out.first.b.join(',')}`, 'next | ', 'next moves the holder and not the other window');
      eq(out.claim, 200, 'a claim moves the room');
      eq(`${out.second.a.join(',')} | ${out.second.b.join(',')}`, 'next | go', 'and the next command moves the new holder');
      eq(out.followedAfter, 'win-b', 'which the device now follows');
      eq(out.rotatePlain, 415, 'a new link is made only by a request that says it is JSON');
      eq(out.stillOpen, true, 'so the device is still connected');
      eq(out.cut, true, 'a new link ends the device\'s stream at once');
      eq(`${out.old.page} ${out.old.cookie} ${out.old.stream} ${out.old.command}`, '404 404 404 404', 'and the old key, and its cookie, open nothing');
      eq(`${out.fresh.same} ${out.fresh.page}`, 'false 200', 'the new one does');
    });

    check(inRoomName, () => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-remote-room-'));
      fs.cpSync(TALK.dir, dir, { recursive: true });
      const probe = helpers(dir) + `
        (async () => {
          await up(s); await up(s.room.server); await up(s.remote.server);
          const D = s.address().port, P = s.room.port, R = s.remote.port, key = s.remote.hub.key();
          const out = { hostD: s.address().address };
          const page = await get(LAN, R, '/presenter?key=' + key);
          out.page = { status: page.status, script: /This deck exists twice over/.test(page.body) };
          out.none = (await get(LAN, R, '/presenter')).status;
          /* The room's counts, asked for through the notes' listener as a
             deck window would ask: it must not take the room. */
          const counts = events(LAN, R, '/events?deck=win-z&key=' + key, 'tally');
          await wait(100);
          out.counts = counts.got.length && counts.got[0].type;
          out.heldAfterCounts = s.room.relay.holding();
          /* Two deck windows, each on its one stream as its page asks:
             the room as a deck window, and its half of the channel. */
          const b = events('127.0.0.1', D, '/events?deck=win-b&window=win-b', 'remote');
          await wait(80);
          const a = events('127.0.0.1', D, '/events?deck=win-a&window=win-a', 'remote');
          const dev = events(LAN, R, '/events?key=' + key, 'remote');
          await wait(120);
          out.holder = s.remote.hub.holder();
          out.claimHere = JSON.parse((await req('127.0.0.1', D, '/remote/window', { type: 'claim', window: 'win-a' })).body).ignored;
          await req(LAN, R, '/remote/command?key=' + key, { type: 'next' });
          await wait(80);
          out.first = { a: a.sent(), b: b.sent() };
          await req('127.0.0.1', D, '/audience/deck', { type: 'claim', window: 'win-a', id: '1-a-slide-of-every-template', step: 0 });
          await req('127.0.0.1', D, '/remote/window', { type: 'state', window: 'win-a', channel: 'c', g: 0, s: 0, y: 0 });
          await req(LAN, R, '/remote/command?key=' + key, { type: 'next' });
          await wait(80);
          out.second = { a: a.sent(), b: b.sent(), holder: s.remote.hub.holder(),
                         followed: dev.got.filter((e) => e.type === 'message').pop().msg.tab };

          /* Nothing an attendee can fetch carries the key: the phones'
             listener, a slide on it, the deck and its streams. */
          const seen = [];
          const look = async (host, port, p) => { const r = await get(host, port, p); if (r.body.includes(key) || r.cookie.includes(key)) seen.push(port + p); return r.status; };
          out.statuses = [await look(LAN, P, '/'), await look(LAN, P, '/phone.js'), await look(LAN, P, '/slide/1-a-slide-of-every-template/0'),
                          await look('127.0.0.1', D, '/'), await look('127.0.0.1', D, '/presenter'), await look(LAN, P, '/presenter')];
          const stage = events(LAN, P, '/stream');
          const tally = events('127.0.0.1', D, '/events?of=', 'tally');
          await wait(120);
          if (JSON.stringify(stage.got).includes(key)) seen.push('phone stream');
          if (JSON.stringify(tally.got).includes(key)) seen.push('tally stream');
          out.seen = seen;
          for (const x of [counts, a, b, dev, stage, tally]) x.close();
          console.log(JSON.stringify(out));
          s.room.relay.close(); s.close(); process.exit(0);
        })();
      `;
      const run = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
      fs.rmSync(dir, { recursive: true, force: true });
      eq(run.status, 0, `the probe ran (${run.stderr.trim().split('\n')[0]})`);
      const out = JSON.parse(run.stdout.trim().split('\n').pop());
      eq(out.hostD, '127.0.0.1', 'with the room open the deck is still this machine\'s alone');
      eq(out.page.status, 200, 'and the link reaches the notes from the network all the same');
      eq(out.page.script, true, 'script and all');
      eq(out.none, 404, 'and nothing without it');
      eq(out.counts, 'tally', "the notes' header hears the room's counts through the link");
      eq(out.heldAfterCounts, null, 'as a listener that can never hold the room, whatever it says it is');
      eq(out.holder, 'win-b', 'the device follows the window the room follows');
      eq(out.claimHere, 'the room decides', 'and a claim made to the notes alone moves nothing');
      eq(`${out.first.a.join(',')} | ${out.first.b.join(',')}`, ' | next', 'a command moves the window the room follows');
      eq(out.second.holder, 'win-a', 'H or full screen in another window takes the room');
      eq(`${out.second.a.join(',')} | ${out.second.b.join(',')}`, 'next | next', 'and the device with it');
      eq(out.second.followed, 'win-a', 'which the device now follows');
      eq(out.statuses.join(' '), '200 200 200 200 200 404', 'the pages asked for answer as they always have');
      eq(out.seen.join(' '), '', 'and not one of them carries the key');
    });
  }
}

check('a server asked for no room opens none, whatever the deck says', () => {
  /* The export serves a talk this way. A photograph of the deck has no
     business listening on the network. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-noroom-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const deckFile = path.join(dir, 'deck.md');
  fs.writeFileSync(deckFile, inRoom(fs.readFileSync(deckFile, 'utf8')));
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(dir)}, { port: 0, log: quiet, audience: false });
    s.once('listening', () => { console.log(JSON.stringify({ room: s.room })); s.close(); process.exit(0); });
  `;
  const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  eq(JSON.parse(stdout.trim().split('\n').pop()).room, null, 'no room');
  if (!/serve\([^)]*audience: false/.test(fs.readFileSync(path.join(ROOT, 'lib/export.js'), 'utf8'))) {
    throw new Error('the export serves the talk without saying `audience: false`');
  }
});

// ------------------------------------------------ the engine and its format

/* The templates live one to a file under a talk's templates/, discovered
 * rather than listed. Discovery is the thing worth testing: one can rot
 * quietly if nothing renders it, and the engine would keep passing.
 *
 * starters/minimal is the guard. It is a worked example a second talk is
 * meant to be copied from, and it is this suite's fixture, so a template
 * that stops working breaks the folder somebody would have started from
 * rather than being found in the room.
 */

const { load } = require('./lib/templates.js');
const { compile } = require('./lib/engine.js');
const { MissingTalkOption } = require('./lib/render.js');

const FILTERS = { inline: String, br: String };
const { templates, names, templateFor } = load(TALK.templateRoot, FILTERS);
const deckSrc = fs.readFileSync(TALK.deck, 'utf8');

check('the same folder is read and compiled once', () => {
  if (load(TALK.templateRoot, FILTERS) !== load(TALK.templateRoot, FILTERS)) {
    throw new Error('asking twice re-read the folder');
  }
});

check('an edited figure reaches the next render', () => {
  /* The figure cache is keyed by path and checked against the file's
     mtime. It used to be keyed by path alone and never emptied, so a
     drawing edited while the server ran never reached the deck: the save
     reloaded the page and the render was handed the old figure. */
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-figure-'));
  fs.cpSync(path.join(ROOT, 'starters/minimal'), dir, { recursive: true });
  const t = talk(dir);
  const svgPath = path.join(dir, 'images/in-layers.svg');
  const src = D + layered('source, output', '\n--\n\n```notes\ntwo\n```\n\n--\n\n```notes\nthree\n```');
  const first = render(src, t).html;
  if (/data-edited/.test(first)) throw new Error('the marker is there before the edit');

  const svg = fs.readFileSync(svgPath, 'utf8').replace('<g class="layer" data-layer="source"', '<g class="layer" data-layer="source" data-edited="yes"');
  if (!/data-edited/.test(svg)) throw new Error('the harness figure has no source layer to mark');
  fs.writeFileSync(svgPath, svg);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(svgPath, later, later);                 // a same-tick save must still count

  const second = render(src, t).html;
  if (!/data-edited="yes"/.test(second)) throw new Error('the render came back with the old figure');
  eq(render(src, t).html, second, 'and the unchanged file is served from the cache again');
});

check('two talks load their templates apart', () => {
  /* Same engine, different folders, and neither can reach the other's. A
     talk that redefined `title` must not restyle every other talk. */
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-talk-'));
  fs.writeFileSync(path.join(dir, 'title.html'), '<h1>{{meta.title}}</h1>\n\n<hr class="rule">\n');
  const other = load(dir, FILTERS);
  if (other.templates === templates) throw new Error('both talks share one registry');
  if (other.templates.title.fill === templates.title.fill) {
    throw new Error('title is the same compiled template in both talks');
  }
});

check('a talk with no templates says so, rather than borrowing', () => {
  let msg = '';
  try { load(path.join(ROOT, 'starters/no-such-talk/templates'), FILTERS); }
  catch (err) { msg = err.message; }
  if (!msg.includes('no templates/')) throw new Error(`expected a named failure, got: ${msg}`);
});

check('a template this talk has no file for is refused, and the message names the set', () => {
  let msg = '';
  try { templateFor('sonnet'); } catch (err) { msg = err.message; }
  if (!msg.includes('sonnet')) throw new Error('the message does not name the template asked for');
  for (const k of names) {
    if (!msg.includes(k)) throw new Error(`the message does not name "${k}"`);
  }
});

check('a placeholder naming no filter stops the render', () => {
  let msg = '';
  try { compile('{{a|shout}}', 'x.html', {})({ a: 1 }); } catch (err) { msg = err.message; }
  if (!msg.includes('shout')) throw new Error(`expected the filter named, got: ${msg}`);
});

check('an unclosed or mismatched section stops the render', () => {
  for (const [src, want] of [['{{#a}}x', 'never closed'],
                             ['{{#a}}x{{/b}}', 'closed by'],
                             ['{{/a}}', 'closes nothing']]) {
    let msg = '';
    try { compile(src, 'x.html', {}); } catch (err) { msg = err.message; }
    if (!msg.includes(want)) throw new Error(`${src}: expected "${want}", got: ${msg || 'no error'}`);
  }
});

check('a template is laid out for whoever reads it, not for the output', () => {
  /* How the file is indented and how the HTML comes out are independent,
     which is what lets a template be made readable without anyone
     checking what it did to the markup. */
  const at = ' '.repeat(4);
  eq(compile('<a>\n<b>', 'x.html', {}, at)({}), `<a>\n${at}<b>`, 'lines land on the indent');
  eq(compile('    <a>\n    <b>', 'x.html', {}, at)({}), `<a>\n${at}<b>`,
     "the author's own base indent is theirs");
  /* Nesting is measured against the template's own base, so it takes two
     lines at different depths to have any: one indented line is just an
     author who indents. */
  eq(compile('<a>\n<b>\n  <c>', 'x.html', {}, at)({}), `<a>\n${at}<b>\n${at}  <c>`,
     'nesting past the base survives');
  eq(compile('    <a>\n    <b>\n      <c>', 'x.html', {}, at)({}), `<a>\n${at}<b>\n${at}  <c>`,
     'and is the same however far in the file sits');
  eq(compile('<a>\n\n\n<b>', 'x.html', {}, at)({}), `<a>\n${at}<b>`, 'blank lines are for reading');
});

check('a space that could matter is left alone', () => {
  /* A newline between block elements never meant anything. A space
     between two inline ones is the gap between two words. */
  eq(compile('<b>a</b> <i>c</i>', 'x.html', {})({}), '<b>a</b> <i>c</i>', 'inline space');
  eq(compile('{{x}} {{y}}', 'x.html', {})({ x: 'a', y: 'b' }), 'a b', 'between values');
});

check("a value's own newlines survive the layout", () => {
  /* A transcript is shown as it printed, blank lines included, and an
     inlined SVG is a document. Neither is the template's formatting. */
  const out = compile('<pre>{{code|raw}}</pre>', 'x.html', {}, '        ')({ code: 'one\n\ntwo\n   three' });
  eq(out, '<pre>one\n\ntwo\n   three</pre>', 'held aside and put back');
});

check('a section that renders nothing leaves no blank line', () => {
  const t = compile('<a>\n{{#gone}}<b>{{/gone}}\n<c>', 'x.html', {}, '  ');
  eq(t({ gone: false }), '<a>\n  <c>', 'empty');
  eq(t({ gone: true }), '<a>\n  <b>\n  <c>', 'present');
});

check('a comment alone on its line takes the line with it', () => {
  eq(compile('{{! note }}\n<p>{{x}}</p>', 'x.html', {})({ x: 'a' }), '<p>a</p>', 'leading comment');
  eq(compile('<p>{{! here }}{{x}}</p>', 'x.html', {})({ x: 'a' }), '<p>a</p>', 'inline comment');
});

// ------------------------------------------------------ a talk names itself

check('a talk names its page, its bookmarks and its channel', () => {
  eq(deck.name, 'Minimal', 'the name it declared');
  eq(deck.title, 'Minimal — white paper, slate ink, one teal rule', 'the title it declared');
  eq(deck.key, 'sipario:minimal', 'and the key everything else hangs off');
});

check('a title left off falls back to the name, and nothing else does', () => {
  const r = R('# One\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\nA line.\n');
  eq(r.deck.name, 'T', 'the name');
  eq(r.deck.title, 'T', 'and the title, which was not declared');
});

check('a deck that does not name itself stops the render', () => {
  /* The name is what keeps two decks on one origin from sharing a set of
     bookmarks and a presenter channel. A default is how both of them come
     to be called the same thing. */
  let msg = '';
  try { render('# One\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\nA line.\n', TALK); }
  catch (err) { msg = err.message; }
  if (!msg.includes('`name:`')) throw new Error(`expected the missing key named, got: ${msg || 'no error'}`);
});

check('a key the opening front matter does not know is refused by name', () => {
  let msg = '';
  try { render('name: T\nauthor: nobody\n\n# One\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\nA.\n', TALK); }
  catch (err) { msg = err.message; }
  if (!msg.includes('author')) throw new Error(`expected the stray key named, got: ${msg || 'no error'}`);
});

check('two decks on one origin share neither bookmarks nor a channel', () => {
  /* One page, one name, and the runtime reads it off the page rather than
     carrying a constant. Two talks served from one origin would otherwise
     drive each other's navigation and overwrite each other's marks. */
  const a = R('# One\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\nA.\n').deck;
  const b = render('name: U\n\n# One\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\nA.\n', TALK).deck;
  if (a.key === b.key) throw new Error(`both decks answer to ${a.key}`);
  for (const src of [js, fs.readFileSync(path.join(ROOT, 'js/presenter.js'), 'utf8')]) {
    if (!/getAttribute\("data-deck"\)/.test(src)) {
      throw new Error('the runtime does not read the name off the page');
    }
    /* TODO: how strict should this be? A deck key is the identity
       primitive, so a baked-in `sipario:<slug>` is the leak that matters
       today. A raw name string would slip past it. */
    if (/["']sipario:/.test(src)) {
      throw new Error('a deck key is baked into the runtime');
    }
  }
});

check('the page the server sends carries the talk it is of', () => {
  const { deckPage, presenterPage } = require('./lib/pages.js');
  const r = render(deckSrc, TALK);
  for (const page of [deckPage(r), presenterPage(r, 9999)]) {
    if (!page.includes(`data-deck="${r.deck.key}"`)) {
      throw new Error('a served page does not name its deck');
    }
  }
  if (!deckPage(r).includes(`<title>${r.deck.title}</title>`)) {
    throw new Error('the deck page does not carry the talk\'s title');
  }
  if (!presenterPage(r, 9999).includes(`Presenter — ${r.deck.name}`)) {
    throw new Error('the presenter page does not name the talk');
  }
});

check('render() with no talk names the option it is missing', () => {
  /* A library has no talk. A default here would render somebody else's
     slides and succeed, which is the worst shape a failure can take. */
  let err = null;
  try { render(deckSrc); } catch (e) { err = e; }
  if (!err) throw new Error('render() with no options rendered something');
  eq(err.name, 'MissingTalkOption', 'the error is named');
  eq(err.key, 'templateRoot', 'and says which option');
  if (!(err instanceof MissingTalkOption)) throw new Error('it is not the exported class');

  let second = null;
  try { render(deckSrc, { templateRoot: TALK.templateRoot }); } catch (e) { second = e; }
  eq(second && second.key, 'imageRoot', 'and the next one it needs');
});

// -------------------------------------------------------------- the format

check('a step states what it adds, and the rest is still shown', () => {
  /* The line written once on step one is on the stage at step two, so a
     build is written the way it is spoken rather than restated. */
  const out = R('# G\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\n' +
                'First line.\n\n```notes\none\n```\n\n--\n\nSecond line.\n\n```notes\ntwo\n```\n').html;
  const steps = out.match(/<section class="slide[\s\S]*?<aside/g);
  eq(steps.length, 2, 'steps');
  eq(/First line\./.test(steps[1]), true, 'step two still shows step one');
  eq(/Second line\./.test(steps[1]), true, 'and what it adds');
  /* And the reverse: step one must not show what has not arrived. */
  eq(/Second line\.<\/p>/.test(steps[0].replace(/hidden-step[\s\S]*?<\/p>/g, '')), false,
     'step one does not show step two');
});

check('a standfirst replaces rather than accumulates', () => {
  /* A slide may reword its standfirst as it builds; two standfirsts at
     once would be two of them on the stage. */
  const out = R('# G\n\n## 1.1 T\nid: 1-a\ntemplate: icon-list\n\n\n' +
                '> First wording.\n\n- (folder) **One**\n  A.\n\n```notes\none\n```\n\n--\n\n' +
                '> Second wording.\n\n- (folder) **Two**\n  B.\n\n```notes\ntwo\n```\n').html;
  const steps = out.match(/<section class="slide[\s\S]*?<aside/g);
  const shown = steps[1].match(/<p class="icon-list-sub[^"]*">([^<]*)</g) || [];
  const over = shown.filter((x) => !/ghost/.test(x));
  if (over.length !== 1) throw new Error(`step two shows ${over.length} standfirsts, not one`);
  if (!/Second wording/.test(over[0])) throw new Error('and it is not the one this step declared');
});

check('restating what a step already shows is refused', () => {
  const src = '# G\n\n## 1.1\nid: 1-a\ntemplate: statement\n\n\n' +
              'A line.\n\n--\n\nA line.\n\nAnother.\n';
  let msg = '';
  try { R(src); } catch (err) { msg = err.message; }
  if (!msg.includes('restates') || !msg.includes('A line.')) {
    throw new Error(`expected the repeated line named, got: ${msg || 'no error'}`);
  }
});

check('the old `Note:` script is refused by name', () => {
  /* Notes used to be a `Note:` prefix running to the end of the step. A
     deck written that way would otherwise render every slide with an
     empty presenter view and nothing would say why. */
  const src = '# G\n\n## 1.1\nid: 1-x\ntemplate: statement\n\n\n' +
              'A line.\n\nNote: the script, as it used to be written.\n';
  let msg = '';
  try { R(src); } catch (err) { msg = err.message; }
  if (!msg.includes('`Note:`') || !msg.includes('notes block')) {
    throw new Error(`expected the old syntax named, got: ${msg || 'no error'}`);
  }
});

check('an unclosed script is refused rather than swallowing the step', () => {
  const src = '# G\n\n## 1.1\nid: 1-x\ntemplate: statement\n\nA line.\n\n' +
              '```notes\nnever closed\n';
  let msg = '';
  try { R(src); } catch (err) { msg = err.message; }
  if (!msg.includes('never closed')) {
    throw new Error(`expected the unclosed block named, got: ${msg || 'no error'}`);
  }
});

check('a step may carry more than one script block', () => {
  const src = '# G\n\n## 1.1\nid: 1-x\ntemplate: statement\n\n\n' +
              'A line.\n\n```notes\nfirst\n```\n\n```notes\nsecond\n```\n';
  const { html: out } = R(src);
  for (const word of ['first', 'second']) {
    if (!out.includes(word)) throw new Error(`the ${word} block did not reach the notes`);
  }
});

check('a fenced transcript in the body is not a script', () => {
  /* The one thing a fence-delimited script could plausibly break. */
  const { parse: parseDeck } = require('./lib/render.js');
  const term = parseDeck(deckSrc).find((sl) => sl.meta.template === 'term');
  if (!term) throw new Error('the example has no terminal slide to check');
  if (!term.steps[0].body.trim().startsWith('```')) {
    throw new Error('the terminal slide lost its transcript to the script');
  }
  if (!term.steps[0].note.trim()) throw new Error('and it has no script either');
});

check('a key this format has renamed is refused by name', () => {
  /* A deck written before a rename would otherwise fail as though the
     slide had declared nothing, or render a slide with a silently empty
     line on it. `meta:` was the second kind of failure: nothing threw and
     the title slide simply lost its byline. */
  for (const [was, now] of [['template', 'kind'], ['author', 'meta']]) {
    const src = deckSrc.replace(new RegExp(`^${was}: `, 'm'), `${now}: `);
    let msg = '';
    try { render(src, TALK); } catch (err) { msg = err.message; }
    if (!msg.includes(`${now}:`) || !msg.includes(`${was}:`)) {
      throw new Error(`${now}: -> ${was}: was not named. Got: ${msg || 'no error'}`);
    }
  }
});

check('a deck in the old `---` shape is refused by name', () => {
  /* `---` once opened a slide. Such a deck now parses to no
     slides at all and would otherwise fail as though the file were empty. */
  const src = '---\nslide: 1.1\nid: 1-a\ngroup: G\ntemplate: statement\n---\n\nA line.\n';
  let msg = '';
  try { render(src, TALK); } catch (err) { msg = err.message; }
  if (!msg.includes('`## <number> <title>`')) {
    throw new Error(`expected the new shape named, got: ${msg || 'no error'}`);
  }
});

check('a key the headers took over is refused by name', () => {
  /* Read as ordinary front matter these are silently ignored, and a
     `group:` line ignored leaves the slide in whatever movement came
     before it — which renders, in the wrong place. */
  for (const [key, line] of [['slide', 'slide: 9.9'], ['group', 'group: Elsewhere'],
                             ['title', 'title: A title'], ['word', 'word: Gates']]) {
    const src = `# G\n\n## 1.1\nid: 1-a\ntemplate: statement\n${line}\n\nA line.\n`;
    let msg = '';
    try { R(src); } catch (err) { msg = err.message; }
    if (!msg.includes(`\`${key}:\``)) {
      throw new Error(`${key}: was not named. Got: ${msg || 'no error'}`);
    }
  }
});

check('front matter that runs into the body is refused by name', () => {
  /* Without the blank line the first line of the body joins the run of
     keys, is not one, and would be dropped from the slide in silence. */
  const src = '# G\n\n## 1.1\nid: 1-a\ntemplate: statement\nA line.\n';
  let msg = '';
  try { R(src); } catch (err) { msg = err.message; }
  if (!msg.includes('A line.') || !msg.includes('blank line')) {
    throw new Error(`expected the stray line named, got: ${msg || 'no error'}`);
  }
});

check('a title with a colon in it needs no quoting', () => {
  /* The header takes the whole rest of the line, so the quotes front
     matter made a title with a colon wear are gone. */
  const { html: out } = R('# G\n\n## 1.1 Step one: the folders\nid: 1-a\n' +
    'template: icon-list\n\n- (folder) **A**\n');
  if (!out.includes('<h2>Step one: the folders</h2>')) {
    throw new Error('the colon did not survive the header');
  }
});

check('a section slide takes its word from the movement it opens', () => {
  /* One string, one place — and the template says so, not the engine. A
     talk that wanted its section slides named some other way would say
     that in its own templates/section.js. */
  const { html: out } = R('# Gates\n\n## 1.1\nid: 1-a\ntemplate: section\nletter: G\n\nA line.\n');
  if (!out.includes('Gates')) throw new Error('the section slide lost its word');
  const engine = fs.readFileSync(path.join(ROOT, 'lib/render.js'), 'utf8');
  if (/'section'/.test(engine)) throw new Error('lib/render.js names a template again');
});

check('a heading inside a fence is transcript, not structure', () => {
  /* A deck can print a shell session whose comments open with `#`, and a
     blocked artefact carrying a `## Verification:` heading. Read as
     structure, either splits the fence and loses the rest of the deck. */
  const src = '# G\n\n## 1.1 T\nid: 1-a\ntemplate: term\n\n```\n# a shell comment\n' +
    '## Verification: BLOCKED\n```\n\n## 1.2 U\nid: 1-b\ntemplate: statement\n\nB.\n';
  eq(R(src).slides, 2, 'slides either side of the fence');
});

check('a standfirst no template would print stops the render', () => {
  /* A `>` line on a slide whose template ignores it would vanish without
     a word. The engine asks the compiled template what it reaches for, so
     this holds for a talk's own tenth template too. */
  const src = deckSrc.replace(/^```notes$/m, '> A standfirst the title template will not print\n\n```notes');
  let msg = '';
  try { render(src, TALK); } catch (err) { msg = err.message; }
  if (!msg.includes('title template never prints a standfirst')) {
    throw new Error(`expected the slide and template named, got: ${msg || 'no error'}`);
  }
});

check('a template that does print one is left alone', () => {
  /* The guard must not fire on the templates that do print it. */
  const printers = names.filter((k) => templates[k].uses.has('sub'));
  if (!printers.length) throw new Error('no template in the example prints a standfirst');
  if (printers.includes('title')) throw new Error('title reaches for sub');
});

// --------------------------------------------- what is on disk, not a drawing

/* These three set real artefacts. What makes them worth a template is
 * that none of the marking-up happens in deck.md: the diff is pasted out
 * of `git diff`, the listing out of the folder, the excerpt out of the
 * file, and each is unedited. So the checks are about what the template
 * does to text it was handed, never about what an author remembered. */

check('a diff colours by the first column, and only that', () => {
  const { html: out } = R('# G\n\n## 1.1 T\nid: 1-a\ntemplate: diff\nfile: a.js\n\n' +
    '```\n function f() {\n-  return 1;\n+  return 2;\n }\n```\n');
  const kinds = [...out.matchAll(/class="diff-(add|del|same)"/g)].map((m) => m[1]);
  eq(kinds.join(','), 'same,del,add,same', 'the four lines, in order');
  if (!out.includes('<p class="diff-path">a.js</p>')) {
    throw new Error('the diff lost the path it is a diff of');
  }
});

check('a blank line in a diff is context, not a removal', () => {
  /* `KIND[text[0]]` on an empty line looks up `undefined`, which is a
     miss and so reads as context — but only by luck of the lookup. A
     blank line rendered as a removal would be a red line in the middle
     of a hunk that nothing took away. */
  const { html: out } = R('# G\n\n## 1.1 T\nid: 1-a\ntemplate: diff\nfile: a.js\n\n' +
    '```\n-gone\n\n+added\n```\n');
  const kinds = [...out.matchAll(/class="diff-(add|del|same)"/g)].map((m) => m[1]);
  eq(kinds.join(','), 'del,same,add', 'the blank line is context');
});

check('a listing splits its notes off and keeps its indentation', () => {
  /* Two or more spaces separate a path from its note. A nested row has
     leading spaces of its own, and taking the split before the indent is
     removed reads those as the gap and loses the path entirely. */
  const { html: out } = R('# G\n\n## 1.1 T\nid: 1-a\ntemplate: tree\n\n' +
    '```\nsrc/\n  one.js  the only one\nREADME.md\n```\n');
  const paths = [...out.matchAll(/class="tree-path">([^<]*)</g)].map((m) => m[1]);
  eq(paths.join('|'), 'src/|  one.js|README.md', 'paths, indentation intact');
  const notes = [...out.matchAll(/class="tree-note">([^<]*)</g)].map((m) => m[1]);
  eq(notes.join('|'), 'the only one', 'only the row with a note gets one');
});

check('a file is shown under the path it was read from', () => {
  /* The path is the whole credibility of the slide. A file slide without
     one is a quotation, which is the thing it exists not to be. */
  const { html: out } = R('# G\n\n## 1.1 T\nid: 1-a\ntemplate: file\nfile: NOTES.md\n\n' +
    '```\n## A heading\n```\n');
  if (!/<p class="file-path">NOTES\.md<\/p>\s*<pre class="file-block">/.test(out)) {
    throw new Error('the path is not attached to the block it labels');
  }
  if (!out.includes('## A heading')) throw new Error('the excerpt was read as a heading');
});

// ------------------------------- the deck on paper, and in PowerPoint

/* Both exports photograph the /print page through a browser already on
   the machine. What can be checked without one: the page itself, the
   order the export reads the deck in, the script as text, the .pptx a
   set of pictures becomes, and how the browser is found. The one check
   that needs a browser runs when there is one and says so when not. */

const { printPage } = require('./lib/pages.js');
const { outline, pdfPages } = require('./lib/export.js');
const { pptx } = require('./lib/pptx.js');
const { findBrowser } = require('./lib/browser.js');
const { notesText, parse } = require('./lib/render.js');

/* A zip read back the way it was written: local headers in sequence,
   which is all a reader of one archive it wrote itself needs. */
function unzip(buf) {
  const out = new Map();
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen);
    const start = p + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + size);
    out.set(name, method === 8 ? require('zlib').inflateRawSync(body) : Buffer.from(body));
    p = start + size;
  }
  return out;
}

/* The smallest PNG there is: one white pixel. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64');

check('the print page carries every step once, in order, and no runtime', () => {
  const r = render(deckSrc, TALK);
  const page = printPage(r);
  const ids = [...page.matchAll(/<section class="slide[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
  eq(ids.length, r.steps, 'one section per step');
  eq(ids.join(' '), outline(deckSrc, TALK).map((s) => s.id).join(' '), 'in the order the export reads');
  if (/<script/.test(page)) throw new Error('the print page loads a script; there is nothing for one to do');
  const links = [...page.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
  eq(links[0], '/css/theme.css', 'the frame first');
  eq(links[links.length - 1], '/css/print.css', 'the print sheet last, so it has the final word');
  eq(links.slice(1, -1).join(' '), ['/deck.css'].concat(r.sheets).join(' '), "the talk's sheets between");
  if (!/<body class="print">/.test(page)) throw new Error('the body is not marked as the print page');
});

check('the server serves the print page', () => {
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(TALK.dir)}, { port: 0, log: quiet });
    (async () => {
      await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
      const port = s.address().port;
      const r = await fetch('http://localhost:' + port + '/print');
      const body = await r.text();
      const sheet = await fetch('http://localhost:' + port + '/css/print.css');
      console.log(JSON.stringify({ status: r.status, sections: (body.match(/<section class="slide/g) || []).length,
                                   linked: /href="\\/css\\/print.css"/.test(body), sheet: sheet.status }));
      process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8' });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim());
  eq(out.status, 200, '/print answers');
  eq(out.sections, steps, 'with every step');
  eq(out.linked, true, 'and links the print sheet');
  eq(out.sheet, 200, 'which is served');
});

check('the export reads every step with its number, its place in the build and its script', () => {
  const list = outline(deckSrc, TALK);
  eq(list.length, steps, 'as many as the deck has');
  eq(list[0].n, '1.1', 'the first is 1.1');
  eq(list[0].step, 1, 'and the first step');
  const build = list.find((s) => s.of > 1);
  if (!build) throw new Error('the example has no build to check against');
  const run = list.filter((s) => s.n === build.n);
  eq(run.map((s) => s.step).join(','), run.map((_, i) => i + 1).join(','), 'a build counts its steps');
  eq(run.every((s) => s.of === run.length), true, 'and knows how many there are');
  eq(run[1].id, `${run[0].id}-2`, "a later step is the first's id with a suffix");
  if (!list.every((s) => s.notes)) throw new Error('a step of the example has no script');
  if (!list.every((s) => s.group)) throw new Error('a step of the example is in no movement');
});

check('a script becomes notes text: an item per line, paragraphs apart, emphasis dropped, a cue kept', () => {
  const text = notesText('Say **this** and *that*.\nOn one line.\n\n- one\n- two\n\n1. first\n2. second\n\n[pause]');
  eq(text, 'Say this and that. On one line.\n\n• one\n• two\n\n1. first\n2. second\n\n[pause]', 'the text');
  eq(notesText(''), '', 'no script is no text');
});

check('the notes as text and the notes as markup read one script the same way', () => {
  for (const sl of parse(deckSrc)) {
    sl.steps.forEach((st, k) => {
      const id = sl.meta.id + (k ? `-${k + 1}` : '');
      const m = html.match(new RegExp(`id="${id}"[\\s\\S]*?<aside class="notes">([\\s\\S]*?)</aside>`));
      if (!m) throw new Error(`no notes markup for ${id}`);
      const markup = (m[1].match(/<(p|ul|ol)[ >]/g) || []).length;
      const text = notesText(st.note);
      eq(text ? text.split('\n\n').length : 0, markup, `${id}: paragraphs in the text against blocks in the markup`);
    });
  }
});

check('a PowerPoint deck is the zip PowerPoint expects: every part in the manifest, every relationship resolving, a picture and a script per step', () => {
  const buf = pptx({ title: 'T & co', width: 1280, height: 720, slides: [
    { png: PIXEL, notes: 'First.\n\nSecond <line> & more.', name: '1.1 One' },
    { png: PIXEL, notes: '', name: '1.2' },
    { png: PIXEL, notes: 'Third.', name: '2.1 Three' },
  ] });
  const parts = unzip(buf);
  const names = [...parts.keys()];
  eq(names[0], '[Content_Types].xml', 'the manifest comes first');
  const text = (n) => {
    if (!parts.has(n)) throw new Error(`no part ${n}`);
    return parts.get(n).toString('utf8');
  };

  /* The manifest and the zip name the same parts. */
  const overrides = [...text('[Content_Types].xml').matchAll(/PartName="\/([^"]+)"/g)].map((m) => m[1]);
  for (const o of overrides) if (!parts.has(o)) throw new Error(`the manifest names ${o}, which is not in the zip`);
  for (const n of names) {
    if (n === '[Content_Types].xml' || n.endsWith('.rels') || n.endsWith('.png')) continue;
    if (!overrides.includes(n)) throw new Error(`${n} is in the zip and not in the manifest`);
  }

  /* Every relationship reaches a part, and every id a part uses is one
     its own .rels declares. */
  for (const n of names) {
    if (!n.endsWith('.rels')) continue;
    const dir = path.posix.dirname(path.posix.dirname(n));
    const owner = path.posix.join(dir, path.posix.basename(n, '.rels'));
    const rels = text(n);
    const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, target] of rels.matchAll(/Target="([^"]+)"/g)) {
      const resolved = n === '_rels/.rels' ? target : path.posix.normalize(path.posix.join(dir, target));
      if (!parts.has(resolved)) throw new Error(`${n} points at ${target}, which is not in the zip`);
    }
    if (parts.has(owner)) {
      for (const [, id] of text(owner).matchAll(/r:(?:id|embed)="([^"]+)"/g)) {
        if (!ids.has(id)) throw new Error(`${owner} uses ${id}, which ${n} does not declare`);
      }
    }
  }

  eq(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 3, 'a slide per picture');
  eq(names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length, 3, 'and notes for each');
  eq(names.filter((n) => n.startsWith('ppt/media/')).length, 3, 'and the pictures');
  eq(parts.get('ppt/media/image2.png').equals(PIXEL), true, 'stored as given');
  const notes1 = text('ppt/notesSlides/notesSlide1.xml');
  if (!notes1.includes('<a:t>First.</a:t>')) throw new Error('the first script is not in the first notes');
  if (!notes1.includes('<a:t>Second &lt;line&gt; &amp; more.</a:t>')) throw new Error('the script is not escaped');
  eq((notes1.match(/<a:p>/g) || []).length, 3, 'a paragraph per line, the blank one included');
  const pres = text('ppt/presentation.xml');
  if (!/<p:sldSz cx="12192000" cy="6858000"\/>/.test(pres)) throw new Error('the slide is not 1280x720 in EMUs');
  eq((pres.match(/<p:sldId /g) || []).length, 3, 'three slides listed');
  if (!text('docProps/core.xml').includes('<dc:title>T &amp; co</dc:title>')) throw new Error('the title is not carried, escaped');
  if (!text('ppt/slides/slide1.xml').includes('name="1.1 One"')) throw new Error('a slide is not named for its number and title');
  if (!text('ppt/slides/slide1.xml').includes('cx="12192000" cy="6858000"')) throw new Error('the picture does not fill the slide');
});

check('a browser that goes away tells everything waiting on it, commands and events alike', () => {
  /* A command was told and an event waiter was not, so a browser that
     answered the navigation and then died left `open()` waiting on a
     load event that could no longer come: no error, no timeout, an
     export that never returned and never said why. The probe drives a
     session over a socket of its own and closes it. */
  const probe = `
    const { Session } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
    const ws = { send() {}, close() {} };
    const s = new Session(ws);
    const said = [];
    const note = (what) => (p) => p.then(() => said.push(what + ': resolved'),
                                         (e) => said.push(what + ': ' + e.message));
    const settled = Promise.all([
      note('command')(s.send('Page.navigate', { url: 'about:blank' })),
      note('event')(s.once('Page.loadEventFired')),
    ]);
    ws.onclose();
    settled.then(() => console.log(JSON.stringify(said)));
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  if (!stdout.trim()) {
    throw new Error('nothing settled: something is still waiting on a browser that has gone');
  }
  const said = JSON.parse(stdout.trim().split('\n').pop());
  eq(said.length, 2, 'both were told');
  for (const line of said) {
    if (!/closed the connection/.test(line)) throw new Error(`still waiting, or told wrongly: ${line}`);
  }
});

check('the browser is the one named, else one of the usual ones, else an error that says what to set', () => {
  eq(findBrowser({ SIPARIO_BROWSER: process.execPath }), process.execPath, 'a named binary is taken as it is');
  let err = null;
  try { findBrowser({ SIPARIO_BROWSER: '/nowhere/browser' }); } catch (e) { err = e; }
  if (!err || !/SIPARIO_BROWSER/.test(err.message) || !/\/nowhere\/browser/.test(err.message)) {
    throw new Error(`a wrong name is not named back: ${err && err.message}`);
  }
  err = null;
  try { findBrowser({ PATH: '' }, 'plan9'); } catch (e) { err = e; }
  if (!err || !/SIPARIO_BROWSER/.test(err.message)) {
    throw new Error(`no browser does not say how to name one: ${err && err.message}`);
  }
});

check('the page count is read off the PDF, not assumed', () => {
  const doc = '%PDF-1.4\n1 0 obj <</Type /Pages /Kids [2 0 R] /Count 3>> endobj\n' +
    '4 0 obj <</Type /Pages /Count 1 /Parent 1 0 R>> endobj\n';
  eq(pdfPages(Buffer.from(doc)), 3, "the root's count");
  eq(pdfPages(Buffer.from('%PDF-1.4\n')), 0, 'none is none');
});

check('export with no format, or one it does not know, says what it takes', () => {
  for (const args of [[], ['docx']]) {
    const { status, stderr } = require('child_process')
      .spawnSync('node', [path.join(ROOT, 'bin/sipario.js'), 'export', ...args], { encoding: 'utf8' });
    eq(status, 2, `it exited on the usage (${args.join(' ') || 'no format'})`);
    if (!/usage: sipario export <pdf\|pptx\|video>/.test(stderr)) throw new Error(`no usage line: ${stderr}`);
  }
});

check('an export that finds no browser leaves nothing listening or watching behind it', () => {
  /* The server is started before the browser is looked for, so a machine
     with no browser used to be left holding the port and watching the
     talk for the life of the process. A CLI exits either way and says
     nothing about it; this runs a process that does not, and lets the
     absence of a hang be the assertion. */
  const probe = `
    process.env.SIPARIO_BROWSER = '/nowhere/no-browser-here';
    const { exportPdf } = require(${JSON.stringify(path.join(ROOT, 'lib/export.js'))});
    exportPdf(${JSON.stringify(TALK.dir)}).then(
      () => console.log('RESOLVED'),
      (err) => console.log('REFUSED ' + err.message.split('\\n')[0]));
  `;
  const { status, stdout, signal } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  if (status === null) {
    throw new Error(`the process did not end by itself (${signal}): something is still listening or watching`);
  }
  eq(status, 0, 'it exited of its own accord');
  if (!/^REFUSED .*SIPARIO_BROWSER/.test(stdout.trim())) {
    throw new Error(`it did not refuse by naming the browser: ${stdout.trim()}`);
  }
});

/* The checks that need a browser. They run the CLI as a reader would, in
   a folder of their own, and read the files back. */
{
  let browser = null;
  try { browser = findBrowser(); } catch { /* none on this machine */ }
  const whenBrowser = (name, fn) => {
    if (browser) return check(name, fn);
    return console.log(`  --    ${name}\n        not run: no browser on this machine to export with`);
  };
  /* A talk of its own, copied from the example, for the checks that have
     to break one. */
  const scratch = () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-broken-'));
    const t = path.join(dir, 'talk');
    scaffold(t);
    return t;
  };

  whenBrowser('a figure that does not load stops the export and is named', () => {
    /* render() does not open every file a template names, so a deleted
       icon renders happily and prints as a hole. Nothing downstream
       would mention it: the ids match, the sizes match, and the export
       would write a file that is wrong only to look at. */
    const dir = scratch();
    const icon = path.join(dir, 'images', 'icon-folder.svg');
    if (!fs.existsSync(icon)) throw new Error('the example no longer has the icon this check removes');
    fs.rmSync(icon);
    const { status, stderr } = require('child_process')
      .spawnSync('node', [path.join(ROOT, 'bin/sipario.js'), 'export', 'pdf', dir],
        { cwd: dir, encoding: 'utf8', timeout: 90000 });
    eq(status, 1, `it refused (${stderr.trim()})`);
    if (!/icon-folder\.svg/.test(stderr)) throw new Error(`it did not name the figure: ${stderr.trim()}`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  whenBrowser('a save while the deck is exporting stops it, rather than pairing the new pictures with the old scripts', () => {
    /* The outline is read from deck.md, and the page is rendered from
       deck.md again when the browser asks for it. An edit inside a
       script moves no id and changes no size, so this is the only thing
       standing between a save mid-export and a file whose notes belong
       to the draft before it.

       The export reads deck.md before its first await, and the edit
       below lands straight after the call, so the page the browser is
       later served is certainly the edited one. Nothing here races. */
    const dir = scratch();
    const deck = path.join(dir, 'deck.md');
    const out = path.join(dir, 'out.pdf');
    const probe = `
      const fs = require('fs');
      const { exportPdf } = require(${JSON.stringify(path.join(ROOT, 'lib/export.js'))});
      const deck = ${JSON.stringify(deck)};
      const out = ${JSON.stringify(out)};
      const before = fs.readFileSync(deck, 'utf8');
      const after = before.replace('This deck exists twice over.',
                                   'This deck exists twice over. Edited mid-export.');
      if (after === before) throw new Error('the example no longer holds the line this edits');
      const running = exportPdf(${JSON.stringify(dir)}, { out });
      fs.writeFileSync(deck, after);
      running.then(
        () => console.log(JSON.stringify({ finished: true, wrote: fs.existsSync(out) })),
        (e) => console.log(JSON.stringify({ message: e.message, wrote: fs.existsSync(out) })));
    `;
    const { status, stdout, stderr } = require('child_process')
      .spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 90000 });
    eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
    const r = JSON.parse(stdout.trim().split('\n').pop());
    if (r.finished) throw new Error('the export finished as though nothing had changed');
    if (!/changed while the deck was being exported/.test(r.message)) {
      throw new Error(`it stopped for another reason: ${r.message}`);
    }
    eq(r.wrote, false, 'and wrote no file');
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  whenBrowser("exported, the example is a PDF of a page per step at the stage's size, " +
    'and a PowerPoint deck of a picture per step with its script', () => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-export-'));
      const cli = path.join(ROOT, 'bin/sipario.js');
      const run = (args) => require('child_process')
        .spawnSync('node', [cli, 'export', ...args], { cwd: dir, encoding: 'utf8', timeout: 90000 });

      const pdf = run(['pdf', TALK.dir]);
      eq(pdf.status, 0, `pdf exported (${pdf.stderr.trim()})`);
      if (!/^\[export\] minimal\.pdf: \d+ pages at 1280x720/.test(pdf.stdout)) throw new Error(`said: ${pdf.stdout}`);
      const buf = fs.readFileSync(path.join(dir, 'minimal.pdf'));
      eq(pdfPages(buf), steps, 'a page per step');
      if (!/\/MediaBox \[0 0 960 540\]/.test(buf.toString('latin1'))) {
        throw new Error('the page is not 1280x720 at 96 to the inch, which is 960x540 points');
      }

      const ppt = run(['pptx', TALK.dir, '-o', 'deck.pptx']);
      eq(ppt.status, 0, `pptx exported (${ppt.stderr.trim()})`);
      const parts = unzip(fs.readFileSync(path.join(dir, 'deck.pptx')));
      eq([...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, steps, 'a slide per step');
      const png = parts.get('ppt/media/image1.png');
      eq(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, '2560x1440', 'the picture is the stage at twice its size');
      const first = outline(deckSrc, TALK)[0].notes.split('\n')[0];
      if (!parts.get('ppt/notesSlides/notesSlide1.xml').toString('utf8').includes(`<a:t>${first}</a:t>`)) {
        throw new Error('the first script is not in the first notes');
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

// ------------------------------------------------------------ the CLI, run

check('renumber agrees with the renderer, and rewrites nothing that is right', () => {
  /* renumber counts a deck's sections itself, so it can repair a deck the
     renderer is refusing. That second copy of the rule is what drifted:
     it still asked for `kind: section` after the key became `template:`,
     counted five sections instead of eleven and renumbered thirty-five
     slides wrongly, and nothing ran it. It is also asserted to be a no-op
     on a correct deck, so a run never has to be read to be trusted. */
  const os = require('os');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'renumber-')), 'deck.md');
  fs.writeFileSync(tmp, deckSrc);
  const out = require('child_process')
    .execFileSync('node', [path.join(ROOT, 'bin/sipario-renumber.js'), tmp], { encoding: 'utf8' });
  if (!out.includes('all already correct')) {
    throw new Error(`renumber disagrees with the deck it is numbering: ${out.trim()}`);
  }
  if (fs.readFileSync(tmp, 'utf8') !== deckSrc) {
    throw new Error('renumber rewrote a deck that was already correct');
  }
});

check('renumber honours number-from: 0', () => {
  const os = require('os');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'renumber-')), 'deck.md');
  fs.writeFileSync(tmp, MOVES_SRC.replace('name: Moves', 'name: Moves\nnumber-from: 0'));
  require('child_process').execFileSync('node', [path.join(ROOT, 'bin/sipario-renumber.js'), tmp], { encoding: 'utf8' });
  const out = fs.readFileSync(tmp, 'utf8');
  eq(/^## 0\.1 /m.test(out), true, 'the first slide became 0.1');
  eq(/^id: 0-three-movements$/m.test(out), true, 'and its id prefix followed');
  eq(/^## 1\.1\b/m.test(out), true, 'the second movement is 1.x');
  render(out, TALK);                       // and the renderer agrees
});

/* A deck opening with a comment, carrying a quoted id. Both are things
   the renderer accepts, so renumber has to accept them too: it edits a
   deck in place, and a deck it breaks is one somebody wrote correctly. */
const COMMENTED = ['<!--', '# Editing notes', 'A hash here is prose, not a movement.', '-->', '',
  'name: Commented', '', '# One', '', '## 1.1 First', "id: '1-quoted'", 'template: statement', '',
  'One.', '', '```notes', 'The first.', '```', '', '# Two', '', '## 2.1 Second', 'id: 2-plain',
  'template: statement', '', 'Two.', '', '```notes', 'The second.', '```', ''].join('\n');

const renumbered = (src) => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'renumber-'));
  const file = path.join(dir, 'deck.md');
  fs.writeFileSync(file, src);
  const r = require('./lib/renumber.js').renumber(file);
  const after = fs.readFileSync(file, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, after };
};

check('a comment at the head of a deck is prose to renumber, as it is to the renderer', () => {
  /* The renderer drops a leading comment before it reads anything. This
     did not, so a `# ` line inside one counted as a movement, pushed
     every number up by one and rewrote a deck that was already right. */
  render(COMMENTED, TALK);                       // the deck is good to start with
  const { r, after } = renumbered(COMMENTED);
  eq(r.sections, 2, 'two movements, not three');
  eq(r.changed, 0, 'and nothing to renumber');
  eq(after.startsWith('<!--\n# Editing notes'), true, 'the comment is still there, untouched');
  eq((after.match(/^## .*$/gm) || []).join(' '), '## 1.1 First ## 2.1 Second', 'the numbers held');
  render(after, TALK);                           // and it still renders
});

check('a deck whose number-from sits under a comment is still numbered from there', () => {
  /* The scan for `number-from:` stops at the first movement, and a hash
     inside the comment was one, so the key below it was never read. */
  const { r, after } = renumbered(COMMENTED.replace('name: Commented', 'name: Commented\nnumber-from: 0'));
  eq(r.sections, 2, 'still two movements');
  eq((after.match(/^## .*$/gm) || []).join(' '), '## 0.1 First ## 1.1 Second', 'counted from zero');
  eq(/^id: '0-quoted'$/m.test(after), true, "and the id's prefix followed");
});

check('renumber reads through the quotes on an id rather than prefixing them', () => {
  /* Front matter may quote a value, and the quotes belong to the parser,
     not to the id. Prefixed blindly, `id: '1-x'` became `id: 1-'1-x'`,
     which renders as a different anchor: every link to that slide, and
     the slide's own place in the deck's numbering, quietly moved. */
  const { after } = renumbered(COMMENTED);
  eq(/^id: '1-quoted'$/m.test(after), true, 'the quoted id is unchanged');
  const ids = [...render(after, TALK).html.matchAll(/<section class="slide[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
  eq(ids.join(' '), '1-quoted 2-plain', 'and it is still the anchor it was');
});

check('renumber moves a quoted id to its new section, keeping its quotes', () => {
  /* The movement is renamed away, so the second slide becomes 1.2 and
     its prefix has to follow it while the quotes stay where they were. */
  const { after } = renumbered(COMMENTED.replace('\n# Two\n', '\n'));
  eq((after.match(/^## .*$/gm) || []).join(' '), '## 1.1 First ## 1.2 Second', 'both in one movement now');
  eq(/^id: '1-quoted'$/m.test(after), true, 'the quoted id kept its quotes');
  eq(/^id: 1-plain$/m.test(after), true, 'and the plain one moved too');
  render(after, TALK);
});

check('renumber with no deck named says so rather than guessing', () => {
  const { status, stderr } = require('child_process')
    .spawnSync('node', [path.join(ROOT, 'bin/sipario-renumber.js')], { encoding: 'utf8' });
  eq(status, 2, 'it exited on the usage');
  if (!/usage: sipario-renumber/.test(stderr)) throw new Error(`no usage line: ${stderr}`);
});

// -------------------------------------------- starting a second talk

/* `sipario new` copies the example and renames it. The example is what
   the suite above renders, so the only things left to prove here are that
   the copy is complete enough to render on its own, that it is a
   *different* talk from the one it was copied from, and that it never
   lands on top of somebody's work. */

const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-new-'));
const started = path.join(scratch, 'a-second-talk');
let startError = null;
try { scaffold(started); } catch (err) { startError = err; }

check('a talk is started by copying the example', () => {
  if (startError) throw startError;
  for (const f of ['deck.md', 'templates/title.html', 'deck.css',
                   'templates/title.css',
                   'fonts/inter.woff2', 'images/icon-check.svg',
                   'images/one-piece.svg']) {
    if (!fs.existsSync(path.join(started, f))) throw new Error(`the new talk has no ${f}`);
  }
});

check('a started talk renders, against its own folder and nothing else', () => {
  const t = talk(started);
  const r = render(fs.readFileSync(t.deck, 'utf8'), t);
  eq(r.slides, slides, 'slides in the started talk');
  eq(r.steps, steps, 'steps in the started talk');
  if (!/<section class="slide/.test(r.html)) throw new Error('no slides in the rendered html');
});

check('a started talk is named after its folder, not after the fixture', () => {
  /* The whole reason `name:` is required. A copy that kept "Minimal"
     would share this deck's bookmark key and its presenter channel with
     every other talk started the same way. */
  const t = talk(started);
  const r = render(fs.readFileSync(t.deck, 'utf8'), t);
  eq(r.deck.name, 'A second talk', 'the started talk\'s name');
  eq(r.deck.key, 'sipario:a-second-talk', 'the started talk\'s key');
  if (r.deck.key === deck.key) throw new Error('the started talk shares the fixture\'s key');
  if (/Minimal/.test(r.deck.title)) throw new Error(`the title still says Minimal: ${r.deck.title}`);
  /* A started talk carries no title of its own: the example's described
     the example, and `title:` falls back to `name:`. A new talk whose tab
     read "… — a slide of every template" would be wearing the fixture's
     description. */
  eq(r.deck.title, 'A second talk', 'a started talk is titled by its name alone');
  if (/\btitle:/.test(fs.readFileSync(t.deck, 'utf8').split('\n\n')[0])) {
    throw new Error('the started deck still declares a title');
  }
});

check('a started talk passes everything true of any talk', () => {
  for (const { name, fn } of talkChecks(talk(started))) {
    try { fn(); } catch (err) { throw new Error(`${name}: ${err.message}`); }
  }
});

check('a talk is not started in a folder that already holds something', () => {
  const taken = path.join(scratch, 'taken');
  fs.mkdirSync(taken);
  fs.writeFileSync(path.join(taken, 'deck.md'), 'name: Mine\n');
  let err = null;
  try { scaffold(taken); } catch (e) { err = e; }
  if (!err) throw new Error('it started a talk on top of a folder that was not empty');
  if (!/not empty/.test(err.message)) throw new Error(`unhelpful refusal: ${err.message}`);
  eq(fs.readFileSync(path.join(taken, 'deck.md'), 'utf8'), 'name: Mine\n', 'what was there');
  eq(fs.readdirSync(taken).length, 1, 'files in the folder it refused');
});

check('a folder no name can be read from is refused before anything is copied', () => {
  const unnameable = path.join(scratch, '---');
  let err = null;
  try { scaffold(unnameable); } catch (e) { err = e; }
  if (!err) throw new Error('it started a talk it could not name');
  if (fs.existsSync(unnameable)) throw new Error('it copied the example anyway');
});

check('the CLI starts a talk and says how to serve it', () => {
  const dir = path.join(scratch, 'from-the-cli');
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', [path.join(ROOT, 'bin/sipario.js'), 'new', dir], { encoding: 'utf8' });
  eq(status, 0, `it exited cleanly (${stderr})`);
  if (!/sipario serve/.test(stdout)) throw new Error(`no next step in: ${stdout}`);
  if (!/deck\.md/.test(stdout)) throw new Error(`it does not say where the words are: ${stdout}`);
  eq(fs.existsSync(path.join(dir, 'deck.md')), true, 'a deck on disk');
});

check('new and serve both default to ./talk, so neither needs an argument', () => {
  /* The two commands that get a stranger to a rendered deck take no
     argument at all: `new` writes ./talk, `serve` reads it. An explicit
     folder still wins, and the next step printed matches what was typed. */
  const cwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-default-'));
  const bin = path.join(ROOT, 'bin/sipario.js');
  const spawn = (args) => require('child_process')
    .spawnSync('node', [bin, ...args], { encoding: 'utf8', cwd });

  const missing = spawn(['serve']);
  eq(missing.status, 2, 'serve with no ./talk exits on the usage');
  if (!/\.\/talk by default/.test(missing.stderr)) {
    throw new Error(`the usage does not name the default: ${missing.stderr}`);
  }

  const made = spawn(['new']);
  eq(made.status, 0, `new with no argument (${made.stderr})`);
  eq(fs.existsSync(path.join(cwd, 'talk/deck.md')), true, 'a deck in ./talk');
  if (!/npx sipario serve +and open/.test(made.stdout)) {
    throw new Error(`the next step still names a folder: ${made.stdout}`);
  }

  const named = spawn(['new', 'chosen']);
  eq(named.status, 0, `new with a folder (${named.stderr})`);
  if (!/npx sipario serve chosen/.test(named.stdout)) {
    throw new Error(`a chosen folder is not named back: ${named.stdout}`);
  }
});

check('sipario with no command says which it has, rather than doing one', () => {
  const { status, stdout } = require('child_process')
    .spawnSync('node', [path.join(ROOT, 'bin/sipario.js')], { encoding: 'utf8' });
  eq(status, 2, 'it exited on the usage');
  for (const cmd of ['new', 'serve', 'renumber']) {
    if (!new RegExp(`\\b${cmd}\\b`).test(stdout)) throw new Error(`${cmd} is not listed: ${stdout}`);
  }
});

check('the old names still run, because talks have them in their scripts', () => {
  /* `sipario serve talk` and `sipario-serve talk` are one command. The
     aliases exist so consolidating the bins was not a rename in every
     consumer, and a usage line names whichever was typed. */
  /* Run from an empty folder: `serve` defaults to ./talk, so a usage line
     is what it gives only where there is no talk to default to. */
  const nowhere = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-empty-'));
  for (const [bin, as] of [['bin/sipario-serve.js', 'sipario-serve'],
                           ['bin/sipario-renumber.js', 'sipario-renumber']]) {
    const { status, stderr } = require('child_process')
      .spawnSync('node', [path.join(ROOT, bin)], { encoding: 'utf8', cwd: nowhere });
    eq(status, 2, `${bin} exited on the usage`);
    if (!new RegExp(`usage: ${as}`).test(stderr)) throw new Error(`${bin}: ${stderr}`);
  }
});

check('the example ships in the package, because it is what `new` copies', () => {
  /* Without this line the folder is in the repo and not in the tarball,
     and `npx sipario new` fails on a fresh install with nothing to copy. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!pkg.files.includes('starters/')) {
    throw new Error(`package.json files: ${pkg.files.join(', ')} — starters/ is not among them`);
  }
  if (!pkg.bin.sipario) throw new Error('package.json declares no `sipario` bin');
});

// -------------------------------------------------- the frame, and only it

check('the frame knows nothing about what a slide contains', () => {
  /* If it did, a talk could not restyle one template's slides without
     editing something every other talk also reads. Comments may still
     explain the convention; rules may not use it. */
  const theme = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const face of ['Raleway', 'Inter']) {
    if (theme.includes(face)) throw new Error(`css/theme.css still names ${face}`);
  }
  const named = [...theme.matchAll(/\.template-[a-z-]+/g)].map((m) => m[0]);
  if (named.length) {
    throw new Error(`css/theme.css styles ${[...new Set(named)].join(', ')}, ` +
      "which is the talk's business");
  }
});

check('the shared half names no template of the talk it happens to be serving', () => {
  /* The review trigger for this whole split. `render.js` gave `section`
     its word and `presenter.js` looked for `p.statement-line`; both were
     a talk's design sitting in code every other talk reads. */
  const shared = ['css/theme.css', 'css/presenter.css', 'css/print.css', 'css/phone.css', 'js/deck.js',
                  'js/presenter.js', 'js/audience.js', 'js/phone.js', 'js/qr.js', 'lib/render.js', 'lib/pages.js',
                  'lib/engine.js', 'lib/templates.js', 'lib/export.js', 'lib/pptx.js', 'lib/browser.js',
                  'lib/relay.js', 'lib/server.js']
    .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
  for (const k of names) {
    for (const [f, text] of shared) {
      const hit = new RegExp(`[.#]${k}-[a-z-]+|template-${k}\\b`).exec(text);
      if (hit) throw new Error(`${f} names ${hit[0]}, which belongs to the talk`);
    }
  }
});

check("every url() in the frame's stylesheets resolves to a file", () => {
  /* A `url()` that points nowhere is the quietest failure in CSS: the
     property is dropped and the page renders as though nobody had asked
     for it. */
  const missing = [];
  for (const sheet of ['css/theme.css', 'css/presenter.css', 'css/print.css', 'css/phone.css']) {
    const text = fs.readFileSync(path.join(ROOT, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const ref = m[1].trim();
      if (/^(data:|https?:|\/\/)/.test(ref)) continue;
      if (!fs.existsSync(path.join(ROOT, 'css', ref.split('?')[0]))) {
        missing.push(`${sheet} asks for ${ref}, which is not beside it`);
      }
    }
  }
  if (missing.length) throw new Error(missing.join('\n        '));
});

check('colours in the frame are named for their purpose, not their value', () => {
  /* A rule asking for --slate-500 says a shade and leaves the reader to
     guess where it belongs, and a talk restyling itself has to know the
     scale to know what it is changing. Names say the job instead. */
  const SCALES = /var\(--(slate|teal|gray|zinc|neutral|stone|indigo|sky|blue|amber)-?\d*\)/;
  const VALUES = /var\(--(white|black|green|red|blue|indigo|purple|orange)\)/;
  for (const f of ['css/theme.css', 'css/presenter.css', 'css/print.css', 'css/phone.css']) {
    for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(SCALES) || line.match(VALUES);
      if (m) throw new Error(`${f} asks for ${m[0]}, which names a colour rather than a job`);
    }
  }
});

check('no token is declared and never asked for', () => {
  const text = ['css/theme.css', 'css/presenter.css', 'css/print.css']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') +
    talkCss() +
    fs.readdirSync(TALK.templateRoot).filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(TALK.templateRoot, f), 'utf8')).join('\n');
  const declared = [...fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8')
    .matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
  const used = new Set([...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const dead = declared.filter((t) => !used.has(t));
  if (dead.length) throw new Error(`declared, never used: ${dead.join(', ')}`);
});

check("the talk's sheets load after the frame's, most specific last", () => {
  /* Read off the pages the server actually sends, not off the source that
     builds them: the links are generated now, and a check that greps
     lib/pages.js for literal hrefs would pass while the page linked
     nothing at all. */
  const { deckPage, presenterPage } = require('./lib/pages.js');
  const r = render(deckSrc, TALK);
  const expected = ['/deck.css'].concat(r.sheets);
  if (!r.sheets.length) throw new Error('the example defines no template sheets to link');
  for (const page of [deckPage(r), presenterPage(r, 9999)]) {
    const links = [...page.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
    if (links[0] !== '/css/theme.css') throw new Error(`the frame is not first: ${links[0]}`);
    const talk = links.filter((l) => !l.startsWith('/css/'));
    if (talk.join(' ') !== expected.join(' ')) {
      throw new Error(`talk sheets are ${talk.join(' ')}, not ${expected.join(' ')}`);
    }
    if (links.indexOf(talk[0]) < links.lastIndexOf('/css/theme.css')) {
      throw new Error('a talk sheet loads before the frame');
    }
  }
});

// -------------------------------------------------------------- the example

check('a layered figure in the example reveals a layer per step', () => {
  const inline = [...html.matchAll(/<figure class="image-figure">([\s\S]*?)<\/figure>/g)].map((m) => m[1]);
  if (!inline.length) throw new Error('the example has no inlined layered figure');
  const hidden = inline.map((svg) => (svg.match(/layer hidden-step/g) || []).length);
  if (hidden[0] <= hidden[hidden.length - 1]) {
    throw new Error(`layers are not being revealed: ${hidden.join(' -> ')} hidden across the steps`);
  }
});

check('nothing the library ships requires anything outside Node', () => {
  /* The claim in docs/DEVELOPING.md, kept true by a check rather than by
     memory. Comment lines are skipped: lib/lint.js shows a consumer
     requiring 'sipario'. */
  const { builtinModules } = require('module');
  const files = ['index.js'].concat(['lib', 'bin'].flatMap((d) =>
    fs.readdirSync(path.join(ROOT, d)).map((f) => path.join(d, f))));
  const foreign = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
      for (const [, id] of line.matchAll(/require\(\s*'([^'.][^']*)'\s*\)/g)) {
        if (!builtinModules.includes(id.replace(/^node:/, ''))) foreign.push(`${f}: ${id}`);
      }
    }
  }
  if (foreign.length) throw new Error(`external requires: ${foreign.join(', ')}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  eq(Object.keys(pkg.dependencies || {}).length, 0, 'package.json declares no dependencies');
});

check('the server serves the pages and the sheets, and not the templates', () => {
  /* The only check that starts the server. It is here because everything
     above reads files and builds pages in-process, so a `serve()` that
     throws on the first request passes every one of them — which is
     exactly what happened when the talk's stylesheet moved and a stale
     mount was left behind. */
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(TALK.dir)}, { port: 0, log: quiet });
    let port;
    const get = async (u) => { const r = await fetch('http://localhost:' + port + u);
                               return { status: r.status, type: r.headers.get('content-type'),
                                        body: await r.text() }; };
    /* fetch normalises a URL before sending it, so a request path the
       server must see verbatim goes over http.get. */
    const http = require('http');
    const raw = (p) => new Promise((ok) => http.get({ port, path: p }, (r) => {
      r.resume(); ok(r.statusCode);
    }));
    const firstEvent = () => new Promise((ok) => http.get({ port, path: '/events' }, (r) => {
      r.once('data', (c) => { ok({ type: r.headers['content-type'], chunk: String(c) }); r.destroy(); });
    }));
    (async () => {
      await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
      port = s.address().port;
      const page = await get('/');
      const out = {
        status: page.status,
        type: page.type,
        links: [...page.body.matchAll(/href="([^"]+\\.css)"/g)].map((m) => m[1]),
        sheet: (await get('/templates/title.css')).status,
        markup: (await get('/templates/title.html')).status,
        data: (await get('/templates/icon-list.js')).status,
        css: (await get('/css/theme.css')).type,
        js: (await get('/js/deck.js')).type,
        font: (await get('/fonts/inter.woff2')).type,
        deckCss: (await get('/deck.css')).type,
        missing: (await get('/images/nope.svg')).status,
        folder: (await get('/images/')).status,
        escaped: await raw('/css/..%2fpackage.json'),
        dotdot: await raw('/css/../package.json'),
        reload: await firstEvent(),
      };
      console.log(JSON.stringify(out));
      s.close(); process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8' });
  eq(status, 0, `the probe exited cleanly (${stderr.trim()})`);
  const out = JSON.parse(stdout.trim().split('\n').pop());
  eq(out.status, 200, 'the deck page');
  eq(out.links[0], '/css/theme.css', 'the frame is linked first');
  eq(out.links[1], '/deck.css', "the talk's own sheet is next");
  if (!out.links.slice(2).every((l) => l.startsWith('/templates/'))) {
    throw new Error(`unexpected sheets after the talk's: ${out.links.slice(2).join(' ')}`);
  }
  eq(out.sheet, 200, "a template's stylesheet is served");
  /* A talk's templates are read here, never published: the markup and the
     data function are the talk's source, not its assets. */
  eq(out.markup, 404, "a template's markup is not served");
  eq(out.data, 404, "a template's data function is not served");
  /* What express.static used to do unasked, now this server's to keep. */
  eq(out.type, 'text/html; charset=utf-8', 'the page is html');
  eq(out.css, 'text/css; charset=utf-8', "the frame's sheet is css");
  eq(out.js, 'text/javascript; charset=utf-8', "the frame's script is javascript");
  eq(out.font, 'font/woff2', 'a font is served as one');
  eq(out.deckCss, 'text/css; charset=utf-8', "the talk's sheet is css");
  eq(out.missing, 404, 'a missing image is a 404');
  eq(out.folder, 404, 'a mount is not listed');
  eq(out.escaped, 404, 'an encoded ../ does not leave the mount');
  eq(out.dotdot, 404, 'a literal ../ does not leave the mount');
  eq(out.reload.type, 'text/event-stream', 'the reload stream is one');
  if (!/^event: reload\ndata: \d+\n\n$/.test(out.reload.chunk)) {
    throw new Error(`the first reload event is ${JSON.stringify(out.reload.chunk)}`);
  }
});

check('a request that is not a URL is answered, and does not take the server with it', () => {
  /* `new URL()` throws on a request line like `//[/`, and a throw in a
     request handler is uncaught: a stranger on the network could end a
     talk between two slides. The assertion that matters is the second
     request, which only arrives if the server is still there. */
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const net = require('net');
    const quiet = { log(){}, warn(){}, error(){} };
    const s = serve(${JSON.stringify(TALK.dir)}, { port: 0, log: quiet });
    process.on('uncaughtException', (e) => { console.log(JSON.stringify({ crashed: e.code })); process.exit(0); });
    s.once('listening', () => {
      const port = s.address().port;
      const c = net.connect(port, '127.0.0.1', () => c.write('GET //[/ HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n'));
      let said = '';
      c.on('data', (d) => {
        said += d;
        if (!/\\r\\n/.test(said)) return;
        c.destroy();
        /* Still answering after the bad one is the whole point. */
        fetch('http://127.0.0.1:' + port + '/').then((r) => {
          console.log(JSON.stringify({ status: said.split('\\r\\n')[0], after: r.status }));
          process.exit(0);
        });
      });
    });
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8', timeout: 25000 });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim().split('\n').pop() || '{}');
  if (out.crashed) throw new Error(`the server died of the request: ${out.crashed}`);
  eq(/^HTTP\/1\.1 400\b/.test(out.status || ''), true, `it answered ${out.status}`);
  eq(out.after, 200, 'and was still serving the deck afterwards');
});

check('the Templates slide lists every template, and each titled slide carries its number', () => {
  /* The section slide carries the programme, one item per template in
     the order the deck shows them, and each slide with a heading carries
     its template's number in its title. Both are typed by hand, so this
     is what keeps them one list. A template shown twice, the figure whole
     and in layers, numbers both slides the same. */
  for (const st of ['minimal', 'stylish']) {
    const src = fs.readFileSync(path.join(ROOT, 'starters', st, 'deck.md'), 'utf8');
    const section = src.split(/^(?=## )/m).find((slide) => /^template: section$/m.test(slide));
    const listed = [...section.matchAll(/^- (.+)$/mg)].map((m) => m[1]);
    const templates = new Set([...src.matchAll(/^template: (.+)$/mg)].map((m) => m[1]));
    eq(listed.length, templates.size, `${st}: one item per template the deck uses`);
    const titled = [...src.matchAll(/^## \d+\.\d+ (\d+)\. (.+)$/mg)]
      .map((m) => ({ n: Number(m[1]), title: m[2] }));
    if (titled.length < 9) throw new Error(`${st}: only ${titled.length} titles carry a number`);
    /* The same opening words: the figure's two slides are "A figure,
       whole" and "A figure, in layers" under one item that says both. */
    const opening = (s) => s.split(/[\s,]+/).slice(0, 2).join(' ');
    for (const { n, title } of titled) {
      const item = listed[n - 1];
      if (!item || opening(title) !== opening(item)) {
        throw new Error(`${st}: "${n}. ${title}" but item ${n} of the programme is "${item}"`);
      }
    }
  }
});

check('the keys slide says what the help overlay says, row for row', () => {
  /* The overlay is built in deck.js and the slide is written in deck.md,
     so nothing but this keeps them one list. Both starters carry it. */
  const overlay = [...js.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [
    m[1].replace(/&larr;/g, '←').replace(/&rarr;/g, '→').replace(/&darr;/g, '↓').replace(/&uarr;/g, '↑'),
    m[2]]);
  if (overlay.length < 10) throw new Error(`only ${overlay.length} rows read off the overlay`);
  for (const st of ['minimal', 'stylish']) {
    const src = fs.readFileSync(path.join(ROOT, 'starters', st, 'deck.md'), 'utf8');
    const slide = src.split(/^(?=## )/m).find((s) => /^id: \d+-the-keys$/m.test(s));
    if (!slide) throw new Error(`${st} has no keys slide`);
    const rows = [...slide.matchAll(/^- \([a-z]+\) `([^`]+)` (.+)$/mg)].map((m) => [m[1], m[2]]);
    eq(rows.length, overlay.length, `${st}: as many rows as the overlay`);
    rows.forEach(([k, gloss], i) => {
      eq(k, overlay[i][0], `${st}: key ${i + 1}`);
      eq(gloss, overlay[i][1], `${st}: what key ${i + 1} does`);
    });
  }
});

check('the two starters are one deck in two dresses', () => {
  /* stylish exists to show that a look is the talk's alone, which is only
     shown if the deck under it is the minimal one. Every word may differ;
     the skeleton may not: the same templates in the same order, each
     slide built in the same number of steps. A slide added to one starter
     and not the other fails here rather than going unnoticed. */
  const bones = (t) => [...render(fs.readFileSync(t.deck, 'utf8'), t).html
    .matchAll(/<section class="slide template-([a-z-]+)[^"]*" id="[^"]+" data-n="([^"]+)"/g)]
    .map((m) => `${m[2]} ${m[1]}`);
  const mine = bones(TALK);
  const theirs = bones(talk(path.join(ROOT, 'starters/stylish')));
  const at = mine.findIndex((x, i) => x !== theirs[i]);
  if (at > -1 || mine.length !== theirs.length) {
    throw new Error(`the decks part at step ${at + 1}: minimal has ${mine[at] || 'nothing'}, ` +
      `stylish has ${theirs[at] || 'nothing'}`);
  }
});

check('the server notices a save that replaces the file, not only one that rewrites it', () => {
  /* Most editors save by writing a new file and renaming it over the old
     one. A watcher on the file itself followed the old inode, so the
     first such save was the last the server ever noticed; the talk is
     watched as a folder now, and this is what keeps it so. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-watch-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const probe = `
    const fs = require('fs'); const path = require('path');
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const dir = ${JSON.stringify(dir)};
    const s = serve(dir, { port: 0, log: quiet });
    const deck = path.join(dir, 'deck.md');
    const replace = () => {
      fs.writeFileSync(deck + '.tmp', fs.readFileSync(deck, 'utf8') + '\\n');
      fs.renameSync(deck + '.tmp', deck);
    };
    const events = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
      require('http').get({ port: s.address().port, path: '/events' }, (r) => {
        r.on('data', (c) => events.push(String(c)));
      });
      await wait(400);
      for (let i = 0; i < 3; i++) { replace(); await wait(400); }
      console.log(JSON.stringify(events.length - 1));   // less the one sent on connect
      process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(status, 0, `the probe exited cleanly (${stderr.trim()})`);
  eq(JSON.parse(stdout.trim().split('\n').pop()), 3, 'three replacing saves are three reloads');
});

check('a deck that does not render yet is served as its error, and the server stays up', () => {
  /* The listening callback rendered once for the banner, and a deck with a
     fault in it threw there, out of the process. A deck being written is
     in that state half the time; the page shows the error and reloads on
     the next save, and both need a server to be there. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-broken-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const deck = path.join(dir, 'deck.md');
  fs.writeFileSync(deck, fs.readFileSync(deck, 'utf8').replace('## 3.5 ', '## 3.50 '));
  const probe = `
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const logged = [];
    const log = { log(m){ logged.push(m); }, warn(){}, error(m){ logged.push(m); } };
    const s = serve(${JSON.stringify(dir)}, { port: 0, log });
    (async () => {
      await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
      const port = s.address().port;
      const r = await fetch('http://localhost:' + port + '/');
      const body = await r.text();
      console.log(JSON.stringify({ status: r.status, error: /declared 3.50/.test(body),
        reloads: /Fix it and this page reloads itself/.test(body), logged }));
      process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process')
    .spawnSync('node', ['-e', probe], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(status, 0, `the server stayed up (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim().split('\n').pop());
  eq(out.status, 500, 'the page is the error');
  eq(out.error, true, 'and names the fault');
  eq(out.reloads, true, 'and says it reloads on the next save');
  eq(out.logged.some((m) => /does not render yet/.test(m)), true, 'the banner said so too');
});

check('the error page reloads on a change, not on the token it connects with', () => {
  /* The stream sends its current token on connect. The page reloaded on
     every message, that one included, so a deck with a fault reloaded
     the error for ever: connect, token, reload, connect. */
  const { errorPage } = require('./lib/pages.js');
  const html = errorPage(new Error('a fault'));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let onmessage = null, url = '', reloads = 0;
  const window = {
    EventSource: function (u) { url = u; this.addEventListener = (name, f) => { if (name === 'reload') onmessage = f; }; },
    location: { reload() { reloads++; } },
  };
  new Function('EventSource', 'location', script)(window.EventSource, window.location);
  eq(url, '/events', 'the page listens on the one stream every page has');
  if (!onmessage) throw new Error('the page did not listen for a reload');
  onmessage({ data: '100' });
  eq(reloads, 0, 'the token it connected with is not a change');
  onmessage({ data: '100' });
  eq(reloads, 0, 'nor is the same token again');
  onmessage({ data: '101' });
  eq(reloads, 1, 'a new token is a save, and reloads');
});

check('the notes page says which version it is, and an earlier one can be asked for', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-versions-'));
  fs.cpSync(TALK.dir, dir, { recursive: true });
  const probe = `
    const fs = require('fs'); const path = require('path');
    const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
    const quiet = { log(){}, warn(){}, error(){} };
    const dir = ${JSON.stringify(dir)};
    const s = serve(dir, { port: 0, log: quiet });
    let port;
    const get = async (u) => (await fetch('http://localhost:' + port + u)).text();
    const ver = (html) => (html.match(/data-version="([^"]*)"/) || [])[1];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await new Promise((ok) => (s.listening ? ok() : s.once('listening', ok)));
      port = s.address().port;
      /* The room opens first, and only the deck page is served before the
         save; the notes come later and ask for what the room is seeing. */
      await get('/');
      const v1 = await new Promise((ok) => require('http').get({ port, path: '/events' }, (r) => {
        r.once('data', (c) => { ok(/data: (\\d+)/.exec(String(c))[1]); r.destroy(); });
      }));
      const deck = path.join(dir, 'deck.md');
      const f = String.fromCharCode(96).repeat(3);           // a fence, kept out of this template
      fs.writeFileSync(deck, fs.readFileSync(deck, 'utf8').replace(f + 'notes\\n', f + 'notes\\nEdited since.\\n'));
      await wait(400);
      const latest = await get('/presenter');
      const held = await get('/presenter?v=' + v1);
      console.log(JSON.stringify({ v1, v2: ver(latest), heldV: ver(held), heldEdited: /Edited since/.test(held), latestEdited: /Edited since/.test(latest) }));
      process.exit(0);
    })();
  `;
  const { status, stdout, stderr } = require('child_process').spawnSync('node', ['-e', probe], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(status, 0, `the probe ran (${stderr.trim().split('\n')[0]})`);
  const out = JSON.parse(stdout.trim().split('\n').pop());
  if (!out.v1) throw new Error('the page carries no version');
  if (out.v1 === out.v2) throw new Error('a save did not change the version');
  eq(out.latestEdited, true, 'the latest page has the edit');
  eq(out.heldV, out.v1, 'the earlier version is served back by number');
  eq(out.heldEdited, false, 'as it was rendered');
});

// --------------------------------------------- directing the voice

{
  const ssml = require('./lib/ssml.js');
  const { scriptText } = require('./lib/render.js');
  const { deckPage, presenterPage } = require('./lib/pages.js');
  const J = JSON.stringify;

  check('voice directions: every tag read is read as documented, the notes showing the text and the voice the words', () => {
    /* [script, what the notes show, what the voice says] */
    const table = [
      ['No tags at all.', 'No tags at all.', [{ text: 'No tags at all.' }]],
      ['x < 5 & y > 2', 'x < 5 & y > 2', [{ text: 'x < 5 & y > 2' }]],
      ['<speak>Hello.</speak>', 'Hello.', [{ text: 'Hello.' }]],
      ['Hello <break time="1s"/> world', 'Hello world', [{ text: 'Hello' }, { pause: 1 }, { text: 'world' }]],
      ["Hello <break time='500ms' /> world", 'Hello world', [{ text: 'Hello' }, { pause: 0.5 }, { text: 'world' }]],
      ['wait<break/>now', 'wait now', [{ text: 'wait' }, { pause: 0.4 }, { text: 'now' }]],
      ...Object.entries({ none: 0, 'x-weak': 0.1, weak: 0.25, medium: 0.4, strong: 0.75, 'x-strong': 1.2 }).map(([k, v]) =>
        [`a <break strength="${k}"/> b`, 'a b', v ? [{ text: 'a' }, { pause: v }, { text: 'b' }] : [{ text: 'a b' }]]),
      ['Nobody <break time="0s"/> sent it', 'Nobody sent it', [{ text: 'Nobody sent it' }]],
      ['a<break strength="none"/>b', 'a b', [{ text: 'a b' }]],
      ['a <break time="1s"/><break time="0.5s"/> b', 'a b', [{ text: 'a' }, { pause: 1.5 }, { text: 'b' }]],
      ['<break time="2s"/>After a breath.', 'After a breath.', [{ pause: 2 }, { text: 'After a breath.' }]],
      ['<p>One.</p><p>Two.</p>', 'One. Two.', [{ text: 'One.' }, { pause: 0.6 }, { text: 'Two.' }]],
      ['<p>One.</p><break time="1s"/><p>Two.</p>', 'One. Two.', [{ text: 'One.' }, { pause: 1 }, { text: 'Two.' }]],
      ['<p>One.</p><break strength="weak"/><p>Two.</p>', 'One. Two.', [{ text: 'One.' }, { pause: 0.6 }, { text: 'Two.' }]],
      ['<s>Hello</s><s>World!</s>', 'Hello World!', [{ text: 'Hello. World!' }]],
      ['We follow the <sub alias="World Wide Web Consortium">W3C</sub> rules.', 'We follow the W3C rules.',
        [{ text: 'We follow the World Wide Web Consortium rules.' }]],
      ['Ask <say-as interpret-as="character">MCP</say-as> twice.', 'Ask MCP twice.', [{ text: `Ask M${ssml.SPELL}C${ssml.SPELL}P twice.` }]],
      ['<prosody rate="slow">Slowly,</prosody> then not.', 'Slowly, then not.', [{ text: 'Slowly,', rate: 0.9 }, { text: 'then not.' }]],
      ['<prosody rate="80%" volume="-6dB" pitch="+10%">Soft.</prosody>', 'Soft.',
        [{ text: 'Soft.', volume: -6, rate: 0.8, pitch: 12 * Math.log2(1.1) }]],
      ['<prosody volume="silent">Mouthed.</prosody>', 'Mouthed.', [{ text: 'Mouthed.', volume: -Infinity }]],
      ['<prosody rate="medium" volume="default" pitch="medium">Same.</prosody> Same.', 'Same. Same.', [{ text: 'Same. Same.' }]],
      ['<prosody rate="fast">a <prosody pitch="high">b</prosody></prosody>', 'a b', [{ text: 'a', rate: 1.1 }, { text: 'b', rate: 1.1, pitch: 2 }]],
      ['<prosody volume="x-soft">quiet <prosody volume="+3dB">louder</prosody> back</prosody>', 'quiet louder back',
        [{ text: 'quiet', volume: -10 }, { text: 'louder', volume: -7 }, { text: 'back', volume: -10 }]],
      ['<prosody volume="x-soft">a <prosody volume="loud">b</prosody></prosody>', 'a b', [{ text: 'a', volume: -10 }, { text: 'b', volume: 4 }]],
      ['<prosody volume="silent">a <prosody volume="+6dB">b</prosody></prosody>', 'a b', [{ text: 'a b', volume: -Infinity }]],
      ['<prosody pitch="low">a <prosody pitch="+10%">b</prosody></prosody>', 'a b', [{ text: 'a', pitch: -2 }, { text: 'b', pitch: -2 + 12 * Math.log2(1.1) }]],
      ['<prosody rate="x-slow">a <prosody rate="fast">b</prosody></prosody>', 'a b', [{ text: 'a', rate: 0.75 }, { text: 'b', rate: 1.1 }]],
      ['Then <lang xml:lang="it-IT">buongiorno</lang>.', 'Then buongiorno.', [{ text: 'Then' }, { text: 'buongiorno.', language: 'it-IT' }]],
      ['A <say-as interpret-as="expletive">damn</say-as> shame.', 'A damn shame.', [{ text: 'A' }, { tone: 0.3 }, { text: 'shame.' }]],
      ['<prosody volume="silent">Well <say-as interpret-as="expletive">damn</say-as> it</prosody>', 'Well damn it',
        [{ text: 'Well', volume: -Infinity }, { tone: 0.3, volume: -Infinity }, { text: 'it', volume: -Infinity }]],
      ['<prosody rate="x-slow" volume="x-soft">A <say-as interpret-as="expletive">damn</say-as></prosody>', 'A damn',
        [{ text: 'A', volume: -10, rate: 0.75 }, { tone: 0.4, volume: -10 }]],
      /* A tag on a line of its own takes its line with it in the notes. */
      ['<speak>\n<p>Line one\nline two.</p>\n</speak>', 'Line one\nline two.', [{ text: 'Line one\nline two.' }]],
      ['1. alpha\n<break time="1s"/>\n2. beta', '1. alpha\n2. beta', [{ text: '1. alpha' }, { pause: 1 }, { text: '2. beta' }]],
      ['Line a.\n\n<break time="1s"/>\nLine b.', 'Line a.\n\nLine b.', [{ text: 'Line a.' }, { pause: 1 }, { text: 'Line b.' }]],
      ['Line a.<break time="1s"/>\n\nLine b.', 'Line a.\n\nLine b.', [{ text: 'Line a.' }, { pause: 1 }, { text: 'Line b.' }]],
      /* A < that opens no whole tag is text, as it was before tags; an
         entity is how to write one that would be a tag. */
      ['See <https://example.com> for more', 'See <https://example.com> for more', [{ text: 'See <https://example.com> for more' }]],
      ['Mail <paul@pardel.dev>,  then', 'Mail <paul@pardel.dev>,  then', [{ text: 'Mail <paul@pardel.dev>,  then' }]],
      ['if a<b then', 'if a<b then', [{ text: 'if a<b then' }]],
      ['Press &lt;Enter&gt;, Vector&lt;T&gt;', 'Press <Enter>, Vector<T>', [{ text: 'Press <Enter>, Vector<T>' }]],
      ['R&amp;D, &amp;lt;, &nbsp;', 'R&D, &lt;, &nbsp;', [{ text: 'R&D, &lt;, &nbsp;' }]],
      ['&lt;break/&gt; <break time="1s"/> <sub alias="R and D">R&amp;D</sub>', '<break/> R&D', [{ text: '<break/>' }, { pause: 1 }, { text: 'R and D' }]],
    ];
    for (const [src, shown, said] of table) {
      eq(ssml.plain(src), shown, `the notes show ${J(src)} as`);
      eq(J(ssml.speech(src)), J(said), `the voice says ${J(src)} as`);
    }
    const plainNote = 'A script without a tag.\n\n- an item';
    if (ssml.plain(plainNote) !== plainNote) throw new Error('a script with no tag is not returned as it came');
  });

  check('voice directions: everything sipario does not read is refused by name, with what to write instead', () => {
    const refused = [
      ['<emphasis>very</emphasis>', /^<emphasis> is not read: no voice engine sipario drives can stress a word\. Rewrite the line so the word carries itself, or set it apart with <break\/> or <prosody rate="slow">$/],
      ['<emphasis level="strong">very</emphasis>', /^<emphasis> is not read/],
      ['<phoneme alphabet="ipa" ph="x">tomato</phoneme>', /^<phoneme> is not read: spell the word as it sounds instead, <sub alias="tom-AH-toe">tomato<\/sub>$/],
      ['<say-as interpret-as="fraction">3/4</say-as>', /^<say-as interpret-as="fraction"> is not read: write the fraction as it is said, "three quarters"$/],
      ['<say-as interpret-as="unit">5kg</say-as>', /^<say-as interpret-as="unit"> is not read: write the unit as it is said, "five kilograms"$/],
      ['<say-as interpret-as="address">1 Main St</say-as>', /^<say-as interpret-as="address"> is not read: write the address as it is said$/],
      ['<foo>x</foo>', /^<foo> is not a tag sipario reads: it reads speak, break, p, s, sub, say-as, prosody and lang\. A < meant as text is written &lt;$/],
      ['Press <Enter> to go', /^<Enter> is not a tag sipario reads: .* written &lt;$/],
      ['a<p then', /^"<p then" is not a whole tag/],
      ['Say <sub alias="">API</sub> now', /^<sub alias=""> gives the voice nothing to say: the alias is the words said in place of the text$/],
      ['<sub alias=" . ">API</sub>', /^<sub alias=" \. "> gives the voice nothing to say/],
      ['a<p></p>b', /^<p> holds no text$/],
      ['<s></s>x', /^<s> holds no text$/],
      ['<speak> </speak>', /^<speak> holds no text$/],
      ['<prosody rate="slow"></prosody>Nobody sent it.', /^<prosody> holds no text$/],
      ['<lang xml:lang="it-IT"> </lang>ok', /^<lang> holds no text$/],
      ['<p><break time="1s"/></p>', /^<p> holds no text$/],
      ['<prosody volume="x-loud"><prosody volume="+12dB">x</prosody></prosody>', /^<prosody volume="\+12dB"> inside a volume of \+8dB comes to \+20dB, past the -40dB to \+12dB a voice is taken to$/],
      ['<prosody pitch="+100%"><prosody pitch="+10%">x</prosody></prosody>', /^<prosody pitch="\+10%"> inside a raised or lowered pitch comes past the -50% to \+100% a voice is taken to$/],
      ['<b>bold</b>', /^<b> is not a tag sipario reads/],
      ['<break pause="1s"/>', /^<break> has no attribute pause: it takes time or strength$/],
      ['<p class="x">a</p>', /^<p> has no attribute class: it takes none$/],
      ['<break time="1s" time="2s"/>', /^<break> has time twice$/],
      ['<break time="1 second"/>', /^<break time="1 second">: a time is seconds or milliseconds, "1s", "1\.5s" or "500ms"$/],
      ['<break time="11s"/>', /^<break time="11s"> is longer than 10s, the longest break read$/],
      ['<break strength="huge"/>', /^<break strength="huge">: a strength is none, x-weak, weak, medium, strong or x-strong$/],
      ['<prosody>a</prosody>', /^<prosody> changes nothing: give it a rate, a volume or a pitch$/],
      ['<prosody rate="slowly">a</prosody>', /^<prosody rate="slowly">: a rate is x-slow, slow, medium, fast or x-fast, or a percentage of the voice's own from 50% to 200%$/],
      ['<prosody rate="300%">a</prosody>', /^<prosody rate="300%">: a rate is/],
      ['<prosody volume="6dB">a</prosody>', /^<prosody volume="6dB">: a volume is default, silent, x-soft, soft, medium, loud or x-loud, or a change in decibels from -40dB to \+12dB, written with its sign, "\+3dB" or "-6dB"$/],
      ['<prosody volume="+20dB">a</prosody>', /^<prosody volume="\+20dB">: a volume is/],
      ['<prosody pitch="10%">a</prosody>', /^<prosody pitch="10%">: a pitch is default, x-low, low, medium, high or x-high, or a change from -50% to \+100%, written with its sign, "\+10%" or "-5%"$/],
      ['<lang xml:lang="Italian">ciao</lang>', /^<lang xml:lang="Italian">: a language is a language tag, "it-IT", "fr" or "en-GB"$/],
      ['<lang>ciao</lang>', /^<lang> needs xml:lang="\.\.\.": the language, "it-IT"$/],
      ['<sub>W3C</sub>', /^<sub> needs alias="\.\.\.": what to say in place of its text$/],
      ['<say-as>3</say-as>', /^<say-as> needs interpret-as="\.\.\.": how to read its text: character, cardinal/],
      ['<say-as interpret-as="spell-out">ab</say-as>', /^<say-as interpret-as="spell-out">: sipario reads character, cardinal, ordinal, digits, telephone, date, time or expletive$/],
      ['<say-as interpret-as="date">3/10/2026</say-as>', /^<say-as interpret-as="date"> needs a format, which says the order of its parts: mdy, dmy/],
      ['<say-as interpret-as="date" format="dd">3</say-as>', /^<say-as interpret-as="date" format="dd">: a format is mdy, dmy/],
      ['<say-as interpret-as="cardinal" format="dmy">3</say-as>', /^<say-as interpret-as="cardinal" format="dmy">: format is for a date, and only a date$/],
      ['<break time=1s/>', /^"<break time=1s\/>" is not a whole tag: a tag is <name attribute="value">, and one that holds nothing ends \/>$/],
      ['<break time="1s"', /^"<break time=\\"1s\\"" is not a whole tag/],
      ['<!-- a comment -->', /^"<!-- a comment -->": comments and declarations are not read in a script; take it out$/],
      ['<?xml version="1.0"?><speak>a</speak>', /comments and declarations are not read/],
      ['<prosody rate="slow">open', /^<prosody> is opened and never closed$/],
      ['closed</p>', /^<\/p> closes nothing: no <p> is open$/],
      ['<p><s>a</p></s>', /^<\/p> comes while <s> is still open: close <s> first$/],
      ['a <break time="1s">', /^<break> holds nothing: write <break \.\.\.\/>$/],
      ['a </break>', /^<\/break>: <break> holds nothing and has no closing tag; write <break \.\.\.\/>$/],
      ['<p/>', /^<p\/> holds nothing: <p> wraps text, <p>\.\.\.<\/p>$/],
      ['<p><p>a</p></p>', /^<p> inside <p>: paragraphs do not nest$/],
      ['<s><p>a</p></s>', /^<p> inside <s>: a sentence cannot hold a paragraph; close the <s> first$/],
      ['<s><s>a</s></s>', /^<s> inside <s>: sentences do not nest$/],
      ['<prosody rate="slow"><speak>a</speak></prosody>', /^<speak> wraps the whole script or nothing, and cannot sit inside <prosody>$/],
      ['<sub alias="x"><break/>y</sub>', /^<sub> holds text only, and <break> is inside it$/],
      ['<say-as interpret-as="digits"><prosody rate="slow">1</prosody></say-as>', /^<say-as> holds text only, and <prosody> is inside it$/],
      ['<sub alias="x"> </sub>', /^<sub> holds no text$/],
      ['<say-as interpret-as="cardinal">lots</say-as>', /^<say-as interpret-as="cardinal"> reads a number, "42", "-3", "1,500" or "3\.14", and "lots" is not one$/],
      ['<say-as interpret-as="cardinal">1000000000000000</say-as>', /^1000000000000000 is too large to read: up to 999 trillion is read$/],
      ['<say-as interpret-as="ordinal">-3</say-as>', /^<say-as interpret-as="ordinal"> reads a whole number, "3" or "3rd", and "-3" is not one$/],
      ['<say-as interpret-as="digits">12a</say-as>', /^<say-as interpret-as="digits"> reads digits, and "12a" has more than digits$/],
      ['<say-as interpret-as="character">a+b</say-as>', /^<say-as interpret-as="character"> spells letters and digits, and "a\+b" has "\+"$/],
      ['<say-as interpret-as="telephone">call me</say-as>', /^<say-as interpret-as="telephone"> reads digits, spaces, \( \) - \. and a leading \+, and "call me" has more$/],
      ['<say-as interpret-as="date" format="dmy">3 Oct 2026</say-as>', /^<say-as interpret-as="date" format="dmy"> reads 3 numbers in the order dmy, "3\/10\/2026", and "3 Oct 2026" is not that$/],
      ['<say-as interpret-as="date" format="dmy">31/9/2026</say-as>', /^<say-as interpret-as="date" format="dmy">: "31\/9\/2026" has no day 31$/],
      ['<say-as interpret-as="date" format="dmy">29/2/2025</say-as>', /has no day 29$/],
      ['<say-as interpret-as="date" format="mdy">13/1/2026</say-as>', /^<say-as interpret-as="date" format="mdy">: 13 is not a month$/],
      ['<say-as interpret-as="date" format="yyyymmdd">2026-10-03</say-as>', /^<say-as interpret-as="date" format="yyyymmdd"> reads eight digits, "20261003", and "2026-10-03" is not$/],
      ['<say-as interpret-as="time">half past</say-as>', /^<say-as interpret-as="time"> reads a length of time, 1'30", 1:30 or 1:02:30, and "half past" is not one$/],
      ['<say-as interpret-as="time">1:75</say-as>', /^<say-as interpret-as="time">: "1:75" has more than 59 in a place that counts to 59$/],
      ['<say-as interpret-as="time">1:75:00</say-as>', /has more than 59 in a place that counts to 59$/],
    ];
    for (const [src, re] of refused) {
      const why = ssml.problem(src);
      if (!why || !re.test(why)) throw new Error(`${J(src)}: ${why ? `said ${J(why)}` : 'was not refused'}`);
      let err = null;
      try { ssml.speech(src); } catch (e) { err = e; }
      if (!(err instanceof ssml.SsmlError)) throw new Error(`${J(src)}: the voice read it`);
    }
    eq(ssml.problem('No tags.'), null, 'a script with no tag has no problem');
  });

  check('voice directions: a direction the voice cannot follow stops the render, every one named by its slide and step', () => {
    let err = null;
    try {
      R(`# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
Fine <break time="1s"/> here.
\`\`\`
--

Another.

\`\`\`notes
Say it <emphasis>loudly</emphasis>.
\`\`\`

## 1.2
id: 1-b
template: statement


A third.

\`\`\`notes
Like <phoneme ph="x">this</phoneme>.
\`\`\`
`);
    } catch (e) { err = e; }
    if (!err) throw new Error('it rendered');
    const lines = err.message.split('\n');
    eq(lines[0], 'deck.md has directions the voice cannot follow:', 'the heading');
    if (!/^ {2}1-a step 2: <emphasis> is not read: no voice engine sipario drives can stress a word/.test(lines[1])) throw new Error(`the first: ${lines[1]}`);
    if (!/^ {2}1-b: <phoneme> is not read: spell the word as it sounds instead/.test(lines[2])) throw new Error(`the second: ${lines[2]}`);
    eq(lines.length, 3, 'and the step that is fine is not named');
  });

  check('voice directions: say-as reads numbers, digits, characters, telephones, dates and times into English words', () => {
    const said = (content, as, format) => ssml.sayAs(content, as, format).words;
    const table = [
      ['0', 'cardinal', 'zero'], ['7', 'cardinal', 'seven'], ['13', 'cardinal', 'thirteen'], ['21', 'cardinal', 'twenty-one'],
      ['100', 'cardinal', 'one hundred'], ['105', 'cardinal', 'one hundred and five'], ['1005', 'cardinal', 'one thousand and five'],
      ['2026', 'cardinal', 'two thousand and twenty-six'], ['1,500', 'cardinal', 'one thousand five hundred'],
      ['123456', 'cardinal', 'one hundred and twenty-three thousand four hundred and fifty-six'],
      ['1000005', 'cardinal', 'one million and five'], ['3000000000', 'cardinal', 'three billion'],
      ['-3', 'cardinal', 'minus three'], ['-3.14', 'cardinal', 'minus three point one four'], ['0.05', 'cardinal', 'zero point zero five'],
      ['007', 'cardinal', 'seven'], ['+4', 'cardinal', 'four'],
      ['1', 'ordinal', 'first'], ['2nd', 'ordinal', 'second'], ['3', 'ordinal', 'third'], ['5', 'ordinal', 'fifth'],
      ['8', 'ordinal', 'eighth'], ['9', 'ordinal', 'ninth'], ['12', 'ordinal', 'twelfth'], ['20', 'ordinal', 'twentieth'],
      ['21st', 'ordinal', 'twenty-first'], ['100', 'ordinal', 'one hundredth'], ['1003', 'ordinal', 'one thousand and third'],
      ['4071', 'digits', 'four zero seven one'], ['12 34', 'digits', 'one two three four'],
      ['MCP', 'character', ['M', 'C', 'P'].join(ssml.SPELL)], ['w3c', 'character', ['W', 'three', 'C'].join(ssml.SPELL)],
      ['R2-D2', 'character', ['R', 'two', 'D', 'two'].join(ssml.SPELL)],
      ['020 7946 0958', 'telephone', 'oh two oh, seven nine four six, oh nine five eight'],
      ['+44 (0)20 7946-0958', 'telephone', 'plus four four, oh, two oh, seven nine four six, oh nine five eight'],
      ['1234567', 'telephone', 'one two three, four five six seven'],
      ['1234567890', 'telephone', 'one two three, four five six, seven eight nine oh'],
      ['3/10/2026', 'date', 'the third of October, twenty twenty-six', 'dmy'],
      ['10/3/2026', 'date', 'the third of October, twenty twenty-six', 'mdy'],
      ['2026-10-03', 'date', 'the third of October, twenty twenty-six', 'ymd'],
      ['20261003', 'date', 'the third of October, twenty twenty-six', 'yyyymmdd'],
      ['10/3', 'date', 'the third of October', 'md'], ['22.12', 'date', 'the twenty-second of December', 'dm'],
      ['2026/10', 'date', 'October twenty twenty-six', 'ym'], ['10 2026', 'date', 'October twenty twenty-six', 'my'],
      ['31', 'date', 'the thirty-first', 'd'], ['5', 'date', 'May', 'm'], ['29/2', 'date', 'the twenty-ninth of February', 'dm'],
      ['29/2/2024', 'date', 'the twenty-ninth of February, twenty twenty-four', 'dmy'],
      ['2000', 'date', 'two thousand', 'y'], ['2005', 'date', 'two thousand and five', 'y'], ['1999', 'date', 'nineteen ninety-nine', 'y'],
      ['1900', 'date', 'nineteen hundred', 'y'], ['1905', 'date', 'nineteen oh five', 'y'], ['1066', 'date', 'ten sixty-six', 'y'],
      ['2010', 'date', 'twenty ten', 'y'], ['999', 'date', 'nine hundred and ninety-nine', 'y'],
      ["1'30\"", 'time', 'one minute thirty seconds'], ['1:30', 'time', 'one minute thirty seconds'],
      ['1:02:03', 'time', 'one hour two minutes three seconds'], ['2:00', 'time', 'two minutes'], ['0:01', 'time', 'one second'],
      ["5'", 'time', 'five minutes'], ['45"', 'time', 'forty-five seconds'], ['1’30”', 'time', 'one minute thirty seconds'],
      ['0:00', 'time', 'zero seconds'], ['90:00', 'time', 'ninety minutes'],
    ];
    for (const [content, as, words, format] of table) eq(said(content, as, format), words, `${as}${format ? ` ${format}` : ''} ${J(content)}`);
    eq(J(ssml.sayAs('damn', 'expletive')), J({ tone: 0.3 }), 'a short expletive bleeps for 0.3s');
    eq(J(ssml.sayAs('confounded', 'expletive')), J({ tone: 0.75 }), 'a longer one about as long as the word');
  });

  /* One deck, every surface: the notes window and the deck page carry
     the deck's own markup, the print page the same, the PowerPoint export
     and notesText the text. None of them may show a tag, an alias, or the
     words a say-as is read as. */
  const directed = `# One

## 1.1
id: 1-a
template: statement


A line.

\`\`\`notes
<speak>Start <break time="1s"/> here, with the <sub alias="World Wide Web Consortium">W3C</sub>.

<p><prosody rate="slow" volume="soft">Slowly</prosody> on <say-as interpret-as="date" format="dmy">3/10/2026</say-as>, <lang xml:lang="it-IT">grazie</lang>.</p>

- An item <break strength="strong"/> with a pause
- And <say-as interpret-as="cardinal">42</say-as></speak>
\`\`\`
`;
  const clean = (where, s) => {
    for (const bad of ['<speak', '<break', '<sub', '<prosody', '<say-as', '<lang', 'alias', 'World Wide Web',
                       'third of October', 'forty-two', '&lt;', 'xml:lang', 'interpret-as']) {
      if (s.includes(bad)) throw new Error(`${where} shows ${J(bad)}: ${J(s.slice(Math.max(0, s.indexOf(bad) - 60), s.indexOf(bad) + 60))}`);
    }
  };

  check('voice directions: no surface shows a tag or an alias, the presenter, deck and print pages, the PowerPoint notes and notesText', () => {
    const r = R(directed);
    const aside = r.html.match(/<aside class="notes">([\s\S]*?)<\/aside>/)[1];
    clean('the notes markup', aside);
    for (const want of ['<p>Start here, with the W3C.</p>', '<p>Slowly on 3/10/2026, grazie.</p>',
                        '<li>An item with a pause</li>', '<li>And 42</li>']) {
      if (!aside.includes(want)) throw new Error(`the notes markup lacks ${J(want)}: ${aside}`);
    }
    const pageAside = (page) => page.match(/<aside class="notes">([\s\S]*?)<\/aside>/)[1];
    clean('the deck page', pageAside(deckPage(r)));
    clean('the presenter page', pageAside(presenterPage(r, 0, 1)));
    clean('the print page', pageAside(require('./lib/pages.js').printPage(r)));
    /* A < that opens no tag is text, and shows as text. */
    const lt = R(directed.replace(/```notes\n[\s\S]*?\n```/, '```notes\nx < 5 & y > 2\n```'));
    if (!lt.html.includes('<p>x &lt; 5 &amp; y &gt; 2</p>')) throw new Error('a < that opens no tag did not show as text');
    const text = require('./lib/render.js').notesText(parse(D + directed)[0].steps[0].note);
    eq(text, 'Start here, with the W3C.\n\nSlowly on 3/10/2026, grazie.\n\n• An item with a pause\n• And 42', 'notesText');
    const tt = { ...TALK };
    const step = require('./lib/export.js').outline(D + directed, tt)[0];
    eq(step.notes, text, 'what the export carries is notesText');
    const parts = unzip(require('./lib/pptx.js').pptx({ title: 'T', width: 1280, height: 720,
      slides: [{ png: PIXEL, notes: step.notes, name: '1.1' }] }));
    const xml = parts.get('ppt/notesSlides/notesSlide1.xml').toString('utf8');
    const said = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('\n');
    clean('the PowerPoint notes', said);
    eq(said, 'Start here, with the W3C.\nSlowly on 3/10/2026, grazie.\n• An item with a pause\n• And 42', 'the PowerPoint notes, a paragraph a line');
  });

  check('voice directions: a tag on a line of its own, or around a list, leaves the list and the paragraph whole, in the notes and in what the voice is sent', () => {
    const { notesText: nt } = require('./lib/render.js');
    const cases = [
      /* [script, the notes as text, what the voice says] */
      ['<prosody rate="slow">\n- one\n- two\n</prosody>', '• one\n• two', [{ text: '• one\n• two', rate: 0.9 }]],
      ['<speak>\n1. one\n2. two\n</speak>', '1. one\n2. two', [{ text: '1. one\n2. two' }]],
      ['<p>- one\n- two</p>', '• one\n• two', [{ text: '• one\n• two' }]],
      ['1. alpha\n<break time="1s"/>\n2. beta\n3. gamma', '1. alpha\n2. beta\n3. gamma',
        [{ text: '1. alpha' }, { pause: 1 }, { text: '2. beta\n3. gamma' }]],
      ['1. one\n<prosody rate="slow">\n2. two\n3. three\n</prosody>\n4. four', '1. one\n2. two\n3. three\n4. four',
        [{ text: '1. one' }, { text: '2. two\n3. three', rate: 0.9 }, { text: '4. four' }]],
      ['It\'s 2am.\n<break time="1s"/>\nNobody sent it.', 'It\'s 2am. Nobody sent it.',
        [{ text: 'It\'s 2am.' }, { pause: 1 }, { text: 'Nobody sent it.' }]],
    ];
    for (const [note, text, said] of cases) {
      eq(nt(note), text, `the notes of ${J(note)}`);
      eq(J(ssml.speech(scriptText(note))), J(said), `the voice for ${J(note)}`);
    }
    const r = R(directed.replace(/```notes\n[\s\S]*?\n```/, '```notes\n1. alpha\n<break time="1s"/>\n2. beta\n3. gamma\n\nLine a.\n<break time="1s"/>\nLine b.\n```'));
    const aside = r.html.match(/<aside class="notes">([\s\S]*?)<\/aside>/)[1];
    eq((aside.match(/<ol>/g) || []).length, 1, 'one list on stage');
    if (!aside.includes('<ol><li>alpha</li><li>beta</li><li>gamma</li></ol>')) throw new Error(`the list on stage: ${aside}`);
    if (!aside.includes('<p>Line a. Line b.</p>')) throw new Error(`the paragraph on stage: ${aside}`);
  });

  check('voice directions: a template printing {{note}} shows the script as the notes do, without a tag', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-spoken-'));
    try {
      fs.writeFileSync(path.join(dir, 'spoken.html'), '<p class="spoken">{{note}}</p>\n');
      const r = render(`${D}# One\n\n## 1.1\nid: 1-a\ntemplate: spoken\n\n\nA line.\n\n\`\`\`notes\nOur <sub alias="A P I">API</sub> is <break time="1s"/> fast.\n\`\`\`\n`,
        { templateRoot: dir, imageRoot: TALK.imageRoot });
      const said = r.html.match(/<p class="spoken">([^<]*)<\/p>/);
      if (!said) throw new Error(`the template's note is not on the slide: ${r.html.slice(0, 400)}`);
      eq(said[1], 'Our API is fast.', 'the slide shows');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  check('voice directions: the voice reads the script with its directions, and a script without any exactly as before', () => {
    const steps = require('./lib/export.js').outline(D + directed, TALK);
    if (!/<sub alias="World Wide Web Consortium">W3C<\/sub>/.test(steps[0].script)) throw new Error(`the script lost its tags: ${steps[0].script}`);
    eq(J(ssml.speech(steps[0].script)), J([
      { text: 'Start' }, { pause: 1 }, { text: 'here, with the World Wide Web Consortium.' }, { pause: 0.6 },
      { text: 'Slowly', volume: -5, rate: 0.9 }, { text: 'on the third of October, twenty twenty-six,' },
      { text: 'grazie.', language: 'it-IT' }, { pause: 0.6 },
      { text: '• An item' }, { pause: 0.75 }, { text: 'with a pause\n• And forty-two' },
    ]), 'what the voice says');
    /* The example's own scripts carry no directions: what the voice reads
       is what the notes say, word for word, as it was before. */
    for (const sl of parse(deckSrc)) for (const st of sl.steps) {
      eq(scriptText(st.note), require('./lib/render.js').notesText(st.note), 'a plain script reads as its notes');
    }
  });
}

// ------------------------------------------------------------- the video

/* How long a video's picture runs, by decoding it to the end with no
   sound: lib/video.js's durationOf decodes the sound alone, and a picture
   that outruns its voice would pass for the voice's length. */
function pictureLength(file, ff) {
  const r = require('child_process').spawnSync(ff, ['-hide_banner', '-nostdin', '-i', file, '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const times = [...String(r.stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (r.status !== 0 || !times.length) throw new Error(`ffmpeg could not decode the picture of ${file}: ${r.stderr}`);
  const [, h, m, s] = times[times.length - 1];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

{
  const video = require('./lib/video.js');
  const { spawnSync } = require('child_process');

  check('video: the timeline opens on the first step shown and is clamped to the audio', () => {
    /* Said before the first press is said over the first slide; a press
       after the recording stopped holds nothing. Either way the stills
       add up to the audio, which is what keeps the voice on its slides. */
    const s = video.spans([{ id: 'b', t: 2 }, { id: 'a', t: 0.5 }, { id: 'c', t: 9 }], 6);
    eq(s.map((x) => x.id).join(' '), 'a b c', 'in time order');
    eq(s[0].start, 0, 'the first step starts at the top of the audio');
    eq(s[0].dur, 2, 'and runs to the next press');
    eq(s[1].dur, 4, 'the step before a late press runs to the end of the audio');
    eq(s[2].dur, 0, 'the late press holds nothing');
    eq(s.reduce((a, x) => a + x.dur, 0), 6, 'the whole adds up to the audio');
  });

  check('video: every flash keeps a frame, and the stills still end where the audio does', () => {
    /* A double press through a build shows a step for 10ms: under a frame,
       so a frame rate would drop it silently. Kept means seen, so it gets
       one, borrowed from the span after it. A span of no length showed
       nothing and goes. */
    const segs = video.segments([
      { id: 'a', dur: 1 }, { id: 'flash', dur: 0.01 }, { id: 'gone', dur: 0 }, { id: 'b', dur: 2.99 },
    ]);
    eq(segs.map((s) => s.id).join(' '), 'a flash b', 'the flash is kept, the empty span is not');
    eq(segs[1].dur, 1 / video.FPS, 'the flash holds one frame');
    for (const s of segs) eq(Math.abs(s.dur * video.FPS - Math.round(s.dur * video.FPS)) < 1e-9, true, `${s.id} is whole frames`);
    eq(Math.round(segs.reduce((a, s) => a + s.dur, 0) * 1000), 4000, 'the whole is still the audio');
    const tail = video.segments([{ id: 'a', dur: 1 }, { id: 'x', dur: 0.005 }, { id: 'y', dur: 0.005 }]);
    eq(tail.every((s) => s.dur > 0), true, 'flashes at the very end each keep a frame');
  });

  check('video: the stills list names the last still twice and keeps a quote a quote', () => {
    const list = video.concatList([{ id: 'one', dur: 1.5 }, { id: "it's", dur: 2 }], (id) => `${id}.png`);
    const lines = list.trim().split('\n');
    eq(lines[0], 'ffconcat version 1.0', 'the header');
    eq(lines[1], "file 'one.png'", 'a still');
    eq(lines[2], 'duration 1.500', 'its length');
    eq(lines[3], "file 'it'\\''s.png'", 'a quote in a name stays inside it');
    eq(lines[lines.length - 1], lines[3], 'the last still is named again');
  });

  check('video: no ffmpeg is an error that says how to point at one', () => {
    let err = null;
    try { video.findFfmpeg({ SIPARIO_FFMPEG: '/nowhere/ffmpeg' }); } catch (e) { err = e; }
    if (!err || !/SIPARIO_FFMPEG is \/nowhere\/ffmpeg/.test(err.message)) throw new Error('a missing named binary was not refused by name');
    err = null;
    try { video.findFfmpeg({ PATH: '' }); } catch (e) { err = e; }
    if (!err || !/SIPARIO_FFMPEG/.test(err.message)) throw new Error('an empty PATH did not say how to name one');
  });

  check('video: a take is read from the data folder, and its audio must sit beside it', () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-takes-'));
    let err = null;
    try { video.readTake('sipario:t', null, root); } catch (e) { err = e; }
    if (!err || !/no takes/.test(err.message)) throw new Error('no takes was not said');
    const at = (id, take) => {
      fs.mkdirSync(path.join(root, 'takes', 't', id), { recursive: true });
      fs.writeFileSync(path.join(root, 'takes', 't', id, 'take.json'), JSON.stringify(take));
    };
    at('2026-01-01T10-00-00', { audio: 'a.webm', marks: [{ id: 'x', t: 0 }] });
    at('2026-01-02T10-00-00', { audio: '../../escape.webm', marks: [{ id: 'x', t: 0 }] });
    eq(video.listTakes('sipario:t', root).join(' '), '2026-01-01T10-00-00 2026-01-02T10-00-00', 'oldest first');
    eq(video.readTake('sipario:t', '2026-01-01T10-00-00', root).audioFile,
      path.join(root, 'takes', 't', '2026-01-01T10-00-00', 'a.webm'), 'the audio resolved beside the take');
    err = null;
    try { video.readTake('sipario:t', null, root); } catch (e) { err = e; }
    if (!err || !/not a file beside it/.test(err.message)) throw new Error('an audio path out of the take was not refused');
    fs.rmSync(root, { recursive: true, force: true });
  });

  check('video: a newer take a recording left unfinished is named, not passed over in silence', () => {
    /* Never the one exported, but most likely the one the speaker has
       just made: the window closed by the deck mid-take, say. */
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-takes-'));
    const put = (id, file) => {
      fs.mkdirSync(path.join(root, 'takes', 't', id), { recursive: true });
      fs.writeFileSync(path.join(root, 'takes', 't', id, file), JSON.stringify({ audio: 'a.webm', marks: [{ id: 'x', t: 0 }] }));
    };
    put('20261002-100000-aaaa', 'marks.partial.json');
    let err = null;
    try { video.readTake('sipario:t', null, root); } catch (e) { err = e; }
    if (!err || !/Take 20261002-100000-aaaa was left unfinished: sipario takes recover 20261002-100000-aaaa finishes it/.test(err.message)) {
      throw new Error(`with only an unfinished take, it said ${err && err.message}`);
    }
    put('20261001-100000-aaaa', 'take.json');
    put('20261003-100000-aaaa', 'marks.partial.json');
    const r = video.readTake('sipario:t', null, root);
    eq(r.take, '20261001-100000-aaaa', 'the latest finished take is the one read');
    eq(r.unfinished.join(' '), '20261002-100000-aaaa 20261003-100000-aaaa', 'and the newer ones left unfinished are named');
    eq(video.readTake('sipario:t', '20261001-100000-aaaa', root).unfinished.length, 0, 'a take named is the one asked for, and nothing is said');
    fs.rmSync(root, { recursive: true, force: true });
  });

  let browser = null;
  let ff = null;
  try { browser = findBrowser(); } catch { /* none here */ }
  try { ff = video.findFfmpeg(); } catch { /* none here */ }
  const whenBoth = (name, fn) => {
    if (browser && ff) return check(name, fn);
    return console.log(`  --    ${name}\n        not run: ${browser ? 'no ffmpeg' : 'no browser'} on this machine`);
  };

  whenBoth('video: a take becomes an mp4 as long as its audio, picture and sound, and a step the deck lost is refused by name', () => {
    /* A talk, a take of three of its steps over 26 seconds of tone, the
       CLI run as a reader would. Then a step id the deck does not have.
       The last step follows a long one and runs long itself, the shape
       that once left the last slide up for a second and a half after the
       sound had stopped. */
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-video-'));
    const t = path.join(dir, 'talk');
    scaffold(t);
    const data = path.join(dir, 'data');
    const tt = talk(t);
    const src = fs.readFileSync(tt.deck, 'utf8');
    const ids = require('./lib/export.js').outline(src, tt).map((s) => s.id);
    const take = path.join(video.takesDir(require('./lib/render.js').identity(src).key, data), '2026-10-03T10-00-00');
    fs.mkdirSync(take, { recursive: true });
    eq(spawnSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=26', '-c:a', 'aac',
      path.join(take, 'audio.m4a')]).status, 0, 'the tone was made');
    const write = (marks) => fs.writeFileSync(path.join(take, 'take.json'), JSON.stringify({ audio: 'audio.m4a', marks }));
    write([{ id: ids[0], t: 0.2 }, { id: ids[1], t: 1.5 }, { id: ids[2], t: 13 }]);
    const env = { ...process.env, SIPARIO_DATA: data };
    const run = () => spawnSync(process.execPath, [path.join(ROOT, 'bin/sipario.js'), 'export', 'video', t],
      { cwd: dir, env, encoding: 'utf8', timeout: 120000 });

    const ok = run();
    eq(ok.status, 0, `it exported (${ok.stderr.trim()})`);
    const mp4 = path.join(dir, `${path.basename(path.dirname(take))}-2026-10-03T10-00-00.mp4`);
    if (!fs.existsSync(mp4)) throw new Error(`no video at ${mp4}: ${ok.stdout}`);
    const len = video.durationOf(mp4, ff);
    if (Math.abs(len - 26) > 0.15) throw new Error(`the video's sound runs ${len}s against 26s of audio`);
    const seen = pictureLength(mp4, ff);
    if (Math.abs(seen - len) > 0.05) throw new Error(`the picture runs ${seen}s against ${len}s of sound`);
    if (!/3 stills of 3 steps/.test(ok.stdout)) throw new Error(`it did not report its stills: ${ok.stdout}`);
    if (!/from take 2026-10-03T10-00-00 \(live\)/.test(ok.stdout)) throw new Error(`it did not say what kind of take: ${ok.stdout}`);

    const left = path.join(path.dirname(take), '2026-10-04T10-00-00');
    fs.mkdirSync(left);
    fs.writeFileSync(path.join(left, 'marks.partial.json'), JSON.stringify({ audio: 'take.webm', marks: [{ id: ids[0], t: 0 }] }));
    const passed = run();
    eq(passed.status, 0, `it exported past an unfinished take (${passed.stderr.trim()})`);
    if (!/from take 2026-10-03T10-00-00/.test(passed.stdout)) throw new Error(`it exported something else: ${passed.stdout}`);
    if (!/take 2026-10-04T10-00-00 is newer, and was left unfinished.*sipario takes recover 2026-10-04T10-00-00/.test(passed.stderr)) {
      throw new Error(`it did not name the newer unfinished take: ${passed.stderr.trim()}`);
    }

    write([{ id: ids[0], t: 0 }, { id: 'no-such-step', t: 1 }]);
    const bad = run();
    eq(bad.status, 1, 'a lost step was refused');
    if (!/no-such-step/.test(bad.stderr)) throw new Error(`it did not name the step: ${bad.stderr.trim()}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// ------------------------------------------------------------- the voice

{
  const os = require('os');
  const { spawnSync } = require('child_process');
  const video = require('./lib/video.js');
  const { readWav, wavHeader } = require('./lib/wav.js');
  const tts = require('./lib/tts.js');

  /* A voice engine for the suite, run as SIPARIO_TTS would be: an
     executable of its own, speaking the protocol, with a sine for a voice
     whose length follows the script's, at 24 kHz for the first request
     and every other one after, 16 kHz between, so the take is assembled
     from clips that need converting and clips that do not. Seven frames
     over twenty milliseconds a character, so no clip is a whole number of
     ten milliseconds, as a real engine's seldom is: a step's place
     rounded to the hundredth, as ffmpeg times a file, would show.

     Told by its environment to misbehave, after FAKE_TTS_AFTER good
     answers: `hang` before it is ready, `junk` on stdout, `die` part way
     through writing a clip, `error` for an answer, `stall` without one,
     `late` with one that comes after the request's time, `cut` and
     `empty` saying ok over a clip cut short and one with no audio in it.
     FAKE_TTS_LINGER is how long it stays once its stdin closes, in
     milliseconds or `forever`. FAKE_TTS_VERSION is said in its ready
     line, as a real engine says its release. FAKE_TTS_LOG collects every
     request it is sent, and FAKE_TTS_PID its own process id, which is the
     engine's even when a script runs it. */
  function fakeTts() {
    const fs = require('fs');
    const mode = process.env.FAKE_TTS || '';
    const after = Number(process.env.FAKE_TTS_AFTER || 0);
    const heard = process.env.FAKE_TTS_LOG;
    const wav = (text, rate, frames = Math.round(rate * 0.02 * text.length) + 7) => {
      const b = Buffer.alloc(44 + frames * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVEfmt ', 8);
      b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
      b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
      b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
      for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
      return b;
    };
    if (process.env.FAKE_TTS_PID) fs.appendFileSync(process.env.FAKE_TTS_PID, `${process.pid}\n`);
    process.stderr.write('fake: loading the model\n');
    if (mode === 'hang') return setInterval(() => {}, 1000);
    const version = process.env.FAKE_TTS_VERSION;
    process.stdout.write(JSON.stringify({ ready: true, engine: 'fake', sr: 24000, ...(version ? { version } : {}) }) + '\n');
    let n = 0;
    let buf = '';
    const reply = (o) => process.stdout.write(JSON.stringify(o) + '\n');
    const answer = (req) => {
      if (heard) fs.appendFileSync(heard, JSON.stringify(req) + '\n');
      const now = n >= after;
      if (now && mode === 'junk') return process.stdout.write('generating ' + req.id + '...\n');
      if (now && mode === 'stall') return null;
      if (now && mode === 'error') return reply({ id: req.id, ok: false, error: 'no voice for that' });
      if (now && (mode === 'cut' || mode === 'empty')) {
        fs.writeFileSync(req.out, mode === 'cut' ? wav(req.text, 24000).subarray(0, 100) : wav('', 24000, 0));
        return reply({ id: req.id, ok: true, out: req.out });
      }
      if (now && mode === 'late') {
        return setTimeout(() => { fs.writeFileSync(req.out, wav(req.text, 24000)); reply({ id: req.id, ok: true, out: req.out }); }, 800);
      }
      if (now && mode === 'die') {
        fs.writeFileSync(req.out, wav(req.text, 24000).subarray(0, 100));
        process.stderr.write('fake: out of memory\n');
        return process.exit(3);
      }
      fs.writeFileSync(req.out, wav(req.text, n % 2 ? 16000 : 24000));
      n += 1;
      return reply({ id: req.id, ok: true, out: req.out });
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) answer(JSON.parse(line));
      }
    });
    const linger = process.env.FAKE_TTS_LINGER;
    process.stdin.on('end', () => (linger === 'forever' ? setInterval(() => {}, 1000)
      : setTimeout(() => process.exit(0), Number(linger || 0))));
    return null;
  }
  const fakeAt = (dir) => {
    const bin = path.join(dir, 'fake-tts');
    fs.writeFileSync(bin, `#!${process.execPath}\n'use strict';\n(${fakeTts.toString()})();\n`);
    fs.chmodSync(bin, 0o755);
    return bin;
  };

  check('voice: a WAV is read by its chunks, 16-bit and float alike, and anything else is refused by name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-wav-'));
    try {
      /* 16-bit PCM with a LIST chunk of odd length before the data, which
         is padded to even: read at fixed offsets, the data would be off. */
      const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([5, 0, 0, 0]), Buffer.from('INFOx'), Buffer.from([0])]);
      const pcm = wavHeader({ rate: 22050, channels: 2, frames: 3 });
      const body = Buffer.alloc(12);
      const a = path.join(dir, 'a.wav');
      fs.writeFileSync(a, Buffer.concat([pcm.subarray(0, 36), list, pcm.subarray(36), body]));
      const ra = readWav(a);
      eq(`${ra.format} ${ra.rate} ${ra.channels} ${ra.bits} ${ra.frames}`, 'pcm 22050 2 16 3', 'the 16-bit header');
      eq(ra.dataOffset, 36 + list.length + 8, 'the data found past the padded chunk');
      eq(ra.seconds, 3 / 22050, 'its length, exactly');
      /* IEEE float, as extensible with a fact chunk, mono at 24 kHz. */
      const fmt = Buffer.alloc(40);
      fmt.writeUInt16LE(0xfffe, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(24000, 4); fmt.writeUInt32LE(96000, 8);
      fmt.writeUInt16LE(4, 12); fmt.writeUInt16LE(32, 14); fmt.writeUInt16LE(22, 16); fmt.writeUInt16LE(3, 24);
      const chunk = (id, b) => { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b]); };
      const fact = Buffer.alloc(4); fact.writeUInt32LE(5, 0);
      const inner = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('fact', fact), chunk('data', Buffer.alloc(20))]);
      const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(inner.length, 4);
      const b = path.join(dir, 'b.wav');
      fs.writeFileSync(b, Buffer.concat([riff, inner]));
      const rb = readWav(b);
      eq(`${rb.format} ${rb.rate} ${rb.channels} ${rb.bits} ${rb.frames}`, 'float 24000 1 32 5', 'the float header');
      const refused = (file, re, what) => {
        let err = null;
        try { readWav(file); } catch (e) { err = e; }
        if (!err || !re.test(err.message)) throw new Error(`${what}: ${err ? err.message : 'read as a WAV'}`);
      };
      const txt = path.join(dir, 'notes.wav');
      fs.writeFileSync(txt, 'This is a script, not a sound.');
      refused(txt, /notes\.wav is not a WAV file: it begins "This"/, 'a text file was not refused by name');
      /* What an engine killed mid-write leaves: a header that promises
         more than arrived, or a data chunk stopped mid-frame. */
      const cut = path.join(dir, 'cut.wav');
      fs.writeFileSync(cut, Buffer.concat([wavHeader({ rate: 24000, frames: 100 }), Buffer.alloc(50)]));
      refused(cut, /cut short: its data chunk promises 200 bytes and the file holds 50/, 'a cut-short clip passed');
      /* What a writer whose output was a pipe leaves: a size it never came
         back to fill in. Named as that, not as a crash. */
      for (const [mark, said] of [[0xffffffff, '0xFFFFFFFF'], [0, '0']]) {
        const piped = path.join(dir, 'piped.wav');
        const ph = wavHeader({ rate: 24000, frames: 0 });
        ph.writeUInt32LE(mark, 40);
        fs.writeFileSync(piped, Buffer.concat([ph, Buffer.alloc(48)]));
        refused(piped, new RegExp(`piped\\.wav does not say how much audio it holds: its data chunk's size is ${said}, with 48 bytes after it, as a WAV written through a pipe leaves it`),
          `a WAV written through a pipe, its size ${said}, was not named as one`);
      }
      const odd = path.join(dir, 'odd.wav');
      const h = wavHeader({ rate: 24000, frames: 2 });
      h.writeUInt32LE(3, 40);
      fs.writeFileSync(odd, Buffer.concat([h, Buffer.alloc(3)]));
      refused(odd, /part way through a frame/, 'a clip ending mid-frame passed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  check('voice: lengths and moments are said rounded before they are split, never as :60', () => {
    const { minutes } = require('./lib/cli.js');
    const { clock } = require('./lib/voice.js');
    eq([119.6, 179.7, 120.51, 59.4, 0, 3599.5].map(minutes).join(' '), '2:00 3:00 2:01 0:59 0:00 60:00', 'whole seconds, as the takes, the export and the voice say a length');
    eq([239.97, 203.556, 59.95, 6.502, 0].map(clock).join(' '), '4:00.0 3:23.6 1:00.0 0:06.5 0:00.0', 'tenths, as the voice says where its sample came from');
  });

  check('voice: SIPARIO_TTS unset says how to set one up, and one that is not a file is refused by name', () => {
    let err = null;
    try { tts.findTts({ PATH: process.env.PATH }); } catch (e) { err = e; }
    if (!err || !/set SIPARIO_TTS/.test(err.message) || !/docs\/VOICE\.md/.test(err.message)) {
      throw new Error(`unset, it said ${err && err.message}`);
    }
    err = null;
    try { tts.findTts({ SIPARIO_TTS: '/nowhere/sipario-tts', PATH: '' }); } catch (e) { err = e; }
    if (!err || !/SIPARIO_TTS is \/nowhere\/sipario-tts, which is not a file here/.test(err.message)) {
      throw new Error(`a missing engine was not refused by name: ${err && err.message}`);
    }
    eq(tts.findTts({ SIPARIO_TTS: path.basename(process.execPath), PATH: path.dirname(process.execPath) }),
      process.execPath, 'a bare name is found on PATH');
  });

  /* The protocol, in a process of its own: the engine started, asked and
     broken in each of the ways it can break, with short limits. Run once,
     read by the checks below. */
  const engineRuns = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-tts-'));
    const bin = fakeAt(dir);
    /* The engine behind a script, as a venv's often is, written without
       `exec`: the script is the process sipario starts, the engine its
       child. */
    const wrap = path.join(dir, 'wrap.sh');
    fs.writeFileSync(wrap, `#!/bin/sh\n'${process.execPath}' '${bin}'\n`);
    fs.chmodSync(wrap, 0o755);
    const probe = `
      const fs = require('fs');
      const path = require('path');
      const tts = require(${JSON.stringify(path.join(ROOT, 'lib/tts.js'))});
      const dir = ${JSON.stringify(dir)};
      const bin = ${JSON.stringify(bin)};
      const wrap = ${JSON.stringify(wrap)};
      const pids = path.join(dir, 'pids');
      const sink = { write() {} };
      const list = (d) => fs.readdirSync(d).sort();
      const start = (more, readyTimeout = 10000, how = {}) => tts.startEngine(how.bin || bin,
        { env: { ...process.env, FAKE_TTS_PID: pids, ...more }, log: how.log || sink, readyTimeout });
      /* The engine's own process, by the id it wrote; gone means gone, so a
         killed one is waited on until it is reaped. */
      const lastPid = () => Number(fs.readFileSync(pids, 'utf8').trim().split('\\n').pop());
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
      const gone = async (pid) => { for (let i = 0; i < 40 && alive(pid); i++) await wait(50); return !alive(pid); };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const listening = () => process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
      const room = (name) => { const d = path.join(dir, name); fs.mkdirSync(d); return d; };
      const req = (d, id, text) => ({ id, text, sample: path.join(dir, 'sample.wav'), out: path.join(d, id + '.wav') });
      const caught = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
      (async () => {
        const out = {};
        {
          const d = room('happy');
          const log = path.join(dir, 'happy.log');
          const e = await start({ FAKE_TTS_LOG: log });
          const a = await tts.clip(e, req(d, 'one', 'Hello there.'));
          const b = await tts.clip(e, req(d, 'two', 'And once again, a little longer.'));
          await e.close();
          out.happy = { ready: e.ready, a, b, files: list(d),
                        sent: fs.readFileSync(log, 'utf8').trim().split('\\n').map((l) => JSON.parse(l)) };
        }
        {
          const t0 = Date.now();
          out.hang = { error: await caught(start({ FAKE_TTS: 'hang' }, 400)), ms: Date.now() - t0 };
          out.hang.stopped = await gone(lastPid());
        }
        {
          const d = room('junk');
          const e = await start({ FAKE_TTS: 'junk' });
          out.junk = { error: await caught(tts.clip(e, req(d, 'one', 'Hello.'))), files: list(d) };
          await e.close();
        }
        {
          const d = room('die');
          const e = await start({ FAKE_TTS: 'die', FAKE_TTS_AFTER: '1' });
          await tts.clip(e, req(d, 'one', 'Hello.'));
          out.die = { error: await caught(tts.clip(e, req(d, 'two', 'Goodbye.'))), files: list(d),
                      after: await caught(tts.clip(e, req(d, 'three', 'Anyone?'))) };
          await e.close();
        }
        {
          const d = room('error');
          const e = await start({ FAKE_TTS: 'error' });
          out.error = { error: await caught(tts.clip(e, req(d, 'one', 'Hello.'))), files: list(d) };
          await e.close();
          out.error.closed = true;
        }
        {
          const d = room('stall');
          const e = await start({ FAKE_TTS: 'stall' });
          out.stall = { error: await caught(tts.clip(e, req(d, 'one', 'Hello.'), { timeout: 300 })), files: list(d) };
          await e.close();
        }
        for (const mode of ['cut', 'empty']) {
          const d = room(mode);
          const e = await start({ FAKE_TTS: mode });
          out[mode] = { error: await caught(tts.clip(e, req(d, 'one', 'Hello.'))), files: list(d) };
          await e.close();
        }
        {
          /* Behind a script, timed out, and slow rather than stuck: killed
             alone, the script would leave the engine to write its clip
             after the name it was handed had been cleared away. A model
             busy generating does not see its stdin close, so this one
             stays on when it does. */
          const d = room('orphan');
          const e = await start({ FAKE_TTS: 'late', FAKE_TTS_LINGER: 'forever' }, 10000, { bin: wrap });
          const pid = lastPid();
          const error = await caught(tts.clip(e, req(d, 'one', 'Hello.'), { timeout: 300 }));
          await wait(1200);
          out.orphan = { error, stopped: !alive(pid), files: list(d) };
        }
        {
          const d = room('linger');
          const said = [];
          tts.LIMITS.close = 500;
          const e = await start({ FAKE_TTS_LINGER: 'forever' }, 10000, { bin: wrap, log: { write: (c) => said.push(String(c)) } });
          const pid = lastPid();
          await tts.clip(e, req(d, 'one', 'Hello.'));
          const error = await caught(e.close());
          out.linger = { error, stopped: await gone(pid), said: said.join(''), files: list(d) };
          tts.LIMITS.close = 5000;
        }
        {
          const e = await start({ FAKE_TTS: 'stall' });
          const pid = lastPid();
          const p = caught(tts.clip(e, req(room('sigsay'), 'one', 'Hello.')));
          setTimeout(() => process.kill(process.pid, 'SIGINT'), 100);
          out.sigsay = { error: await p, stopped: await gone(pid), listening: listening() };
        }
        {
          const e = await start({ FAKE_TTS_LINGER: '1500' });
          const pid = lastPid();
          await tts.clip(e, req(room('sigclose'), 'one', 'Hello.'));
          const p = caught(e.close());
          setTimeout(() => process.kill(process.pid, 'SIGINT'), 200);
          out.sigclose = { error: await p, stopped: await gone(pid), listening: listening() };
        }
        /* Nothing this probe started outlives it, whatever the checks find. */
        for (const pid of fs.readFileSync(pids, 'utf8').trim().split('\\n').map(Number)) {
          if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        }
        console.log(JSON.stringify(out));
      })().catch((e) => console.log(JSON.stringify({ crashed: e.stack })));
    `;
    const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 60000 });
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      if (out.crashed) throw new Error(out.crashed);
      return { out, status: r.status, signal: r.signal };
    } catch (e) {
      return { error: `the engine probe did not report (${r.signal || r.status}): ${e.message} ${r.stderr}` };
    }
  })();
  const ran = () => { if (engineRuns.error) throw new Error(engineRuns.error); return engineRuns.out; };

  check('voice: the engine is started once, says it is ready, and answers each request in turn, each clip renamed into place whole', () => {
    const o = ran().happy;
    eq(`${o.ready.ready} ${o.ready.engine}`, 'true fake', 'the ready line, as the engine sent it');
    eq(o.files.join(' '), 'one.wav two.wav', 'each clip at the name it was asked for, and nothing else left beside them');
    eq(o.sent.map((q) => q.id).join(' '), 'one two', 'one request each, in order, one engine for both');
    for (const q of o.sent) {
      if (!/\.wav$/.test(q.out) || path.basename(q.out) === `${q.id}.wav`) {
        throw new Error(`the engine was handed ${q.out}: a name of sipario's ending .wav, not the kept one`);
      }
    }
    eq(o.a.frames, Math.round(24000 * 0.02 * 'Hello there.'.length) + 7, 'the first clip read exactly from its header');
    eq(`${o.b.rate} ${o.b.frames}`, `16000 ${Math.round(16000 * 0.02 * 'And once again, a little longer.'.length) + 7}`, 'and the second');
  });

  check('voice: an engine that never says it is ready is stopped at the timeout, and named', () => {
    const o = ran().hang;
    if (!/did not say it was ready within 0\.4s, and was stopped; it last said: fake: loading the model/.test(o.error || '')) {
      throw new Error(`it said ${o.error}`);
    }
    if (o.ms > 5000) throw new Error(`it took ${o.ms}ms to give up`);
    eq(o.stopped, true, 'and the engine is gone, not left loading');
  });

  check('voice: a line on the engine\'s stdout that is not the protocol is named, and nothing is kept for it', () => {
    const o = ran().junk;
    if (!/wrote "generating one\.\.\." on stdout, which is not a line of the protocol/.test(o.error || '')) {
      throw new Error(`it said ${o.error}`);
    }
    eq(o.files.length, 0, 'no clip and no name handed out left behind');
  });

  check('voice: an engine that dies mid-clip is named with its exit code and last words, and leaves nothing at the kept name', () => {
    const o = ran().die;
    if (!/exited with code 3 while voicing two; it last said: .*fake: out of memory/.test(o.error || '')) {
      throw new Error(`it said ${o.error}`);
    }
    /* The engine wrote a hundred bytes of a clip and died: at the name it
       was handed, never at the kept one, and that name is cleared away. */
    eq(o.files.join(' '), 'one.wav', 'the finished clip kept, the half one nowhere');
    if (!/exited with code 3/.test(o.after || '')) throw new Error(`a request after the death was not refused: ${o.after}`);
  });

  check('voice: an error from the engine is named with its step, and a request never answered is stopped at its time', () => {
    const o = ran();
    eq(o.error.error, 'the voice engine could not voice one: no voice for that', 'the engine\'s own error, with the step');
    eq(`${o.error.files.length} ${o.error.closed}`, '0 true', 'nothing kept, and the engine still closed cleanly');
    if (!/did not answer for one within 0\.3s, and was stopped/.test(o.stall.error || '')) throw new Error(`it said ${o.stall.error}`);
    eq(o.stall.files.length, 0, 'nothing kept for it');
  });

  check('voice: a clip the engine says is done is kept only if it reads as a whole WAV with audio in it', () => {
    const o = ran();
    if (!/^the voice engine said one was voiced, but \S+\/one\.\d+-[0-9a-f]{6}\.wav is cut short: its data chunk promises \d+ bytes and the file holds 56$/.test(o.cut.error || '')) {
      throw new Error(`a clip cut short: ${o.cut.error}`);
    }
    eq(o.cut.files.length, 0, 'nothing kept for a clip cut short, at the kept name or the one handed out');
    eq(o.empty.error, 'the voice engine said one was voiced, and wrote no audio for it', 'a clip with no audio');
    eq(o.empty.files.length, 0, 'nothing kept for it either');
  });

  check('voice: an engine run by a script without exec is stopped whole at a timeout, and writes nothing late', () => {
    const o = ran().orphan;
    if (!/did not answer for one within 0\.3s, and was stopped/.test(o.error || '')) throw new Error(`it said ${o.error}`);
    eq(o.stopped, true, 'the engine behind the script is gone, not left running');
    eq(o.files.length, 0, 'and nothing was written beside the cache after the run gave up on it');
  });

  check('voice: an engine that will not exit when its input closes is stopped whole, and said, and the clips stand', () => {
    const o = ran().linger;
    eq(o.error, null, 'every clip was in, so closing is not a failure');
    if (!/\[voice\] the voice engine \S+ did not exit within 0\.5s of its input closing, and was stopped/.test(o.said)) {
      throw new Error(`it was not said: ${o.said}`);
    }
    eq(o.stopped, true, 'the engine behind the script is gone');
    eq(o.files.join(' '), 'one.wav', 'the clip it made is kept');
    eq(`${engineRuns.status} ${engineRuns.signal}`, '0 null', 'and nothing held this process open after it was done');
  });

  check('voice: Ctrl-C stops the engine whole and the run with it, while it speaks and while it closes', () => {
    const o = ran();
    eq(o.sigsay.error, 'stopped by SIGINT', 'a request waiting is refused');
    eq(`${o.sigsay.stopped} ${o.sigsay.listening}`, 'true 0', 'the engine gone, and the handler taken away');
    eq(o.sigclose.error, 'stopped by SIGINT', 'while it closes too, rather than the run going on to make a take');
    eq(`${o.sigclose.stopped} ${o.sigclose.listening}`, 'true 0', 'the engine gone, and the handler taken away');
  });

  /* The command, end to end: a talk, a live take of tone to clone, the
     fake engine as SIPARIO_TTS. Needs ffmpeg, which cuts the sample. */
  let ff = null;
  let browser = null;
  try { ff = video.findFfmpeg(); } catch { /* none here */ }
  try { browser = findBrowser(); } catch { /* none here */ }
  const whenFf = (name, fn) => (ff ? check(name, fn)
    : console.log(`  --    ${name}\n        not run: no ffmpeg on this machine`));
  const whenBoth = (name, fn) => (ff && browser ? check(name, fn)
    : console.log(`  --    ${name}\n        not run: ${browser ? 'no ffmpeg' : 'no browser'} on this machine`));

  /* `live` is the lavfi source of the live take's audio: by default two
     seconds of quiet, three of tone, a second and a half of quiet and a
     long stretch, so the sample is cut from the first stretch of ten
     seconds, at 6.5 s, and not from the start or the first sound. One
     step, 2-the-keys, has its script taken out. */
  function rig(live = "sine=frequency=300:duration=22,volume='if(between(t,2,5)+gte(t,6.5),1,0)':eval=frame") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-voice-'));
    const t = path.join(dir, 'talk');
    scaffold(t);
    const tt = talk(t);
    const src = fs.readFileSync(tt.deck, 'utf8').replace(/(\nid: 2-the-keys\n[\s\S]*?)```notes\n[\s\S]*?\n```\n/, '$1');
    fs.writeFileSync(tt.deck, src);
    const steps = require('./lib/export.js').outline(src, tt);
    const key = require('./lib/render.js').identity(src).key;
    const data = path.join(dir, 'data');
    const addLive = (id, source) => {
      const at = path.join(video.takesDir(key, data), id);
      fs.mkdirSync(at, { recursive: true });
      const made = spawnSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', source, '-c:a', 'aac', path.join(at, 'take.m4a')]);
      if (made.status !== 0) throw new Error(`the live take's audio was not made: ${made.stderr}`);
      fs.writeFileSync(path.join(at, 'take.json'), JSON.stringify({ version: 1, kind: 'live', audio: 'take.m4a',
        marks: [{ id: steps[0].id, t: 0 }] }));
      return at;
    };
    const takeId = '20261003-100000-aaaa';
    const take = addLive(takeId, live);
    const bin = fakeAt(dir);
    const log = path.join(dir, 'heard.log');
    const run = (args, more = {}) => spawnSync(process.execPath, [path.join(ROOT, 'bin/sipario.js'), ...args, t],
      { cwd: dir, encoding: 'utf8', timeout: 120000,
        env: { ...process.env, SIPARIO_DATA: data, SIPARIO_TTS: bin, FAKE_TTS_LOG: log, ...more } });
    const heard = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    return { dir, t, data, key, steps, takeId, take, addLive, run, heard, log,
             cache: path.join(data, 'voice', key.replace(/^sipario:/, '')),
             done: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  let voiced = null;           // the rig the first check voiced, for the export after it
  whenFf('voice: a talk is voiced into a new take, a step with no script held for --hold and never sent, the steps exact against the WAV', () => {
    const r = rig();
    voiced = r;
    const before = fs.readFileSync(path.join(r.take, 'take.json'), 'utf8');
    const res = r.run(['voice', '--hold', '1.5']);
    eq(res.status, 0, `it voiced (${res.stderr.trim().split('\n').pop()})`);
    const said = /^\[voice\] take (\S+): \d+:\d\d, 22 steps, 21 voiced by fake \(21 new, 0 cached\), 1 with no script held 1\.5s, in the voice of take 20261003-100000-aaaa \(10\.0s from (\d+(?:\.\d+)?)s\)$/m.exec(res.stdout);
    if (!said) throw new Error(`it said ${res.stdout}`);
    if (Math.abs(Number(said[2]) - 6.5) > 0.1) throw new Error(`the sample was cut from ${said[2]}s, not the first ten seconds of speech at 6.5s`);
    if (!/\[voice\] 2\/22 2-the-keys: no script, held 1\.5s/.test(res.stderr)) throw new Error(`the held step was not said: ${res.stderr}`);
    if (!/\[voice\] 1\/22 1-a-slide-of-every-template: \d+\.\d\ds, new in/.test(res.stderr)) throw new Error(`no progress: ${res.stderr}`);

    const sent = r.heard();
    eq(sent.length, 21, 'one request a step with a script');
    eq(sent.some((q) => q.id === '2-the-keys'), false, 'the step with no script never sent');
    for (const q of sent) if (!q.text.trim() || !path.isAbsolute(q.sample) || !path.isAbsolute(q.out)) throw new Error(`a request ${JSON.stringify(q)}`);

    const id = said[1];
    eq(video.listTakes(r.key, r.data).join(' '), `${r.takeId} ${id}`, 'a new take, listed after the live one');
    eq(fs.readFileSync(path.join(r.take, 'take.json'), 'utf8'), before, 'the live take untouched');
    eq(fs.readdirSync(r.take).sort().join(' '), 'take.json take.m4a', 'and nothing written beside it');
    const dir = path.join(video.takesDir(r.key, r.data), id);
    eq(fs.readdirSync(dir).sort().join(' '), 'sample.wav take.json voice.wav', 'the take\'s files');
    const k = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
    eq(`${k.version} ${k.kind} ${k.source} ${k.audio} ${k.deck}`, `1 voiced ${r.takeId} voice.wav ${r.key}`, 'what the take is');
    eq(k.marks.map((m) => m.id).join(' '), r.steps.map((s) => s.id).join(' '), 'every step marked, in the deck\'s order');
    const v = k.marks[0].v;
    if (!/^deck:[0-9a-f]{12}$/.test(v) || k.marks.some((m) => m.v !== v)) throw new Error(`the marks' version is ${v}`);
    for (const s of r.steps) eq(k.notes[v][s.id], s.notes, `the script of ${s.id}, as a live take keeps it`);
    eq(`${k.voice.engine} ${k.voice.ready.ready} ${k.voice.hold}`, 'fake true 1.5', 'the engine, its ready line and the hold');
    eq(k.voice.held.join(' '), '2-the-keys', 'which step was held');
    eq(k.voice.synthetic.join(' '), sent.map((q) => q.id).join(' '), 'which were voiced');
    eq(`${k.voice.sample.take} ${k.voice.sample.offset} ${k.voice.sample.file}`, `${r.takeId} ${said[2]} sample.wav`, 'where the sample came from');
    /* Ten seconds asked for; an AAC take decodes from a few milliseconds in,
       and the length kept is the one the WAV holds. */
    if (Math.abs(k.voice.sample.length - 10) > 0.05) throw new Error(`the sample runs ${k.voice.sample.length}s`);
    eq(k.voice.sample.length, readWav(path.join(dir, 'sample.wav')).seconds, 'the length kept is the sample\'s own');

    /* Each step's place is counted in frames: whole at 24 kHz, the held
       one exactly 1.5s, the 24 kHz clips exactly as the engine made them,
       the 16 kHz ones as long once converted, to the frame, each after the
       first opening on the gap, 0.6 s by default, and the last ending
       where the file does. */
    const w = readWav(path.join(dir, 'voice.wav'));
    const gap = 0.6 * 24000;
    eq(`${k.voice.gap} ${k.voice.fade.in} ${k.voice.fade.out}`, '0.6 0.01 0.03', 'the gap and the fades, kept');
    eq(`${w.format} ${w.bits} ${w.channels} ${w.rate}`, 'pcm 16 1 24000', 'the take\'s audio');
    const at = k.marks.map((m) => m.t * 24000);
    for (const f of at) if (Math.abs(f - Math.round(f)) > 1e-6) throw new Error(`a step begins at ${f} frames`);
    const lens = at.map((f, i) => Math.round((i + 1 < at.length ? at[i + 1] : w.frames) - f));
    eq(lens[1], 36000, 'the held step, 1.5s to the frame');
    sent.forEach((q, n) => {
      const i = r.steps.findIndex((s) => s.id === q.id);
      const beat = i ? gap : 0;
      if (!(n % 2)) return eq(lens[i], Math.round(24000 * 0.02 * q.text.length) + 7 + beat, `${q.id}, as long as its clip and the gap`);
      const want = (Math.round(16000 * 0.02 * q.text.length) + 7) * 1.5 + beat;
      if (Math.abs(lens[i] - want) > 1) throw new Error(`${q.id} runs ${lens[i]} frames; its 16 kHz clip is ${want} at 24 kHz`);
      return null;
    });
    eq(lens.reduce((a, b) => a + b, 0), w.frames, 'the steps add up to the file');
    eq(k.length, w.frames / 24000, 'and the take says how long');

    /* The gap is silence, and a clip rises from nothing and falls to it:
       the fake's sine reaches full level within a millisecond and stops
       wherever its length leaves it. */
    const pcm = fs.readFileSync(path.join(dir, 'voice.wav')).subarray(w.dataOffset);
    const sampleAt = (f) => pcm.readInt16LE(f * 2);
    const third = Math.round(at[2]);
    for (let f = third; f < third + gap; f += 997) eq(sampleAt(f), 0, `the gap opening ${k.marks[2].id}, at frame ${f - third}`);
    const clipAt = third + gap;
    const end = Math.round(at[3]) - 1;
    if (sampleAt(clipAt) !== 0 || sampleAt(end) !== 0) throw new Error(`a clip begins at ${sampleAt(clipAt)} and ends at ${sampleAt(end)}`);
    const peak = (a, b) => { let m = 0; for (let f = a; f < b; f++) m = Math.max(m, Math.abs(sampleAt(f))); return m; };
    if (peak(clipAt, clipAt + 24) > peak(clipAt + 480, clipAt + 960) / 4) throw new Error('the clip does not fade in over its first 10 ms');
    if (peak(end - 24, end + 1) > peak(end - 1440, end - 720) / 4) throw new Error('the clip does not fade out over its last 30 ms');
  });

  whenFf('voice: sipario takes lists a voiced take by its kind and the take it came from', () => {
    if (!voiced) throw new Error('the take before was not voiced');
    const res = voiced.run(['takes']);
    eq(res.status, 0, `it listed (${res.stderr.trim()})`);
    if (!new RegExp(`\\d{8}-\\d{6}-\\w{4}\\s+voiced from ${voiced.takeId}\\s+\\d+:\\d\\d\\s+22 steps`).test(res.stdout)) {
      throw new Error(`it listed ${res.stdout}`);
    }
    if (!new RegExp(`${voiced.takeId}\\s+live`).test(res.stdout)) throw new Error(`the live take is not listed: ${res.stdout}`);
  });

  whenBoth('voice: export video of a voiced take says it is voiced, and from which take, and runs as long as its voice', () => {
    if (!voiced) throw new Error('the take before was not voiced');
    const res = voiced.run(['export', 'video']);
    eq(res.status, 0, `it exported (${res.stderr.trim()})`);
    if (!new RegExp(`from take \\S+ \\(voiced from ${voiced.takeId}\\), 22 stills of 22 steps`).test(res.stdout)) {
      throw new Error(`it said ${res.stdout}`);
    }
    const mp4 = fs.readdirSync(voiced.dir).find((f) => f.endsWith('.mp4'));
    const k = video.readTake(voiced.key, null, voiced.data);
    const len = video.durationOf(path.join(voiced.dir, mp4), ff);
    if (Math.abs(len - k.length) > 0.15) throw new Error(`the video's sound runs ${len}s against ${k.length}s of voice`);
    /* The picture too, to within a frame and the rounding of ffmpeg's
       clock: no slide stays up past the voice. */
    const seen = pictureLength(path.join(voiced.dir, mp4), ff);
    if (Math.abs(seen - k.length) > 0.05) throw new Error(`the picture runs ${seen}s against ${k.length}s of voice`);
  });
  if (voiced) voiced.done();

  whenFf('voice: an engine that dies keeps every clip it finished, leaves no take, and the next run picks up from them, unless the engine or the sample is another', () => {
    const r = rig();
    try {
      const died = r.run(['voice'], { FAKE_TTS: 'die', FAKE_TTS_AFTER: '3' });
      eq(died.status, 1, 'the run failed');
      const fourth = r.heard()[3].id;
      if (!new RegExp(`exited with code 3 while voicing ${fourth}; it last said: .*fake: out of memory`).test(died.stderr)) {
        throw new Error(`it said ${died.stderr}`);
      }
      const kept = fs.readdirSync(r.cache).sort();
      eq(kept.length, 3, `the three clips finished, and nothing else (${kept.join(' ')})`);
      for (const f of kept) {
        if (!/^[0-9a-f]{64}\.wav$/.test(f)) throw new Error(`${f} is in the cache`);
        readWav(path.join(r.cache, f));
      }
      eq(video.listTakes(r.key, r.data).join(' '), r.takeId, 'no take left behind');
      eq(fs.readdirSync(path.dirname(r.take)).length, 1, 'not even an unfinished one');
      const first = r.heard().slice(0, 3).map((q) => q.id);
      fs.rmSync(r.log);
      const again = r.run(['voice']);
      eq(again.status, 0, `it voiced the second time (${again.stderr.trim().split('\n').pop()})`);
      if (!/21 voiced by fake \(18 new, 3 cached\)/.test(again.stdout)) throw new Error(`it said ${again.stdout}`);
      for (const id of first) if (!new RegExp(`${id}: \\d+\\.\\d\\ds, cached`).test(again.stderr)) throw new Error(`${id} was not taken from the cache`);
      eq(r.heard().some((q) => first.includes(q.id)), false, 'the clips kept were not asked for again');

      /* A clip is found again only by the engine that made it, saying the
         same of itself, cloning the same sample: a new release voices every
         step again, and so does a newer live take, while --from the take
         the clips were cloned from finds every one of them. */
      const upgraded = r.run(['voice'], { FAKE_TTS_VERSION: '2' });
      if (!/21 voiced by fake \(21 new, 0 cached\)/.test(upgraded.stdout)) throw new Error(`a new release: ${upgraded.stdout}${upgraded.stderr}`);
      r.addLive('20261003-110000-bbbb', 'sine=frequency=440:duration=14');
      const newer = r.run(['voice']);
      if (!/21 voiced by fake \(21 new, 0 cached\).* in the voice of take 20261003-110000-bbbb /.test(newer.stdout)) {
        throw new Error(`a newer live take: ${newer.stdout}${newer.stderr}`);
      }
      const from = r.run(['voice', '--from', r.takeId]);
      if (!/21 voiced by fake \(0 new, 21 cached\).* in the voice of take 20261003-100000-aaaa /.test(from.stdout)) {
        throw new Error(`--from the first take: ${from.stdout}${from.stderr}`);
      }
    } finally {
      r.done();
    }
  });

  whenFf('voice: Ctrl-C while the take is put together stops the run, and leaves no take and no half of one', () => {
    /* The signal comes from an ffmpeg that sends it to sipario as it is
       asked to convert a clip, the step after the engine has gone, while
       sipario waits on it. */
    const r = rig();
    try {
      const shim = path.join(r.dir, 'ffmpeg');
      fs.writeFileSync(shim, `#!${process.execPath}
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
if (args.some((a) => a.includes(${JSON.stringify(`${path.sep}voice${path.sep}`)}))) process.kill(process.ppid, 'SIGINT');
const r = spawnSync(${JSON.stringify(ff)}, args, { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`);
      fs.chmodSync(shim, 0o755);
      const res = r.run(['voice'], { SIPARIO_FFMPEG: shim });
      eq(`${res.status} ${res.signal}`, '1 null', `it stopped as a failure, not killed (${res.stderr.trim().split('\n').pop()})`);
      if (!/\[voice\] stopped by SIGINT/.test(res.stderr)) throw new Error(`it said ${res.stderr}`);
      eq(fs.readdirSync(path.dirname(r.take)).join(' '), r.takeId, 'no take, finished or not, beside the live one');
      eq(fs.readdirSync(r.cache).length, 21, 'every clip kept for the next run');
    } finally {
      r.done();
    }
  });

  whenFf('voice: the voice is never cloned from a voiced take, nor from a live take with no five seconds of speech', () => {
    const r = rig();
    try {
      const fake = path.join(path.dirname(r.take), '20261003-120000-aaaa');
      fs.mkdirSync(fake);
      fs.copyFileSync(path.join(r.take, 'take.m4a'), path.join(fake, 'voice.m4a'));
      fs.writeFileSync(path.join(fake, 'take.json'), JSON.stringify({ version: 1, kind: 'voiced', source: r.takeId, audio: 'voice.m4a',
        marks: [{ id: r.steps[0].id, t: 0 }], voice: { engine: 'fake' } }));
      const named = r.run(['voice', '--from', '20261003-120000-aaaa']);
      eq(named.status, 1, 'a voiced take named as the sample is refused');
      if (!/take 20261003-120000-aaaa is voiced, spoken by fake: a voice is cloned only from a live take/.test(named.stderr)) {
        throw new Error(`it said ${named.stderr}`);
      }
      eq(r.heard().length, 0, 'before the engine was asked anything');
      const latest = r.run(['voice']);
      eq(latest.status, 0, `with a newer voiced take, it voiced (${latest.stderr.trim().split('\n').pop()})`);
      if (!/in the voice of take 20261003-100000-aaaa/.test(latest.stdout)) throw new Error(`it cloned ${latest.stdout}`);
      const hold = r.run(['voice', '--hold', '0']);
      if (hold.status !== 1 || !/--hold is 0: it is the seconds a step with no script is held silent/.test(hold.stderr)) {
        throw new Error(`a hold of 0 was not refused by name: ${hold.stderr}`);
      }
    } finally {
      r.done();
    }
    /* Three seconds of tone, a second and a half of nothing, and again:
       never five seconds at a stretch. */
    const gaps = rig("sine=frequency=300:duration=13,volume='if(lt(mod(t,4.5),3),1,0)':eval=frame");
    try {
      const res = gaps.run(['voice']);
      eq(res.status, 1, 'a take with no five seconds of speech is refused');
      if (!/take 20261003-100000-aaaa has no 5s of speech to clone a voice from: its longest stretch without a pause of 1s runs [234]\.\ds, at 0:/.test(res.stderr)) {
        throw new Error(`it said ${res.stderr}`);
      }
      eq(gaps.heard().length, 0, 'and the engine was never asked');
      eq(video.listTakes(gaps.key, gaps.data).length, 1, 'no take made');
    } finally {
      gaps.done();
    }
  });

  whenFf('voice: --sample cuts a longer sample by the same rule, the longest stretch when none runs that long, and never under five', () => {
    const r = rig();
    try {
      const kept = (res) => {
        const id = /^\[voice\] take (\S+):/m.exec(res.stdout)[1];
        return JSON.parse(fs.readFileSync(path.join(video.takesDir(r.key, r.data), id, 'take.json'), 'utf8')).voice.sample;
      };
      /* The rig's speech runs from 6.5 s to the end at 22 s: 15.5 s. */
      const twelve = r.run(['voice', '--sample', '12']);
      eq(twelve.status, 0, `it voiced (${twelve.stderr.trim().split('\n').pop()})`);
      const a = kept(twelve);
      if (Math.abs(a.offset - 6.5) > 0.1 || Math.abs(a.length - 12) > 0.05) throw new Error(`12 s asked, ${a.length}s cut from ${a.offset}s`);
      if (!/21 voiced by fake \(21 new, 0 cached\)/.test(twelve.stdout)) throw new Error(`another sample is another voice: ${twelve.stdout}`);
      const more = r.run(['voice', '--sample', '20']);
      eq(more.status, 0, `it voiced (${more.stderr.trim().split('\n').pop()})`);
      const b = kept(more);
      if (Math.abs(b.offset - 6.5) > 0.1 || Math.abs(b.length - 15.5) > 0.1) throw new Error(`20 s asked of 15.5, ${b.length}s cut from ${b.offset}s`);
      const few = r.run(['voice', '--sample', '4']);
      if (few.status !== 1 || !/--sample is 4: it is the seconds of speech the voice is cloned from, 5 or more/.test(few.stderr)) {
        throw new Error(`a sample of 4 s was not refused by name: ${few.stderr}`);
      }
    } finally {
      r.done();
    }
  });

  /* Directions to the voice, spoken. A clip of sine to shape, a WAV made
     here at `rate`, `frames` long and as loud as the fake engine's. */
  const voiceLib = require('./lib/voice.js');
  const J = JSON.stringify;
  const sineWav = (file, rate, frames, hz = 220, amp = 9000) => {
    const b = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * hz * i / rate)), i * 2);
    fs.writeFileSync(file, Buffer.concat([wavHeader({ rate, frames }), b]));
  };
  const samples = (file) => {
    const w = readWav(file);
    const buf = fs.readFileSync(file).subarray(w.dataOffset, w.dataOffset + w.dataBytes);
    return Int16Array.from({ length: w.frames }, (_, i) => buf.readInt16LE(i * 2));
  };
  const rms = (xs) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
  /* A tone's frequency by its rising zero crossings, over the middle of
     the clip where nothing is fading. */
  const pitchOf = (xs, rate) => {
    const a = Math.floor(xs.length * 0.2);
    const b = Math.floor(xs.length * 0.8);
    let n = 0;
    for (let i = a + 1; i < b; i++) if (xs[i - 1] < 0 && xs[i] >= 0) n += 1;
    return n / ((b - a) / rate);
  };

  whenFf('voice directions: a piece is made slower or faster to the frame, its pitch moved with its length kept, its level changed by the dB asked, from 24 kHz and 16 kHz clips alike', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-shape-'));
    try {
      eq(voiceLib.atempo(0.25).join(','), 'atempo=0.5,atempo=0.500000', 'a tempo under a half chained');
      eq(voiceLib.atempo(3).join(','), 'atempo=2,atempo=1.500000', 'and one over two');
      eq(voiceLib.atempo(1).length, 0, 'and none at all for no change');
      for (const rate of [24000, 16000]) {
        const src = path.join(dir, `s${rate}.wav`);
        const frames = Math.round(rate * 1.2345) + 7;
        sineWav(src, rate, frames);
        const n24 = Math.round(frames * 24000 / rate);
        let k = 0;
        const make = (v) => samples(voiceLib.shape(src, v, ff, dir, `${rate}-${k++}`).file);
        const plain = make({ volume: 0 });
        eq(plain.length, n24, `${rate}: unchanged, as long as it was`);
        for (const r of [0.75, 0.9, 1.25, 0.5]) {
          eq(make({ rate: r }).length, Math.round(n24 / r), `${rate}: rate ${r}, exactly 1/${r} as long`);
        }
        const up = make({ pitch: 2 });
        eq(up.length, n24, `${rate}: pitch +2 semitones keeps the length`);
        const hz = pitchOf(up, 24000);
        if (Math.abs(hz / (220 * 2 ** (2 / 12)) - 1) > 0.02) throw new Error(`${rate}: pitch +2 made 220 Hz into ${hz.toFixed(1)} Hz`);
        const both = make({ rate: 0.5, pitch: 12 });
        eq(both.length, Math.round(n24 / 0.5), `${rate}: half speed an octave up, twice as long through chained atempo`);
        if (Math.abs(pitchOf(both, 24000) / 440 - 1) > 0.02) throw new Error(`${rate}: an octave up is ${pitchOf(both, 24000).toFixed(1)} Hz`);
        const level = rms(plain);
        for (const db of [-6, -10, 4]) {
          const got = 20 * Math.log10(rms(make({ volume: db })) / level);
          if (Math.abs(got - db) > 0.1) throw new Error(`${rate}: volume ${db}dB changed the level by ${got.toFixed(2)}dB`);
        }
        const loud = make({ volume: 12 });
        if (Math.max(...loud.map(Math.abs)) > 32767 * 0.9) throw new Error(`${rate}: +12dB on a loud clip went past the limiter`);
        eq(loud.length, n24, `${rate}: and the limiter keeps the length`);
        eq(make({ volume: -Infinity }).every((x) => x === 0), true, `${rate}: silent is silence`);
      }
      /* The length above is cut to by atrim whatever the tempo was; where
         the sound ends is what says the tempo was right. A second of tone
         then half a second of silence, so a wrong tempo cannot hide under
         the padding. */
      const burst = path.join(dir, 'burst.wav');
      sineWav(burst, 24000, 36000);
      const bb = fs.readFileSync(burst);
      bb.fill(0, readWav(burst).dataOffset + 24000 * 2);
      fs.writeFileSync(burst, bb);
      const ends = (v) => {
        const xs = samples(voiceLib.shape(burst, v, ff, dir, `burst-${JSON.stringify(v).replace(/\W/g, '')}`).file);
        let i = xs.length - 1;
        while (i > 0 && Math.abs(xs[i]) < 500) i -= 1;
        return i / 24000;
      };
      for (const [v, at] of [[{ rate: 0.5 }, 2], [{ rate: 0.75 }, 1 / 0.75], [{ rate: 0.9 }, 1 / 0.9], [{ rate: 1.25 }, 0.8],
                             [{ pitch: 2 }, 1], [{ pitch: -4 }, 1], [{ rate: 0.5, pitch: 12 }, 2]]) {
        const got = ends(v);
        if (Math.abs(got / at - 1) > 0.015) throw new Error(`${JSON.stringify(v)}: a second of sound ends at ${got.toFixed(3)}s, not ${at.toFixed(3)}s`);
      }
      const t = voiceLib.tone(4800);
      eq(t.length, 9600, 'a tone of 4800 frames is 4800 frames');
      const tx = Int16Array.from({ length: 4800 }, (_, i) => t.readInt16LE(i * 2));
      if (Math.abs(pitchOf(tx, 24000) - 1000) > 10) throw new Error(`the bleep is ${pitchOf(tx, 24000)} Hz`);
      eq(`${tx[0]} ${tx[4799]}`, '0 0', 'faded in and out');
      if (Math.abs(Math.max(...tx) - 3277) > 2) throw new Error(`the bleep peaks at ${Math.max(...tx)}`);
      const soft = voiceLib.tone(4800, -10);
      const sx = Int16Array.from({ length: 4800 }, (_, i) => soft.readInt16LE(i * 2));
      if (Math.abs(Math.max(...sx) - 3277 * 10 ** -0.5) > 2) throw new Error(`a bleep 10dB softer peaks at ${Math.max(...sx)}`);
      eq(voiceLib.tone(4800, -Infinity).every((x) => x === 0), true, 'a silent bleep is silence');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /* The first step's script, directed: a break, a slow phrase, a phrase
     in Italian and an expletive. */
  const DIRECTED = 'Hello <break time="1.5s"/> world. <prosody rate="x-slow">Slow words</prosody> and ' +
    '<lang xml:lang="it-IT">grazie</lang>, a <say-as interpret-as="expletive">damn</say-as> end.';
  const direct = (r, script) => {
    const deck = path.join(r.t, 'deck.md');
    const src = fs.readFileSync(deck, 'utf8').replace(/```notes\n[\s\S]*?\n```/, `\`\`\`notes\n${script}\n\`\`\``);
    fs.writeFileSync(deck, src);
    return require('./lib/export.js').outline(src, talk(r.t));
  };

  let directed = null;
  whenFf('voice directions: a directed step is spoken as its pieces, pauses exact silence and a bleep a tone, the language sent only where given, every step after it exactly where its frames put it', () => {
    const r = rig();
    directed = r;
    const steps = direct(r, DIRECTED);
    const res = r.run(['voice', '--hold', '1.5']);
    eq(res.status, 0, `it voiced (${res.stderr.trim().split('\n').pop()})`);
    if (!/22 steps, 21 voiced by fake \(27 new clips, 0 cached\)/.test(res.stdout)) throw new Error(`it said ${res.stdout}`);
    if (!new RegExp(`\\[voice\\] 1/22 ${steps[0].id}: 9 pieces, \\d+\\.\\d\\ds of speech in 7 clips \\(7 new in \\d+\\.\\ds, 0 cached\\)`).test(res.stderr)) {
      throw new Error(`the directed step's line: ${res.stderr}`);
    }
    const sent = r.heard();
    const mine = sent.filter((q) => q.id === steps[0].id);
    eq(J(mine.map((q) => q.text)), J(['Hello', 'world.', 'Slow words', 'and', 'grazie,', 'a', 'end.']), 'one request a run of text, in order');
    eq(J(mine.map((q) => q.language || null)), J([null, null, null, null, 'it-IT', null, null]), 'the language only on the phrase in it');
    for (const q of sent.filter((x) => x.id !== steps[0].id)) {
      eq(Object.keys(q).join(' '), 'id text sample out', `${q.id}: a step without directions asks as it always did`);
      eq(q.text, steps.find((s) => s.id === q.id).notes.trim(), `${q.id}: its notes, word for word`);
    }

    const id = /^\[voice\] take (\S+):/m.exec(res.stdout)[1];
    const at = path.join(video.takesDir(r.key, r.data), id);
    const k = JSON.parse(fs.readFileSync(path.join(at, 'take.json'), 'utf8'));
    const v = k.marks[0].v;
    eq(k.notes[v][steps[0].id], steps[0].script, 'the take keeps the script the voice read, directions and all');
    eq(k.voice.synthetic.includes(steps[0].id), true, 'and counts the directed step as voiced');

    /* Every clip is in the cache under the hash it would always have had,
       the Italian one's with its language, which a plain step's never is. */
    const self = JSON.stringify(k.voice.ready);
    const sample = fs.readFileSync(path.join(at, 'sample.wav'));
    const hash = (...parts) => {
      const h = require('crypto').createHash('sha256');
      for (const p of ['fake', self, sample, ...parts]) h.update(p).update('\0');
      return path.join(r.cache, `${h.digest('hex')}.wav`);
    };
    for (const s of steps.slice(1)) if (s.notes.trim() && !fs.existsSync(hash(s.notes.trim()))) throw new Error(`${s.id}'s clip is not where it always was`);
    if (!fs.existsSync(hash('grazie,', 'it-IT'))) throw new Error('the Italian clip is not keyed by its language');
    if (fs.existsSync(hash('grazie,'))) throw new Error('the Italian clip is keyed as if it had none');

    /* The first step, frame by frame: the fake engine's clips alternate
       24 kHz and 16 kHz, a 16 kHz one runs 1.5 times its frames once
       converted (to a frame), the slow one exactly 1/0.75 of that, the
       pause 1.5 s and the bleep 0.3 s exactly. */
    const len = (text, n) => {
      const f = Math.round((n % 2 ? 16000 : 24000) * 0.02 * text.length) + 7;
      return n % 2 ? f * 1.5 : f;
    };
    const c = mine.map((q, n) => len(q.text, n));
    const want = c[0] + 36000 + c[1] + Math.round(c[2] / 0.75) + c[3] + c[4] + c[5] + 7200 + c[6];
    const t = k.marks.map((m) => Math.round(m.t * 24000));
    const first = t[1] - t[0];
    if (Math.abs(first - want) > 4) throw new Error(`the first step runs ${first} frames, its pieces ${want}`);
    const w = readWav(path.join(at, 'voice.wav'));
    const xs = samples(path.join(at, 'voice.wav'));
    const pause = xs.subarray(c[0] + 1, c[0] + 36000 - 1);
    eq(pause.every((x) => x === 0), true, 'the break is silence, all 1.5 s of it');
    if (!(rms(xs.subarray(c[0] - 200, c[0])) > 1000 && rms(xs.subarray(c[0] + 36002, c[0] + 36400)) > 1000)) {
      throw new Error('and it sits between sound');
    }
    const bleep = xs.subarray(t[1] - c[6] - 7200, t[1] - c[6]);
    const blp = Int16Array.from(bleep);
    if (Math.abs(pitchOf(blp, 24000) - 1000) > 15) throw new Error(`the bleep before the last word is ${pitchOf(blp, 24000)} Hz`);
    const sum = k.marks.reduce((a, m, i) => a + ((i + 1 < k.marks.length ? t[i + 1] : w.frames) - t[i]), 0);
    eq(sum, w.frames, 'the steps add up to the file');

    /* A second run finds every clip; one that only slows the phrase down
       further asks the engine for nothing, and is longer by exactly that. */
    fs.rmSync(r.log);
    const again = r.run(['voice', '--hold', '1.5']);
    if (!/\(0 new clips, 27 cached\)/.test(again.stdout)) throw new Error(`the second run: ${again.stdout}`);
    direct(r, DIRECTED.replace('rate="x-slow"', 'rate="50%"'));
    const slower = r.run(['voice', '--hold', '1.5']);
    eq(slower.status, 0, `it voiced slower (${slower.stderr.trim().split('\n').pop()})`);
    eq(r.heard().length, 0, 'and asked the engine for nothing, twice');
    const k2 = video.readTake(r.key, null, r.data);
    const t2 = k2.marks.map((m) => Math.round(m.t * 24000));
    const grew = (t2[1] - t2[0]) - first;
    const by = Math.round(c[2] / 0.5) - Math.round(c[2] / 0.75);
    if (Math.abs(grew - by) > 2) throw new Error(`slowing the phrase from 0.75 to 0.5 added ${grew} frames, not ${by}`);
  });

  whenBoth('voice directions: export video of a take with a break keeps every step on its slide, the change landing where the frames put it', () => {
    if (!directed) throw new Error('the take before was not voiced');
    const r = directed;
    const k = video.readTake(r.key, null, r.data);
    const res = r.run(['export', 'video']);
    eq(res.status, 0, `it exported (${res.stderr.trim()})`);
    const mp4 = path.join(r.dir, fs.readdirSync(r.dir).find((f) => f.endsWith('.mp4')));
    const seen = pictureLength(mp4, ff);
    if (Math.abs(seen - k.length) > 0.05) throw new Error(`the picture runs ${seen}s against ${k.length}s of voice`);
    const frame = (s) => {
      const out = spawnSync(ff, ['-v', 'error', '-ss', String(s), '-i', mp4, '-frames:v', '1', '-vf', 'scale=64:36',
        '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
      if (out.status !== 0 || out.stdout.length !== 64 * 36) throw new Error(`no frame at ${s}s: ${out.stderr}`);
      return out.stdout;
    };
    const differ = (a, b) => a.reduce((n, x, i) => n + Math.abs(x - b[i]), 0) / a.length;
    const change = k.marks[1].t;
    if (change < 2) throw new Error(`the second step begins at ${change}s, before the first step's break has ended`);
    const before = frame(change - 0.3);
    if (differ(frame(0.2), before) > 1) throw new Error('the first slide does not hold through its break');
    if (differ(before, frame(change + 0.1)) < 2) throw new Error(`the slide does not change at ${change}s, where the frames put the second step`);
    r.done();
  });

}

// ---------------------------------------------------------- the recorder

{
  check('recording: the deck says which step it shows and when it arrived, and a repeat keeps the moment', () => {
    /* The notes mark a take from what the deck says, so the deck says the
       step by its own id and stamps the moment it moved, in its own
       window. Said again (a hello, the map toggled), the position keeps
       the moment the step was first shown, or a repeat would read as a
       press. What it said before is all still said. */
    const bus = makeBus();
    const w = windowFor(deckBody, [js], bus);
    const heard = [];
    const ear = new bus(w.document.getElementById('deck').getAttribute('data-deck'));
    ear.onmessage = (e) => { if (e.data.type === 'state') heard.push(e.data); };
    const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
    const before = w.performance.timeOrigin + w.performance.now();
    key('ArrowRight');
    const moved = heard.pop();
    const here = w.document.querySelector('.slide.current');
    eq(moved.id, here.id, 'the step, by its id');
    if (!(moved.at >= before && moved.at <= w.performance.timeOrigin + w.performance.now())) {
      throw new Error(`the moment ${moved.at} is not when the deck moved (from ${before})`);
    }
    for (const k of ['g', 's', 'y', 'map', 'v', 'tab']) {
      if (!(k in moved)) throw new Error(`the position no longer says ${k}`);
    }
    ear.postMessage({ from: 'presenter', type: 'hello' });
    const again = heard.pop();
    eq(`${again.id} ${again.at}`, `${moved.id} ${moved.at}`, 'said again, the same step at the same moment');
    key('ArrowRight');
    const next = heard.pop();
    if (next.id === moved.id || !(next.at >= moved.at)) throw new Error('a move did not say its own step and moment');
    key('ArrowLeft');
    const back = heard.pop();
    eq(back.id, moved.id, 'back on the first step');
    if (!(back.at >= next.at)) throw new Error('coming back to a step is a new moment, not the old one');
    /* Shown again where it is, which runs the whole of the deck's show
       again: a jump from the notes to the step on screen. The clock has
       moved on, so a moment taken again would read differently. */
    const t0 = w.performance.now();
    while (w.performance.now() - t0 < 2) { /* the clock moves on */ }
    ear.postMessage({ from: 'presenter', type: 'jump', g: back.g, s: back.s, y: back.y });
    const jumped = heard.pop();
    eq(`${jumped.id} ${jumped.at}`, `${back.id} ${back.at}`, 'shown again where it is, the same step at the same moment');
  });

  check('recording: browsing the overview marks no step, and closing it on one marks that step once', () => {
    /* The arrows move the selection on the map, and the room sees the
       map, not each slide selected: the deck goes on saying the step it
       showed before the map opened. Enter opens a build at its first
       step, and only that step is said; closing the map with Escape says
       the step it closed on. */
    const bus = makeBus();
    const w = windowFor(deckBody, [js], bus);
    const heard = [];
    const ear = new bus(w.document.getElementById('deck').getAttribute('data-deck'));
    ear.onmessage = (e) => { if (e.data.type === 'state') heard.push(e.data); };
    const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
    const tick = () => { const t0 = w.performance.now(); while (w.performance.now() - t0 < 2) { /* on */ } };
    key('ArrowRight');
    const shown = heard.pop();
    heard.length = 0;
    tick();
    key('o');
    key('ArrowRight');
    key('ArrowLeft');
    for (let i = 0; i < 6 && !(heard.length && heard[heard.length - 1].y > 0); i++) key('ArrowDown');
    const browsing = heard.splice(0);
    if (!browsing.length || browsing[browsing.length - 1].y === 0) throw new Error('the fixture has no build to select a later step of');
    if (!browsing.some((m) => m.g !== shown.g)) throw new Error('the selection did not move');
    for (const m of browsing) {
      eq(`${m.id} ${m.at}`, `${shown.id} ${shown.at}`, 'while the map is open, the step shown before it');
    }
    tick();
    key('Enter');
    const opened = heard.splice(0);
    const here = w.document.querySelector('.slide.current');
    eq([...new Set(opened.map((m) => m.id))].join(' '), here.id, 'Enter says one step, the one it opened');
    eq(opened[opened.length - 1].y, 0, 'a build opened at its first step');
    if (!(opened[0].at > shown.at)) throw new Error('the step opened is stamped when it opened');
    tick();
    key('o');
    key('ArrowLeft');
    key('Escape');
    const closed = heard.splice(0);
    const there = w.document.querySelector('.slide.current') && w.document.querySelector('.stack.current-stack .slide.current');
    const last = closed[closed.length - 1];
    if (!last || last.id === here.id) throw new Error(`closing the map on another step did not say it: ${JSON.stringify(closed.map((m) => m.id))}`);
    eq(last.id, there.id, 'Escape says the step the map closed on');
    eq(closed.filter((m) => m.id !== here.id).length, 1, 'once');
    if (!(last.at > opened[0].at)) throw new Error('stamped when the map closed');
  });
}

{
  /* The server's half of a take: one probe, a talk served on a port of
     its own with a data folder of its own, asked what a notes window
     asks and what a page on another site might. Run once, read by the
     checks below. */
  const lan = (() => {
    for (const list of Object.values(require('os').networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
    }
    return null;
  })();
  let ran = null;
  const recordRun = () => {
    if (ran) return ran;
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-record-'));
    const t = path.join(dir, 'talk');
    fs.cpSync(TALK.dir, t, { recursive: true });
    const data = path.join(dir, 'data');
    const probe = `
      process.env.SIPARIO_DATA = ${JSON.stringify(data)};
      const fs = require('fs'), path = require('path'), http = require('http');
      /* Every recorder a server makes, kept to ask afterwards what it
         still holds open: wrapped before the server is loaded, since it
         takes createRecorder as it loads. */
      const record = require(${JSON.stringify(path.join(ROOT, 'lib/record.js'))});
      const recorders = [];
      const made = record.createRecorder;
      record.createRecorder = (o) => { const r = made(o); recorders.push(r); return r; };
      const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
      const video = require(${JSON.stringify(path.join(ROOT, 'lib/video.js'))});
      const quiet = { log(){}, warn(){}, error(){} };
      const LAN = ${JSON.stringify(lan)};
      const up = (srv) => new Promise((ok) => (srv.listening ? ok() : srv.once('listening', ok)));
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      /* A POST of any body and type, and its answer as the client hears
         it: the status from the response's head, whatever the socket does
         after, so a 413 sent before a close counts as heard. */
      const ask = (host, port, p, body, headers = {}, method = 'POST') => new Promise((ok) => {
        let status = 0, text = '';
        const q = http.request({ host, port, path: p, method, headers }, (r) => {
          status = r.statusCode;
          r.on('data', (c) => { text += c; });
          r.on('end', () => ok({ status, body: text }));
          r.on('error', () => ok({ status, body: text }));
        });
        q.on('error', (e) => ok({ status, body: text || e.message }));
        if (body && body.pipe) body.pipe(q); else q.end(body);
      });
      const J = { 'content-type': 'application/json' };
      const B = { 'content-type': 'application/octet-stream' };
      (async () => {
        const out = {};
        const s = serve(${JSON.stringify(t)}, { port: 0, log: quiet, audience: false, remote: false });
        await up(s);
        const P = s.address().port;
        const at = (p, body, headers, method) => ask('127.0.0.1', P, p, body, headers, method);
        const json = (p, o, h = {}) => at(p, JSON.stringify(o), { ...J, ...h });
        const start = { mime: 'audio/webm;codecs=opus', settings: { channelCount: 1, sampleRate: 48000 } };

        /* Who is answered. */
        out.guard = {
          lan: LAN ? (await ask(LAN, P, '/record/start', JSON.stringify(start), J)).status : null,
          rebound: (await json('/record/start', start, { host: 'rebound.example:' + P })).status,
          crossOrigin: (await json('/record/start', start, { origin: 'http://evil.example' })).status,
          otherPort: (await json('/record/start', start, { origin: 'http://localhost:' + (P + 1) })).status,
          crossSite: (await json('/record/start', start, { 'sec-fetch-site': 'cross-site' })).status,
          options: (await at('/record/start', '', { origin: 'http://evil.example', 'access-control-request-method': 'POST' }, 'OPTIONS')).status,
          get: (await at('/record/start', undefined, {}, 'GET')).status,
          elsewhere: (await json('/record/delete', {})).status,
          plain: (await at('/record/start', JSON.stringify(start), { 'content-type': 'text/plain' })).status,
          form: (await at('/record/start', 'mime=audio/webm', { 'content-type': 'application/x-www-form-urlencoded' })).status,
        };
        const first = await json('/record/start', start, { origin: 'http://localhost:' + P, 'sec-fetch-site': 'same-origin' });
        out.first = { status: first.status, ...JSON.parse(first.body) };
        const take = out.first.take;
        out.second = await json('/record/start', start);
        out.guard.chunkPlain = (await at('/record/chunk?take=' + take + '&seq=0', 'AAA', { 'content-type': 'text/plain' })).status;
        out.guard.chunkMultipart = (await at('/record/chunk?take=' + take + '&seq=0', '--x\\r\\n\\r\\nAAA\\r\\n--x--',
          { 'content-type': 'multipart/form-data; boundary=x' })).status;
        out.guard.chunkForm = (await at('/record/chunk?take=' + take + '&seq=0', 'a=AAA', { 'content-type': 'application/x-www-form-urlencoded' })).status;

        /* The slices, in order and once each. */
        const chunk = (seq, body, h = B) => at('/record/chunk?take=' + take + '&seq=' + seq, body, h);
        out.chunks = {
          zero: (await chunk(0, 'AAA')).status,
          zeroAgain: await chunk(0, 'ZZZ'),
          one: (await chunk(1, 'BBB', { 'content-type': 'audio/webm' })).status,
          oneAgain: (await chunk(1, 'BBB')).status,
          gap: await chunk(3, 'DDD'),
          noTake: (await at('/record/chunk?take=../../etc&seq=2', 'X', B)).status,
        };
        const audio = path.join(video.takesDir('sipario:minimal'), take, 'take.webm');
        out.chunks.file = fs.readFileSync(audio, 'utf8');

        /* Too large: said before the connection goes, and heard. */
        out.big = await chunk(2, Buffer.alloc(record.LIMITS.chunk + 1));
        record.LIMITS.chunk = 64;
        const { Readable } = require('stream');
        out.bigStreamed = await chunk(2, Readable.from([Buffer.alloc(40), Buffer.alloc(40)]), { ...B, 'transfer-encoding': 'chunked' });
        record.LIMITS.chunk = 8 << 20;
        record.LIMITS.take = 10;
        out.full = await chunk(2, 'CCCCCC');
        record.LIMITS.take = 300 << 20;
        out.afterBig = (await chunk(2, 'CCC')).status;
        out.fileAfterBig = fs.readFileSync(audio, 'utf8');

        /* The steps, kept as they come. */
        const ids = require(${JSON.stringify(path.join(ROOT, 'lib/export.js'))}).outline(
          fs.readFileSync(${JSON.stringify(path.join(t, 'deck.md'))}, 'utf8'), require(${JSON.stringify(path.join(ROOT, 'lib/talk.js'))}).talk(${JSON.stringify(t)})).map((x) => x.id);
        out.ids = ids;
        out.marks = {
          one: JSON.parse((await json('/record/marks', { take, from: 0, marks: [{ id: ids[0], t: 0, v: null }] })).body),
          overlap: JSON.parse((await json('/record/marks', { take, from: 0, marks: [{ id: ids[0], t: 0 }, { id: ids[1], t: 1.23456 }, { id: 'gone-step', t: 2 }] })).body),
          gap: (await json('/record/marks', { take, from: 9, marks: [{ id: ids[2], t: 3 }] })).status,
          bad: (await json('/record/marks', { take, from: 3, marks: [{ id: ids[2], t: -1 }] })).status,
        };
        const dirOf = path.dirname(audio);
        const partial = JSON.parse(fs.readFileSync(path.join(dirOf, 'marks.partial.json'), 'utf8'));
        out.partial = { marks: partial.marks, notes: partial.notes, json: fs.existsSync(path.join(dirOf, 'take.json')),
                        listed: video.listTakes('sipario:minimal') };
        out.finish = JSON.parse((await json('/record/finish', { take, length: 4.5 })).body);
        out.done = {
          partialGone: !fs.existsSync(path.join(dirOf, 'marks.partial.json')),
          listed: video.listTakes('sipario:minimal'),
          after: (await chunk(3, 'EEE')).status,
          again: (await json('/record/finish', { take })).status,
        };
        try {
          const r = video.readTake('sipario:minimal', take);
          out.read = { audio: fs.readFileSync(r.audioFile, 'utf8'), kind: r.kind, version: r.version, marks: r.marks,
                       notes: r.notes, length: r.length, settings: r.settings, mime: r.mime, deck: r.deck };
        } catch (e) { out.read = { error: e.message }; }

        /* A take gone quiet does not hold the deck; closing the server
           leaves the open one unfinished. */
        record.LIMITS.stale = 50;
        const quietTake = JSON.parse((await json('/record/start', start)).body).take;
        await wait(120);
        const next = JSON.parse((await json('/record/start', start)).body);
        out.stale = { quiet: quietTake, setAside: next.setAside, next: next.take };
        record.LIMITS.stale = 30 * 1000;
        out.idFormat = [take, quietTake, next.take];

        /* With record: false, nothing is there. */
        const off = serve(${JSON.stringify(t)}, { port: 0, log: quiet, audience: false, remote: false, record: false });
        await up(off);
        out.off = (await ask('127.0.0.1', off.address().port, '/record/start', JSON.stringify(start), J)).status;
        off.close();

        /* A data folder the server watches. */
        process.env.SIPARIO_DATA = path.join(${JSON.stringify(t)}, 'data');
        out.watched = await json('/record/start', start);
        process.env.SIPARIO_DATA = ${JSON.stringify(data)};

        out.openBefore = recorders.map((r) => r.open().length);
        const closed = new Promise((ok) => s.once('close', ok));
        s.close();
        if (s.closeAllConnections) s.closeAllConnections();
        await closed;
        out.openAfter = recorders.map((r) => r.open().length);
        console.log(JSON.stringify(out));
      })().catch((e) => { console.log(JSON.stringify({ error: e.stack })); process.exit(0); });
    `;
    const r = require('child_process').spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 30000 });
    ran = { status: r.status, signal: r.signal, stderr: r.stderr, data, out: null };
    try { ran.out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { ran.out = { error: `no output: ${r.stdout} ${r.stderr}` }; }
    const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
    ran.talkData = ls(path.join(t, 'data'));
    ran.left = ls(path.join(data, 'takes', 'minimal'));
    ran.unfinished = ran.out.stale ? fs.existsSync(path.join(data, 'takes', 'minimal', ran.out.stale.next, 'marks.partial.json')) : null;
    fs.rmSync(dir, { recursive: true, force: true });
    return ran;
  };
  const result = () => {
    const r = recordRun();
    if (r.out.error) throw new Error(r.out.error);
    return r.out;
  };

  const fromNetwork = 'recording: asked from the network, the take routes are not there';
  if (lan) {
    check(fromNetwork, () => eq(result().guard.lan, 404, 'from the network, nothing is there'));
  } else {
    console.log(`  --    ${fromNetwork}\n        not run: this machine has no network address to ask from`);
  }

  check('recording: the take routes answer this machine, by a loopback name, from a page of its own, and nothing else', () => {
    const o = result();
    eq(o.guard.rebound, 404, 'nor for a page that reached this machine by another name');
    eq(o.guard.crossOrigin, 404, 'nor for a page on another site, by its Origin');
    eq(o.guard.otherPort, 404, 'nor for one of this machine on another port');
    eq(o.guard.crossSite, 404, 'nor for a request the browser says is cross-site');
    eq(o.guard.options, 404, 'a preflight is never answered');
    eq(o.guard.get, 404, 'and nothing is there to GET');
    eq(o.guard.elsewhere, 404, 'a route not named is not there');
    eq(`${o.guard.plain} ${o.guard.form}`, '415 415', 'a start that does not say it is JSON is refused');
    eq(`${o.guard.chunkPlain} ${o.guard.chunkMultipart} ${o.guard.chunkForm}`, '415 415 415',
      'audio sent as text, a form or a multipart form is refused');
    eq(o.first.status, 200, 'a page of its own, by Origin and fetch site, is answered');
    eq(o.off, 404, 'a server asked to take no recording has no routes for one');
  });

  check('recording: the server names the take, one per deck at a time, and appends its slices once each, in order', () => {
    const o = result();
    if (!/^\d{8}-\d{6}-[a-z0-9]{1,4}$/.test(o.first.take)) throw new Error(`the take is named ${o.first.take}`);
    /* To the second: two begun within one second are told apart by the
       suffix, which says nothing of which came first. */
    const secs = o.idFormat.map((id) => id.slice(0, 15));
    eq(secs.slice().sort().join(' '), secs.join(' '), 'names that sort in the order the takes began');
    for (const id of o.idFormat) if (!/^\d{8}-\d{6}-[a-z0-9]{1,4}$/.test(id)) throw new Error(`a take is named ${id}`);
    eq(o.first.audio, 'take.webm', 'its audio named from what the browser records');
    eq(o.second.status, 409, 'a second take of the deck is refused while the first records');
    if (!/already recording/.test(o.second.body)) throw new Error(`the refusal says ${o.second.body}`);
    eq(o.chunks.zero, 200, 'the first slice is taken');
    /* Sent again because its answer was lost, which the notes do: answered
       as taken, and never written twice, so the file has one header. */
    eq(o.chunks.zeroAgain.status, 200, 'the first slice sent again is answered as taken');
    eq(JSON.parse(o.chunks.zeroAgain.body).again, true, 'and says it was had already');
    eq(`${o.chunks.one} ${o.chunks.oneAgain}`, '200 200', 'a slice sent twice is answered twice');
    eq(o.chunks.file, 'AAABBB', 'and appended once, in order');
    eq(o.chunks.gap.status, 409, 'a slice ahead of the next is refused');
    eq(JSON.parse(o.chunks.gap.body).next, 2, 'saying which one is next');
    eq(o.chunks.noTake, 409, 'a take this server did not open is not a path to anything');
  });

  check('recording: a slice too large, or one that would overfill the take, is answered 413 and the sender hears it', () => {
    const o = result();
    eq(o.big.status, 413, 'a slice over the limit, said by its length, is answered 413 and heard');
    eq(o.bigStreamed.status, 413, 'and so is one that only says so as it arrives');
    eq(o.full.status, 413, 'a slice that would take the take past its limit too');
    eq(o.afterBig, 200, 'the take goes on after a refusal');
    eq(o.fileAfterBig, 'AAABBBCCC', 'and nothing of a refused slice is in the file');
  });

  check('recording: the steps are kept as they arrive, and take.json is written only when the take is finished', () => {
    const o = result();
    eq(`${o.marks.one.have} ${o.marks.overlap.have}`, '1 3', 'steps sent again from an earlier index are kept once');
    eq(o.marks.gap, 409, 'steps from past the end are refused');
    eq(o.marks.bad, 400, 'and a step at no moment');
    eq(o.partial.marks.map((m) => `${m.id}@${m.t}`).join(' '), `${o.ids[0]}@0 ${o.ids[1]}@1.235 gone-step@2`,
      'kept on disk as they came, to the millisecond, a step the deck lacks included');
    eq(o.partial.json, false, 'no take.json while it records');
    eq(o.partial.listed.length, 0, 'so export video cannot pick it up half written');
    eq(o.finish.ok, true, `it finishes (${JSON.stringify(o.finish)})`);
    eq(`${o.done.partialGone} ${o.done.listed.join(' ')}`, `true ${o.first.take}`, 'finished, it is a take');
    eq(`${o.done.after} ${o.done.again}`, '409 409', 'and takes nothing more');
  });

  check('recording: a finished take is one export video reads, with the script that was on screen kept beside it', () => {
    const o = result();
    if (o.read.error) throw new Error(`readTake refused it: ${o.read.error}`);
    eq(o.read.audio, 'AAABBBCCC', 'its audio');
    eq(`${o.read.version} ${o.read.kind} ${o.read.deck} ${o.read.mime}`, '1 live sipario:minimal audio/webm;codecs=opus', 'what it is');
    eq(o.read.length, 4.5, 'how long it ran, by the recorder');
    eq(JSON.stringify(o.read.settings), JSON.stringify({ channelCount: 1, sampleRate: 48000 }), 'what the microphone gave');
    const v = o.read.marks[0].v;
    if (!v || o.read.marks.some((m) => m.v !== v)) throw new Error(`each mark names the deck's version: ${JSON.stringify(o.read.marks)}`);
    const notes = o.read.notes[v];
    if (!notes) throw new Error(`no script kept for version ${v}: ${JSON.stringify(Object.keys(o.read.notes))}`);
    eq(Object.keys(notes).join(' '), o.ids.join(' '), 'the script of every step');
    if (!/^This deck exists twice over/.test(notes[o.ids[0]])) throw new Error(`the first step's script is ${notes[o.ids[0]]}`);
  });

  check('recording: a data folder inside the talk is refused by name, and a take gone quiet does not hold the deck', () => {
    const r = recordRun();
    const o = result();
    eq(o.watched.status, 409, 'takes inside a folder the server watches are refused');
    if (!/watches/.test(o.watched.body) || !/SIPARIO_DATA/.test(o.watched.body)) throw new Error(`it said ${o.watched.body}`);
    eq(r.talkData.length, 0, 'and nothing was written into the talk');
    eq(o.stale.setAside, o.stale.quiet, 'a take gone quiet is set aside for the next, and named');
    if (!o.stale.next) throw new Error('the next take did not start');
    eq(r.unfinished, true, 'closing the server left the open take unfinished, its steps on disk');
    eq(`${o.openBefore.join(' ')} -> ${o.openAfter.join(' ')}`, '1 -> 0', 'the server\'s close let go of the take it held open');
    if (r.status === null) throw new Error(`the process did not end by itself (${r.signal}): a take held it open`);
  });

  check('recording: the export serves the talk with no take routes', () => {
    /* A server that exists to be photographed accepts nothing, and its
       listener is on every interface when there is no room. */
    if (!/serve\([^)]*record: false/.test(fs.readFileSync(path.join(ROOT, 'lib/export.js'), 'utf8'))) {
      throw new Error('the export serves the talk without saying `record: false`');
    }
  });
}

{
  /* What goes wrong on the server's side of a take, in a process of its
     own: a fault that killed the server would kill a probe shared with
     the checks above, and say nothing about which. A disk refusing a
     write is stood in for by a folder where the file would go, which no
     owner of the folder can write over, root included. */
  let ran = null;
  const faultRun = () => {
    if (ran) return ran;
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-faults-'));
    const t = path.join(dir, 'talk');
    fs.cpSync(TALK.dir, t, { recursive: true });
    const data = path.join(dir, 'data');
    const afile = path.join(dir, 'afile');
    fs.writeFileSync(afile, 'a file, where a folder was wanted');
    const probe = `
      process.env.SIPARIO_DATA = ${JSON.stringify(data)};
      const fs = require('fs'), path = require('path'), http = require('http');
      const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
      const record = require(${JSON.stringify(path.join(ROOT, 'lib/record.js'))});
      const video = require(${JSON.stringify(path.join(ROOT, 'lib/video.js'))});
      const { sessionId } = require(${JSON.stringify(path.join(ROOT, 'lib/relay.js'))});
      const quiet = { log(){}, warn(){}, error(){} };
      const up = (srv) => new Promise((ok) => (srv.listening ? ok() : srv.once('listening', ok)));
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const ask = (port, p, body, headers = {}, method = 'POST') => new Promise((ok) => {
        let status = 0, text = '';
        const q = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (r) => {
          status = r.statusCode;
          r.on('data', (c) => { text += c; });
          r.on('end', () => ok({ status, body: text }));
        });
        q.on('error', (e) => ok({ status, body: text || e.message }));
        q.end(body);
      });
      (async () => {
        const out = {};
        const s = serve(${JSON.stringify(t)}, { port: 0, log: quiet, audience: false, remote: false });
        await up(s);
        const P = s.address().port;
        const json = (p, o) => ask(P, p, JSON.stringify(o), { 'content-type': 'application/json' });
        const chunk = (take, seq, body) => ask(P, '/record/chunk?take=' + take + '&seq=' + seq, body, { 'content-type': 'application/octet-stream' });
        const alive = async () => (await ask(P, '/', undefined, {}, 'GET')).status;
        const start = { mime: 'audio/webm;codecs=opus' };
        const ids = require(${JSON.stringify(path.join(ROOT, 'lib/export.js'))}).outline(
          fs.readFileSync(${JSON.stringify(path.join(t, 'deck.md'))}, 'utf8'), require(${JSON.stringify(path.join(ROOT, 'lib/talk.js'))}).talk(${JSON.stringify(t)})).map((x) => x.id);
        const tdir = video.takesDir('sipario:minimal');

        /* A data folder under a file. */
        process.env.SIPARIO_DATA = path.join(${JSON.stringify(afile)}, 'sub');
        out.underFile = await json('/record/start', start);
        out.underFile.alive = await alive();
        process.env.SIPARIO_DATA = ${JSON.stringify(data)};

        /* A take begun in a second that already holds one sorting late. */
        for (let k = 0; k < 6; k++) fs.mkdirSync(path.join(tdir, sessionId(new Date(Date.now() + k * 1000)).slice(0, 15) + '-zzzy'), { recursive: true });
        const a = JSON.parse((await json('/record/start', start)).body).take;
        out.sameSecond = a;

        /* The first slice sent again, its answer lost. */
        out.zero = [(await chunk(a, 0, 'AAAA')).status, await chunk(a, 0, 'AAAA')];
        out.zeroFile = fs.readFileSync(path.join(tdir, a, 'take.webm'), 'utf8');

        /* The steps, refused by the disk, then taken once it has room. */
        out.mark0 = (await json('/record/marks', { take: a, from: 0, marks: [{ id: ids[0], t: 0 }] })).status;
        fs.mkdirSync(path.join(tdir, a, 'marks.partial.json.tmp'));
        out.markFull = await json('/record/marks', { take: a, from: 1, marks: [{ id: ids[1], t: 1 }] });
        out.markFull.alive = await alive();
        fs.rmdirSync(path.join(tdir, a, 'marks.partial.json.tmp'));
        out.markRoom = JSON.parse((await json('/record/marks', { take: a, from: 1, marks: [{ id: ids[1], t: 1 }] })).body);

        /* The finish, refused by the disk, then sent again. */
        fs.mkdirSync(path.join(tdir, a, 'take.json.tmp'));
        out.finishFull = await json('/record/finish', { take: a });
        out.finishFull.alive = await alive();
        fs.rmdirSync(path.join(tdir, a, 'take.json.tmp'));
        out.finishRoom = JSON.parse((await json('/record/finish', { take: a })).body);

        /* A take set aside while one of its slices is still arriving. */
        record.LIMITS.stale = 100;
        const b = JSON.parse((await json('/record/start', start)).body).take;
        const held = new Promise((ok) => {
          let status = 0, text = '';
          const q = http.request({ host: '127.0.0.1', port: P, method: 'POST', path: '/record/chunk?take=' + b + '&seq=0',
            headers: { 'content-type': 'application/octet-stream', 'content-length': 20 } }, (r) => {
            status = r.statusCode;
            r.on('data', (c) => { text += c; });
            r.on('end', () => ok({ status, body: text }));
          });
          q.on('error', (e) => ok({ status, body: text || e.message }));
          q.write('BBBB');
          out.finishHeld = () => q.end('BBBBBBBBBBBBBBBB');
        });
        await wait(250);
        const c = JSON.parse((await json('/record/start', start)).body);
        out.finishHeld();
        out.held = await held;
        out.setAside = { b, c: c.take, aside: c.setAside, next: (await chunk(c.take, 0, 'CCCC')).status,
                         bFile: fs.readFileSync(path.join(tdir, b, 'take.webm'), 'utf8'),
                         cFile: fs.readFileSync(path.join(tdir, c.take, 'take.webm'), 'utf8') };
        record.LIMITS.stale = 30 * 1000;

        /* A take the notes gave up on is set aside at once, and only that one. */
        out.gaveUp = JSON.parse((await json('/record/start', { ...start, gaveUp: c.take })).body);
        out.notGaveUp = await json('/record/start', { ...start, gaveUp: 'some-other-take' });

        const closed = new Promise((ok) => s.once('close', ok));
        s.close();
        if (s.closeAllConnections) s.closeAllConnections();
        await closed;
        delete out.finishHeld;
        console.log(JSON.stringify(out));
      })().catch((e) => { console.log(JSON.stringify({ error: e.stack })); process.exit(0); });
    `;
    const r = require('child_process').spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 30000 });
    try { ran = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { ran = { error: `the server ended (${r.status}): ${r.stderr.trim().split('\n').slice(0, 3).join(' / ')}` }; }
    if (!ran.error) ran.exit = r.status;
    fs.rmSync(dir, { recursive: true, force: true });
    return ran;
  };
  const faults = () => {
    const o = faultRun();
    if (o.error) throw new Error(o.error);
    return o;
  };

  check('recording: a disk that refuses a take\'s start, steps or finish is answered by name, and the server stays up', () => {
    const o = faults();
    eq(o.underFile.status, 500, 'a data folder under a file refuses the start');
    if (!/could not be kept/.test(o.underFile.body) || !/ENOTDIR/.test(o.underFile.body)) throw new Error(`it said ${o.underFile.body}`);
    eq(o.underFile.alive, 200, 'and the deck is still served');
    eq(o.mark0, 200, 'a step is kept');
    eq(o.markFull.status, 500, 'a step the disk will not take is refused');
    if (!/steps could not be written/.test(o.markFull.body)) throw new Error(`it said ${o.markFull.body}`);
    eq(o.markFull.alive, 200, 'and the deck is still served');
    eq(o.markRoom.have, 2, 'sent again once there is room, it is kept, and the refused one was not counted');
    eq(o.finishFull.status, 500, 'a finish the disk will not take is refused');
    if (!/could not be finished/.test(o.finishFull.body)) throw new Error(`it said ${o.finishFull.body}`);
    eq(o.finishFull.alive, 200, 'and the deck is still served');
    eq(`${o.finishRoom.ok} ${o.finishRoom.marks}`, 'true 2', 'the take was still open, and a finish sent again keeps it');
    eq(o.exit, 0, 'the server ended when it was closed, and not before');
  });

  check('recording: the first slice sent again is taken once, and a slice still arriving when its take is set aside writes nothing', () => {
    const o = faults();
    eq(`${o.zero[0]} ${o.zero[1].status} ${JSON.parse(o.zero[1].body).again}`, '200 200 true', 'the first slice sent again is answered as had');
    eq(o.zeroFile, 'AAAA', 'and is in the file once, one header');
    eq(o.setAside.aside, o.setAside.b, 'the quiet take was set aside while its slice arrived');
    eq(o.held.status, 409, 'that slice is refused once it has arrived');
    if (!/set aside while this slice arrived/.test(o.held.body)) throw new Error(`it said ${o.held.body}`);
    eq(o.setAside.next, 200, 'the next take takes its own first slice');
    eq(`${JSON.stringify(o.setAside.bFile)} ${JSON.stringify(o.setAside.cFile)}`, '"" "CCCC"',
      'and the late slice is in neither file, the next take\'s audio its own');
  });

  check('recording: a take begun in the same second as another is named to sort after it, and a take the notes gave up on does not hold the deck', () => {
    const o = faults();
    const id = o.sameSecond;
    if (!(id > `${id.slice(0, 15)}-zzzy`)) throw new Error(`take ${id} sorts before one begun earlier in its second`);
    if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(id)) throw new Error(`the take is named ${id}`);
    if (!o.gaveUp.ok || !o.gaveUp.take) throw new Error(`the take after one given up on did not start at once: ${JSON.stringify(o.gaveUp)}`);
    eq(o.gaveUp.setAside, o.setAside.c, 'the take given up on is set aside, and named');
    eq(o.notGaveUp.status, 409, 'naming some other take sets nothing aside');
    if (!/already recording/.test(o.notGaveUp.body) || !/quiet for 30s/.test(o.notGaveUp.body)) throw new Error(`it said ${o.notGaveUp.body}`);
  });
}

{
  /* The notes window's half of a take, in a page with no microphone and
     no server: the real notes page, its real scripts, and the browser's
     recorder, microphone, audio and fetch stood in for, so what is under
     test is what the recorder does with them. Run in a process of its
     own, because a take is promises from end to end and a check here is
     not; and with a clock the probe holds, so a moment the deck stamps
     and the moment the take began are numbers it chose. */
  const page = pagesLib.presenterPage(MOVES_DECK, 9999, 'v1').replace(/<script[^>]*><\/script>/g, '');
  let ran = null;
  const notesRun = () => {
    if (ran) return ran;
    const probe = `
      const fs = require('fs'), path = require('path');
      const { JSDOM, VirtualConsole } = require(${JSON.stringify(require.resolve('jsdom'))});
      const read = (f) => fs.readFileSync(path.join(${JSON.stringify(ROOT)}, f), 'utf8');
      const PAGE = ${JSON.stringify(page)};
      const KEY = ${JSON.stringify(MOVES_DECK.deck.key)};
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      function makeBus() {
        const peers = [];
        return function Channel(name) {
          this.name = name; this.onmessage = null;
          this.close = () => { const i = peers.indexOf(this); if (i > -1) peers.splice(i, 1); };
          this.postMessage = (data) => {
            for (const p of peers.slice()) if (p !== this && p.name === this.name && p.onmessage) p.onmessage({ data });
          };
          peers.push(this);
        };
      }
      /* One window, and everything it would reach for, logged in one
         sequence so an order can be asserted. */
      function notes(url, parent) {
        const log = [], errors = [], recorders = [], asked = [];
        const con = new VirtualConsole();
        con.on('jsdomError', (e) => errors.push(String((e.detail && e.detail.stack) || e.message)));
        const dom = new JSDOM(PAGE, { runScripts: 'outside-only', pretendToBeVisual: true, url, virtualConsole: con });
        const w = dom.window;
        const Bus = makeBus();
        const clock = { now: 0, origin: 1000, date: 0, level: 0.2 };
        w.BroadcastChannel = Bus;
        w.EventSource = function () { this.addEventListener = () => {}; this.close = () => {}; };
        Object.defineProperty(w, 'performance', { value: { get timeOrigin() { return clock.origin; }, now: () => clock.now }, configurable: true });
        const realNow = w.Date.now;
        w.Date.now = () => realNow() + clock.date;
        if (parent) w.parent = parent;
        let takes = 0;
        /* ctl.refuse names a route the server answers 409 on. An answer is
           logged as it arrives, as well as the request as it goes, so an
           order can be asserted against answers too. */
        const ctl = { refuse: null };
        w.fetch = (u, o) => {
          const body = o && o.body;
          const entry = { url: u.replace(/\\?.*$/, ''), query: u.split('?')[1] || '' };
          if (typeof body === 'string') entry.body = JSON.parse(body);
          else if (body) entry.slice = body.tag;
          log.push(entry);
          const p = entry.url;
          const b = entry.body || {};
          const answer = p === '/record/start' ? { ok: true, take: 'take-' + (++takes), audio: 'take.webm' }
            : p === '/record/chunk' ? { ok: true }
            : p === '/record/marks' ? { ok: true, have: b.from + b.marks.length }
            : p === '/record/finish' ? { ok: true, take: b.take, marks: 0 }
            : null;
          if (!answer) return Promise.reject(new Error('no network in a test'));
          const refused = ctl.refuse === p;
          return wait(1).then(() => {
            log.push({ answered: p === '/record/chunk' ? 'chunk:' + entry.slice : p });
            return { ok: !refused, status: refused ? 409 : 200,
                     text: () => Promise.resolve(JSON.stringify(refused ? { ok: false, error: 'refused here' } : answer)) };
          });
        };
        const track = { stopped: 0, getSettings: () => ({ channelCount: 1, sampleRate: 48000 }), stop() { this.stopped++; } };
        Object.defineProperty(w.navigator, 'mediaDevices', { configurable: true, value: {
          getUserMedia: (c) => { asked.push(c); log.push({ url: 'getUserMedia' }); return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] }); },
        } });
        function MediaRecorder(stream, opts) { this.mimeType = opts.mimeType; this.state = 'inactive'; recorders.push(this); }
        MediaRecorder.isTypeSupported = (t) => t === 'audio/webm;codecs=opus';
        MediaRecorder.prototype.start = function (ts) { this.state = 'recording'; this.timeslice = ts; this.at = clock.now; };
        MediaRecorder.prototype.slice = function (tag) { const b = new w.Blob([tag]); b.tag = tag; this.ondataavailable({ data: b }); };
        MediaRecorder.prototype.stop = function () {
          this.state = 'inactive';
          setTimeout(() => { this.slice('last'); this.onstop(); }, 1);
        };
        /* An error, as the recorder raises one: inactive at once, the error
           said, and its last slice and its stop only after. */
        MediaRecorder.prototype.fail = function () {
          this.state = 'inactive';
          this.onerror({ error: { name: 'EncodingError' } });
          setTimeout(() => { this.slice('tail'); this.onstop(); }, 1);
        };
        w.MediaRecorder = MediaRecorder;
        w.AudioContext = function () {
          this.state = 'running';
          this.resume = () => {};
          this.createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData: (buf) => buf.fill(clock.level) });
          this.createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
        };
        for (const f of ['js/events.js', 'js/presenter.js', 'js/recorder.js']) w.eval(read(f));
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
        const deck = new Bus(KEY);
        deck.onmessage = (e) => { if (e.data.from === 'presenter') log.push({ bus: e.data.type }); };
        const state = (id, at, more = {}) => deck.postMessage({ from: 'deck', type: 'state', tab: 'T', g: 0, s: 0, y: 0, v: 'v1', id, at, ...more });
        const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
        const $ = (id) => w.document.getElementById(id);
        return { w, log, errors, recorders, asked, clock, track, deck, state, key, $, ctl };
      }
      (async () => {
        const out = {};
        const n = notes('http://localhost:9999/presenter?tab=T');
        const { clock, state, key, $, log } = n;
        state('first', 400);
        out.ui = { button: $('rec-btn') && $('rec-btn').textContent, inSide: !!$('side').querySelector('#rec'),
                   bar: !!$('notes-bar').querySelector('#rec-on') && !!$('notes-bar').querySelector('#rec-alert') };

        /* V from the deck before any take: no gesture here, so it says so. */
        n.deck.postMessage({ from: 'deck', type: 'panel', tab: 'T', key: 'v' });
        await wait(5);
        out.forwardedFirst = { note: $('timer-note').textContent, asked: n.asked.length };

        /* The first take, from V pressed here. */
        clock.now = 10000;
        key('V');
        await wait(20);
        const anchor = clock.origin + clock.now;
        out.started = { button: $('rec-btn').textContent, rec: $('rec-on').textContent, recording: n.w.document.body.classList.contains('recording'),
                        constraints: n.asked[0], timeslice: n.recorders[0] && n.recorders[0].timeslice, mime: n.recorders[0] && n.recorders[0].mimeType };
        state('b', anchor + 1000);
        state('b', anchor + 1000);                       // said again: a hello, the map toggled
        state('c', anchor + 1010);                       // a 10 ms flash
        state('elsewhere', anchor + 1500, { tab: 'OTHER' });   // another deck window's
        state('b', anchor + 2500.4);
        state(undefined, anchor + 2600);                 // a deck that does not say its step
        n.recorders[0].slice('s0');
        await wait(20);
        clock.now = 13000;
        key('v');
        await wait(30);
        out.first = { log: log.slice(), stopped: n.track.stopped, button: $('rec-btn').textContent,
                      recording: n.w.document.body.classList.contains('recording'), note: $('timer-note').textContent };
        log.length = 0;

        /* The second, from V forwarded by the deck: allowed now. */
        state('d', clock.origin + 15000);
        clock.now = 20000;
        n.deck.postMessage({ from: 'deck', type: 'panel', tab: 'T', key: 'v' });
        await wait(20);
        out.forwardedAfter = { asked: n.asked.length, button: $('rec-btn').textContent };
        /* The level: silence for longer than two seconds, and enough
           readings to say so, is said in the bar; sound clears it. */
        clock.level = 0;
        await wait(200);
        clock.date = 5000;
        await wait(1500);
        out.silent = $('rec-alert').textContent;
        clock.level = 0.4;
        await wait(400);
        out.heard = $('rec-alert').textContent;

        /* N, the notes' own close, while it records: asked first. */
        key('N');
        await wait(10);
        out.asked = { note: $('timer-note').textContent, closed: log.some((e) => e.bus === 'close') };
        key('N');
        await wait(40);
        out.second = { log: log.slice() };
        out.errors = n.errors;

        /* Docked: the control that moves the notes to where takes are made. */
        const parent = { moved: 0, __toggleDetached() { this.moved++; } };
        const d = notes('http://localhost:9999/presenter?tab=T', parent);
        d.state('first', 400);
        d.$('rec-btn').dispatchEvent(new d.w.MouseEvent('click', { bubbles: true }));
        d.key('V');
        out.dock = { button: d.$('rec-btn').textContent, moved: parent.moved, note: d.$('timer-note').textContent,
                     asked: d.asked.length, bar: !!d.$('rec-on'), errors: d.errors };

        /* Opened by hand, for no deck window in particular: nothing. */
        const h = notes('http://localhost:9999/presenter');
        out.hand = { rec: !!h.$('rec'), errors: h.errors };

        /* A third window: a take stopped by V from the deck, one whose
           recorder fails mid-take, and one the server stops taking. */
        const f = notes('http://localhost:9999/presenter?tab=T');
        const seen = (l) => l.map((e) => e.answered ? 'answered ' + e.answered
          : e.url === '/record/chunk' ? 'chunk:' + e.slice : e.url || e.bus);
        f.state('first', 400);
        f.clock.now = 30000;
        f.key('V');
        await wait(20);
        f.recorders[0].slice('s0');
        await wait(10);
        f.log.length = 0;
        f.deck.postMessage({ from: 'deck', type: 'panel', tab: 'T', key: 'v' });
        await wait(40);
        out.forwardedStop = { log: seen(f.log), button: f.$('rec-btn').textContent };

        /* The rest needs that take stopped. */
        if (out.forwardedStop.button === 'record') {
          f.log.length = 0;
          f.key('V');
          await wait(20);
          f.recorders[1].slice('s0');
          await wait(10);
          f.recorders[1].fail();
          await wait(60);
          out.failed = { log: seen(f.log), alert: f.$('rec-alert').textContent, note: f.$('timer-note').textContent,
                         button: f.$('rec-btn').textContent };

          f.log.length = 0;
          f.ctl.refuse = '/record/chunk';
          f.key('V');
          await wait(20);
          f.recorders[2].slice('s0');
          await wait(60);
          f.ctl.refuse = null;
          out.lost = { alert: f.$('rec-alert').textContent, button: f.$('rec-btn').textContent };
          f.key('V');
          await wait(20);
          out.lost.starts = f.log.filter((e) => e.url === '/record/start').map((e) => e.body.gaveUp);
          out.lost.button2 = f.$('rec-btn').textContent;
        }
        out.thirdErrors = f.errors;
        console.log(JSON.stringify(out));
        process.exit(0);
      })().catch((e) => { console.log(JSON.stringify({ error: e.stack })); process.exit(0); });
    `;
    const r = require('child_process').spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 30000 });
    try { ran = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { ran = { error: `no output (${r.status}): ${r.stdout} ${r.stderr}` }; }
    return ran;
  };
  const notesOut = () => {
    const o = notesRun();
    if (o.error) throw new Error(o.error);
    return o;
  };

  check('recording: the notes window records from V, with the browser\'s processing off, and marks the step it opens on', () => {
    const o = notesOut();
    eq(`${o.ui.button} ${o.ui.inSide} ${o.ui.bar}`, 'record true true', 'a record button by the clock, and a place in the bar');
    eq(o.forwardedFirst.asked, 0, 'V from the deck before any take starts nothing');
    if (!/Press V here, in the notes window/.test(o.forwardedFirst.note)) throw new Error(`it said ${o.forwardedFirst.note}`);
    eq(`${o.started.button} ${o.started.recording}`, 'stop true', 'V pressed here starts a take');
    if (!/^REC/.test(o.started.rec)) throw new Error(`the bar says ${o.started.rec}`);
    const a = o.started.constraints && o.started.constraints.audio;
    eq(JSON.stringify(a), JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } }), 'the microphone asked for unprocessed, mono, 48 kHz');
    eq(`${o.started.mime} ${o.started.timeslice}`, 'audio/webm;codecs=opus 5000', 'Opus in WebM, a slice every five seconds');
    const start = o.first.log.find((e) => e.url === '/record/start');
    eq(JSON.stringify(start.body.settings), JSON.stringify({ channelCount: 1, sampleRate: 48000 }), 'what the microphone gave is sent with the start');
    eq(start.body.mime, 'audio/webm;codecs=opus', 'and what the recorder makes');
  });

  check('recording: every change of step is a mark, a 10 ms flash included, timed from the deck\'s stamp; only repeats are dropped', () => {
    const o = notesOut();
    const sent = o.first.log.filter((e) => e.url === '/record/marks').map((e) => e.body);
    /* Sent as they happen, each batch from where the server's copy ends. */
    let have = 0;
    const all = [];
    for (const b of sent) { eq(b.from <= have, true, 'no batch starts past the server\'s copy'); all.splice(b.from, b.marks.length, ...b.marks); have = all.length; }
    eq(all.map((m) => `${m.id}@${m.t}`).join(' '), 'first@0 b@1 c@1.01 b@2.5',
      'the step on screen at the start, then each change, from the stamp, to the millisecond');
    eq(all.every((m) => m.v === 'v1'), true, 'each naming the version of the deck that showed it');
    if (sent.length < 2) throw new Error('the marks went in one batch at the end, not as they happened');
  });

  check('recording: slices go in order as they come, and the take is finished only after the last of them', () => {
    const o = notesOut();
    const seen = o.first.log.filter((e) => !e.answered)
      .map((e) => (e.url === '/record/chunk' ? `chunk:${e.slice}:${e.query.split('seq=')[1]}` : e.url));
    const chunks = seen.filter((x) => x.startsWith('chunk:'));
    eq(chunks.join(' '), 'chunk:s0:0 chunk:last:1', 'each slice once, numbered in order, the last one too');
    eq(seen[seen.length - 1], '/record/finish', 'finished last');
    /* Not only sent after the last slice: sent once that slice's answer
       has come back, or the server can meet the finish first. */
    const order = o.first.log.map((e) => (e.answered ? `answered ${e.answered}` : e.url === '/record/chunk' ? `chunk:${e.slice}` : e.url));
    eq(order.indexOf('answered chunk:last') > -1 && order.indexOf('answered chunk:last') < order.indexOf('/record/finish'), true,
      `the finish waits for the last slice to be answered (${order.join(', ')})`);
    eq(seen.indexOf('/record/start') < seen.indexOf('chunk:s0:0'), true, 'started first');
    eq(o.first.log.find((e) => e.url === '/record/finish').body.length, 3, 'with how long it ran');
    eq(`${o.first.stopped} ${o.first.button} ${o.first.recording}`, '1 record false', 'the microphone let go, and ready for another');
    if (!/kept/.test(o.first.note)) throw new Error(`it did not say the take was kept: ${o.first.note}`);
  });

  check('recording: after the first take V from the deck starts and stops one, and silence on the input is said in the bar', () => {
    const o = notesOut();
    eq(`${o.forwardedAfter.asked} ${o.forwardedAfter.button}`, '2 stop', 'V from the deck started the second take');
    eq(o.forwardedStop.log.filter((x) => !x.startsWith('answered')).join(' '), 'chunk:last /record/finish',
      'V from the deck stopped a take: its last slice, then the finish');
    eq(o.forwardedStop.button, 'record', 'and the notes are ready for another');
    if (!/No sound/.test(o.silent)) throw new Error(`two seconds of silence said nothing: "${o.silent}"`);
    eq(o.heard, '', 'and sound clears it');
  });

  check('recording: the notes\' own close asks while a take records, and closes only once the take is finished', () => {
    const o = notesOut();
    if (!/A take is recording\. Press again/.test(o.asked.note)) throw new Error(`the first press said ${o.asked.note}`);
    eq(o.asked.closed, false, 'the first press closes nothing');
    const seen = o.second.log.map((e) => e.bus || e.url);
    const fin = seen.lastIndexOf('/record/finish');
    if (fin < 0) throw new Error(`the take was not finished: ${seen.join(' ')}`);
    eq(seen.indexOf('close') > fin, true, 'the second finishes the take, then closes the notes');
    eq(o.errors.length, 0, `no errors in the page (${o.errors[0]})`);
  });

  check('recording: a recorder that fails hands over its last slice before the take is finished', () => {
    const o = notesOut();
    if (!o.failed) throw new Error('not run: V from the deck did not stop the take before it');
    const l = o.failed.log;
    const tail = l.indexOf('answered chunk:tail');
    if (tail < 0) throw new Error(`the last slice was never sent: ${l.join(', ')}`);
    eq(tail < l.indexOf('/record/finish'), true, `finished only once the last slice had arrived (${l.join(', ')})`);
    if (!/The recorder failed \(EncodingError\)/.test(o.failed.alert)) throw new Error(`the bar says ${o.failed.alert}`);
    if (!/kept/.test(o.failed.note)) throw new Error(`it did not say the take was kept: ${o.failed.note}`);
    eq(o.failed.button, 'record', 'and the notes are ready for another');
    eq(o.thirdErrors.length, 0, `no errors in the page (${o.thirdErrors[0]})`);
  });

  check('recording: a take the server stops taking is named with the next start, so it does not hold the deck', () => {
    const o = notesOut();
    if (!o.lost) throw new Error('not run: V from the deck did not stop the take before it');
    if (!/not reaching sipario \(refused here\)/.test(o.lost.alert)) throw new Error(`the bar says ${o.lost.alert}`);
    eq(o.lost.button, 'record', 'the take ended');
    eq(JSON.stringify(o.lost.starts), JSON.stringify([null, 'take-3']), 'the next start names the take given up on');
    eq(o.lost.button2, 'stop', 'and V starts the next take straight away');
  });

  check('recording: docked, the notes offer to detach to record, and a window opened by hand records nothing', () => {
    const o = notesOut();
    eq(o.dock.button, 'Detach to record', 'the dock\'s control');
    eq(o.dock.moved, 1, 'which moves the notes by the path D takes');
    eq(`${o.dock.asked} ${o.dock.bar}`, '0 false', 'no microphone asked for in the dock');
    if (!/own window/.test(o.dock.note)) throw new Error(`V in the dock said ${o.dock.note}`);
    eq(o.dock.errors.length, 0, `no errors in the dock (${o.dock.errors[0]})`);
    eq(o.hand.rec, false, 'nothing to record with in a window that follows no deck in particular');
    const device = pagesLib.presenterPage(MOVES_DECK, 9999, 'v1', 'device');
    const here = pagesLib.presenterPage(MOVES_DECK, 9999, 'v1', 'notes');
    eq(device.includes('/js/recorder.js'), false, 'the notes on another device never load the recorder');
    if (!/<script src="\/js\/presenter\.js"><\/script>\s*<script src="\/js\/recorder\.js"><\/script>/.test(here)) {
      throw new Error('the notes on this machine do not load the recorder after the notes');
    }
  });
}

{
  check('takes: a deck\'s takes are listed oldest first by kind, and recover finishes one a recording left unfinished', () => {
    /* Four takes written as the server leaves them: one finished, one
       left unfinished an hour ago, one that stopped before a step was
       marked, and one written to a moment ago, which may still be
       recording. The CLI run as a reader would. */
    const video = require('./lib/video.js');
    const { spawnSync } = require('child_process');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-takes-'));
    const t = path.join(dir, 'talk');
    fs.cpSync(TALK.dir, t, { recursive: true });
    const data = path.join(dir, 'data');
    const env = { ...process.env, SIPARIO_DATA: data };
    const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/sipario.js'), 'takes', ...args],
      { cwd: dir, env, encoding: 'utf8', timeout: 25000 });
    const none = run(t);
    eq(none.status, 0, `an empty listing runs (${none.stderr.trim()})`);
    if (!/no takes of "Minimal"/.test(none.stdout)) throw new Error(`it said ${none.stdout}`);

    const root = video.takesDir('sipario:minimal', data);
    const hourAgo = (Date.now() - 3600 * 1000) / 1000;
    const write = (id, file, value, audio = 'AUDIO') => {
      fs.mkdirSync(path.join(root, id), { recursive: true });
      fs.writeFileSync(path.join(root, id, file), JSON.stringify(value));
      if (audio !== null) fs.writeFileSync(path.join(root, id, 'take.webm'), audio);
    };
    const mark = (id, t) => ({ id, t, v: '1' });
    write('20261001-090000-aaaa', 'take.json', { version: 1, kind: 'live', audio: 'take.webm', length: 65.4,
      marks: [mark('1-a-slide-of-every-template', 0), mark('2-the-keys', 20), mark('3-templates', 40)] });
    write('20261001-100000-bbbb', 'marks.partial.json', { version: 1, kind: 'live', audio: 'take.webm',
      marks: [mark('1-a-slide-of-every-template', 0), mark('2-the-keys', 3.5)], notes: {} });
    write('20261001-110000-cccc', 'marks.partial.json', { version: 1, kind: 'live', audio: 'take.webm', marks: [], notes: {} });
    for (const id of ['20261001-100000-bbbb', '20261001-110000-cccc']) {
      for (const f of fs.readdirSync(path.join(root, id))) fs.utimesSync(path.join(root, id, f), hourAgo, hourAgo);
    }
    write('20261001-120000-dddd', 'marks.partial.json', { version: 1, kind: 'live', audio: 'take.webm',
      marks: [mark('1-a-slide-of-every-template', 0)], notes: {} });

    const listed = run(t);
    eq(listed.status, 0, `it lists (${listed.stderr.trim()})`);
    const rows = listed.stdout.trim().split('\n').slice(1).filter((l) => l.trim()).map((l) => l.trim().split(/\s{3,}/));
    eq(rows.map((r) => r[0]).join(' '), '20261001-090000-aaaa 20261001-100000-bbbb 20261001-110000-cccc 20261001-120000-dddd', 'oldest first');
    eq(rows.map((r) => r[1]).join(' '), 'live unfinished unfinished unfinished', 'each by its kind');
    eq(`${rows[0][2]} ${rows[0][3]}`, '1:05 3 steps', 'a finished take by its length and its steps');
    eq(rows[1][4], 'sipario takes recover 20261001-100000-bbbb', 'an unfinished one says how to finish it');

    const ok = run('recover', '20261001-100000-bbbb', t);
    eq(ok.status, 0, `it recovers (${ok.stderr.trim()})`);
    if (!/2 steps, 5 bytes of audio/.test(ok.stdout)) throw new Error(`it said ${ok.stdout}`);
    const back = video.readTake('sipario:minimal', '20261001-100000-bbbb', data);
    eq(back.marks.map((m) => `${m.id}@${m.t}`).join(' '), '1-a-slide-of-every-template@0 2-the-keys@3.5', 'a take export video reads');
    eq(fs.existsSync(path.join(root, '20261001-100000-bbbb', 'marks.partial.json')), false, 'and no longer unfinished');
    if (!run(t).stdout.split('\n').some((l) => /20261001-100000-bbbb\s+live/.test(l))) throw new Error('the recovered take is not listed as live');

    for (const [id, why] of [['20261001-090000-aaaa', /finished already/], ['20261001-110000-cccc', /before a step was marked/],
      ['20261001-120000-dddd', /may still be recording/], ['no-such-take', /there is no take "no-such-take"; the takes kept are/]]) {
      const r = run('recover', id, t);
      eq(r.status, 1, `${id} is refused`);
      if (!why.test(r.stderr)) throw new Error(`${id}: it said ${r.stderr.trim()}`);
    }
    eq(run('recover').status, 2, 'recover with no take is the usage');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

{
  /* A take made by a real browser: Chrome, headless, with its stand-in
     microphone, recording in the notes page served by sipario, and the
     server keeping what it sends. The deck's positions are posted on the
     page's own channel, as a deck window on the same origin posts them.
     The one check here that a browser's MediaRecorder, its upload and the
     server agree on a file that decodes. */
  let browser = null;
  try { browser = findBrowser(); } catch { /* none here */ }
  /* Whether its audio decodes is ffmpeg's to say. Without it the take is
     still recorded and checked, under a name that claims no more, and the
     decoding is said not to have been run. */
  let ff = null;
  try { ff = require('./lib/video.js').findFfmpeg(); } catch { /* none here */ }
  const recorded = 'recording: in a real browser, a take of three steps is recorded, uploaded and finished';
  const name = ff ? `${recorded}, and its audio decodes` : recorded;
  if (!browser) {
    console.log(`  --    ${name}\n        not run: no browser on this machine to record with`);
  } else {
    if (!ff) console.log(`  --    recording: in a real browser, the take's audio decodes\n        not run: no ffmpeg on this machine`);
    check(name, () => {
      const video = require('./lib/video.js');
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sipario-take-'));
      const t = path.join(dir, 'talk');
      fs.cpSync(TALK.dir, t, { recursive: true });
      const data = path.join(dir, 'data');
      const ids = require('./lib/export.js').outline(fs.readFileSync(path.join(t, 'deck.md'), 'utf8'), talk(t)).map((s) => s.id);
      const probe = `
        process.env.SIPARIO_DATA = ${JSON.stringify(data)};
        const { serve } = require(${JSON.stringify(path.join(ROOT, 'lib/server.js'))});
        const { launch } = require(${JSON.stringify(path.join(ROOT, 'lib/browser.js'))});
        const up = (srv) => new Promise((ok) => (srv.listening ? ok() : srv.once('listening', ok)));
        (async () => {
          const s = serve(${JSON.stringify(t)}, { port: 0, log: { log(){}, warn(){}, error(){} }, audience: false, remote: false });
          await up(s);
          const b = await launch({ flags: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                           '--autoplay-policy=no-user-gesture-required'] });
          let out;
          try {
            await b.page.open('http://localhost:' + s.address().port + '/presenter?tab=T');
            out = await b.page.evaluate(\`(async () => {
              const ids = ${JSON.stringify(ids.slice(0, 3))};
              const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
              const until = async (fn, ms) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(50); return fn(); };
              const deck = document.getElementById('deck');
              const ch = new BroadcastChannel(deck.dataset.deck);
              const show = (id) => ch.postMessage({ from: 'deck', type: 'state', tab: 'T', g: 0, s: 0, y: 0,
                v: deck.dataset.version, id, at: performance.timeOrigin + performance.now() });
              show(ids[0]);
              await until(() => document.body.classList.contains('live'), 3000);
              const btn = document.getElementById('rec-btn');
              btn.click();
              const started = await until(() => btn.textContent === 'stop', 8000);
              await sleep(500); show(ids[1]);
              await sleep(500); show(ids[2]);
              await sleep(600);
              btn.click();
              const kept = await until(() => btn.textContent === 'record' && /kept/.test(document.getElementById('timer-note').textContent), 10000);
              return { started, kept, note: document.getElementById('timer-note').textContent,
                       alert: document.getElementById('rec-alert').textContent };
            })()\`);
          } catch (e) { out = { error: e.message }; }
          finally { await b.close(); s.close(); if (s.closeAllConnections) s.closeAllConnections(); }
          console.log(JSON.stringify(out));
          process.exit(0);
        })().catch((e) => { console.log(JSON.stringify({ error: e.stack })); process.exit(0); });
      `;
      const r = require('child_process').spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 60000 });
      let out;
      try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { out = { error: `no output (${r.status}): ${r.stderr.trim()}` }; }
      try {
        if (out.error) throw new Error(out.error);
        eq(out.started, true, `the take started (${out.alert})`);
        eq(out.kept, true, `and was kept (${out.alert || out.note})`);
        const take = video.readTake('sipario:minimal', null, data);
        eq(take.marks.map((m) => m.id).join(' '), ids.slice(0, 3).join(' '), 'its steps, in order');
        const ts = take.marks.map((m) => m.t);
        if (!(ts[0] === 0 && ts[1] > 0.3 && ts[2] - ts[1] > 0.3 && ts[2] < 2.5)) throw new Error(`the steps fall at ${ts.join(', ')}s`);
        eq(/^audio\/webm/.test(take.mime) && take.audio === 'take.webm', true, `recorded as WebM (${take.mime})`);
        if (!take.settings || typeof take.settings.sampleRate !== 'number') throw new Error(`no microphone settings kept: ${JSON.stringify(take.settings)}`);
        if (ff) {
          const len = video.durationOf(take.audioFile, ff);
          if (!(len > 1.2 && len < 3.5)) throw new Error(`the audio runs ${len}s for a take of about 1.6s`);
        } else if (!(fs.statSync(take.audioFile).size > 1000)) {
          throw new Error('the audio file is all but empty');
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

/* And everything true of any talk, run over both this repo ships: the
   fixture, and the same deck in its theatre-bill dress, which is a talk
   like any other and rots like one if nothing renders it. */
for (const { name, fn } of talkChecks(TALK)) check(name, fn);
for (const { name, fn } of talkChecks(talk(path.join(ROOT, 'starters/stylish')))) {
  check(`stylish: ${name}`, fn);
}

console.log(failures ? `\n${failures} failing` : '\nall checks passed');
process.exit(failures ? 1 : 0);
