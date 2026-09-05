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
  window.EventSource = function () { this.close = () => {}; };   // no server in a test
  window.open = () => ({ closed: false, focus() {}, close() { this.closed = true; } });
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  const doc = window.document;
  const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k }));
  return {
    window, doc, errors,
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
  window.eval(js);
  if (errors.length) throw new Error(errors[0].detail || errors[0].message);
});

check('and runs on a deck of three movements', () => {
  MOVES.window.eval(js);
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
  eq(doc.body.classList.contains('minimap'), false, 'off until asked for');
  key('m');
  eq(doc.body.classList.contains('minimap'), true, 'M shows it');
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
  /* `n` reads forward across movements; the arrows stop at the end of
     one, which is the distinction the two axes exist for. */
  while (current() !== build.children[1]) {
    const was = current();
    key('n');
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
  /* Escaping runs before the markers are applied, so the emphasis pass
     can only ever see text it already made safe. */
  const out = scriptOf('Careful: <script>alert(1)</script> and **<b>bold</b>**.');
  eq(/<script>/.test(out), false, 'the script tag did not survive');
  eq(/&lt;script&gt;/.test(out), true, 'it was escaped instead');
  eq(/<strong>&lt;b&gt;bold&lt;\/b&gt;<\/strong>/.test(out), true,
     'emphasis still applied around the escaped text');
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
  const peers = [];
  return function Channel() {
    this.onmessage = null;
    this.onmessageerror = null;
    this.close = () => {};
    this.postMessage = (data) => {
      for (const p of peers) if (p !== this && p.onmessage) p.onmessage({ data });
    };
    peers.push(this);
  };
}

function windowFor(body, scripts, Bus) {
  const errs = [];
  const con = new VirtualConsole();
  con.on('jsdomError', (e) => errs.push(e));
  const d = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true,
      url: 'http://localhost:9999/', virtualConsole: con });
  d.window.BroadcastChannel = Bus;
  d.window.EventSource = function () { this.close = () => {}; };
  d.window.open = () => ({ closed: false, focus() {}, close() { this.closed = true; } });
  Object.defineProperty(d.window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(d.window, 'innerHeight', { value: 900, configurable: true });
  for (const src of scripts) d.window.eval(src);
  if (errs.length) throw new Error(errs[0].detail || errs[0].message);
  return d.window;
}

const presenterJs = fs.readFileSync(path.join(ROOT, 'js/presenter.js'), 'utf8');
const deckBody = `${MOVES_MAIN}
  <div id="progress"><div id="progress-bar"></div></div>`;
const presenterBody = `${MOVES_MAIN}
  <div id="wrap">
    <div class="shot-box" id="now"></div>
    <div id="attach-row"><button id="attach-btn"></button><span id="attach-note"></span></div>
    <div id="clock">00:00</div><button id="timer-btn"></button><p id="timer-note"></p>
    <div id="group"></div><div id="where"></div><div id="dots"></div>
    <div class="shot-box" id="next"></div><p id="next-label"></p>
    <div id="notes"></div>
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

check('the presenter shows where the deck is', () => {
  const where = presWin.document.getElementById('where').textContent;
  if (!/Slide 1\.1/.test(where)) throw new Error(`reads "${where}"`);
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
  if (!/Slide 3\.1/.test(presWin.document.getElementById('where').textContent)) {
    throw new Error('position did not follow to the last slide');
  }
});

check('the presenter previews the real slide, not a copy of it', () => {
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Home' }));
  const shot = presWin.document.querySelector('#now .slide.shot');
  if (!shot) throw new Error('no preview rendered');
  if (shot.querySelector('.notes')) throw new Error('the preview still carries its notes');
  eq(shot.querySelector('h1').textContent,
     deckWin.document.querySelector('.slide.current h1').textContent, 'preview heading');
});

check('the presenter names the group it is in', () => {
  eq(presWin.document.getElementById('group').textContent, '1  Title', 'group at slide 1');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'End' }));
  eq(presWin.document.getElementById('group').textContent, '3  Close', 'group at the end');
  deckWin.document.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Home' }));
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

check('P docks the notes, and they are the presenter page itself', () => {
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  eq(d.body.classList.contains('docked'), true, 'docked after P');
  const frame = d.getElementById('dock-frame');
  if (!frame) throw new Error('no iframe in the dock');
  eq(frame.getAttribute('src'), '/presenter',
     'the dock shows the presenter page, so the two cannot drift apart');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  eq(d.body.classList.contains('docked'), false, 'P again hides them');
});

check('the deck makes room for the docked notes', () => {
  const d = deckWin.document;
  const at = () => d.querySelector('.slide.current').style;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  const on = at().getPropertyValue('--k');
  const left = at().left;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  const off = at().getPropertyValue('--k');
  if (Number(on) >= Number(off)) {
    throw new Error(`docking did not shrink the deck: ${on} then ${off}`);
  }
  if (left === '50%') throw new Error('the deck stayed centred under the panel');
  eq(at().left, '50%', 'and it re-centres when the notes close');
});

check('D moves the notes to a window and back', () => {
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  eq(d.body.classList.contains('docked'), true, 'docked to start');

  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), false, 'detaching undocks');

  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), true, 'and D again brings them back');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
});

check('the detached window can put the notes back', () => {
  /* The mirror of the dock's detach button. Without it the only way home
     is to go and find the deck window, which is the one you have just
     pushed onto a projector. */
  const d = deckWin.document;
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Escape' }));
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(d.body.classList.contains('docked'), false, 'detached to start');
  eq(deckWin.__detached(), true, 'and the window is open');

  presWin.document.getElementById('attach-btn').dispatchEvent(
    new presWin.MouseEvent('click', { bubbles: true }));
  eq(d.body.classList.contains('docked'), true, 'attach docked them again');
  eq(deckWin.__detached(), false, 'and closed the window');
});

check('A in the detached window attaches too', () => {
  const d = deckWin.document;
  newPresenter();                       // the last check closed the previous one
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'd' }));
  eq(deckWin.__detached(), true, 'detached');
  presWin.document.dispatchEvent(new presWin.KeyboardEvent('keydown', { key: 'a' }));
  eq(d.body.classList.contains('docked'), true, 'A docked them');
  eq(deckWin.__detached(), false, 'and closed the window');
  d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'p' }));
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
  eq(/#wrap \{[^}]*grid-template-columns:\s*1fr minmax\(/.test(pcss), true,
     'the rail shrinks with the panel rather than sitting at a fixed width');
});

check('the notes are never docked and detached at once', () => {
  /* Detached means the deck window shows nothing but slides. Any path that
     leaves both showing puts the script back on the shared screen, which
     is the whole reason the notes can detach at all. */
  const d = deckWin.document;
  const both = () => d.body.classList.contains('docked') && deckWin.__detached();

  const paths = [
    ['p', 'd', 'p'],          // dock, detach, then P out of habit
    ['d', 'p'],               // detach from cold, then P
    ['p', 'd', 'd'],          // dock, detach, re-attach
    ['d', 'd', 'p', 'd'],     // round trip and out again
  ];
  for (const path of paths) {
    d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: 'Escape' }));
    for (const k of path) {
      d.dispatchEvent(new deckWin.KeyboardEvent('keydown', { key: k }));
      if (both()) throw new Error(`both showing after ${path.join(' ')}`);
    }
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
  const shared = ['css/theme.css', 'css/presenter.css', 'js/deck.js', 'js/presenter.js',
                  'lib/render.js', 'lib/pages.js', 'lib/engine.js', 'lib/templates.js']
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
  for (const sheet of ['css/theme.css', 'css/presenter.css']) {
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
  for (const f of ['css/theme.css', 'css/presenter.css']) {
    for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
      const m = line.match(SCALES) || line.match(VALUES);
      if (m) throw new Error(`${f} asks for ${m[0]}, which names a colour rather than a job`);
    }
  }
});

check('no token is declared and never asked for', () => {
  const text = ['css/theme.css', 'css/presenter.css']
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
    const port = s.address().port;
    const get = async (u) => { const r = await fetch('http://localhost:' + port + u);
                               return { status: r.status, type: r.headers.get('content-type'),
                                        body: await r.text() }; };
    /* fetch normalises a URL before sending it, so a request path the
       server must see verbatim goes over http.get. */
    const http = require('http');
    const raw = (p) => new Promise((ok) => http.get({ port, path: p }, (r) => {
      r.resume(); ok(r.statusCode);
    }));
    const firstEvent = () => new Promise((ok) => http.get({ port, path: '/reload' }, (r) => {
      r.once('data', (c) => { ok({ type: r.headers['content-type'], chunk: String(c) }); r.destroy(); });
    }));
    (async () => {
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
  if (!/^data: \d+\n\n$/.test(out.reload.chunk)) {
    throw new Error(`the first reload event is ${JSON.stringify(out.reload.chunk)}`);
  }
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
    require('http').get({ port: s.address().port, path: '/reload' }, (r) => {
      r.on('data', (c) => events.push(String(c)));
    });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
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

/* And everything true of any talk, run over both this repo ships: the
   fixture, and the same deck in its theatre-bill dress, which is a talk
   like any other and rots like one if nothing renders it. */
for (const { name, fn } of talkChecks(TALK)) check(name, fn);
for (const { name, fn } of talkChecks(talk(path.join(ROOT, 'starters/stylish')))) {
  check(`stylish: ${name}`, fn);
}

console.log(failures ? `\n${failures} failing` : '\nall checks passed');
process.exit(failures ? 1 : 0);
