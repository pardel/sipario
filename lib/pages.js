'use strict';

/* The pages a served talk is: the deck, the presenter window, the deck on
 * paper, and, for a talk that opens the room, what a phone in it opens.
 *
 * They live here rather than inside the server because the suite has to
 * read the markup the room actually gets. Built in the server, an id
 * renamed there and not in the test would pass every check and be null
 * on the night.
 *
 * `data-deck` on `<main>` is the talk's identity, carried from its
 * `name:` line through to the runtime. deck.js and presenter.js key their
 * bookmarks and their BroadcastChannel on it, so two decks served from
 * one origin cannot share either.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/* The talk's own sheet, then each template's. The template sheets load
   last so a template can override a rule the talk shares out, which is
   the direction the specific-over-general reading expects. */
const sheetLinks = (r) => ['/deck.css'].concat(r.sheets || [])
  .map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

/* The room, where the deck asks for one: where its relay is, on the
   deck's own element, and the script that talks to it. A deck that does
   not ask gets neither, so it cannot make an audience request of any
   kind: the code that would is not on the page. */
const roomAttrs = (r) => (r.deck.audience
  ? ` data-audience="${esc(r.deck.audience)}" data-name="${esc(r.deck.name)}"` : '') +
  (r.deck.reactionsOnStage ? ' data-audience-reactions="stage"' : '');
const roomScript = (r) => (r.deck.audience
  ? '\n<script src="/js/qr.js"></script>\n<script src="/js/audience.js"></script>' : '');

/* A step's script, as the renderer writes it: escaped, so no `</aside>`
   can occur inside one. */
const NOTES = /<aside class="notes">[\s\S]*?<\/aside>/g;

/** Markup with every step's script emptied. The one place the script is
 *  taken out of a page, for every page that goes to anyone but this
 *  machine: the deck another machine is sent, and a slide on a phone. */
function withoutNotes(html) {
  return html.replace(NOTES, '<aside class="notes"></aside>');
}

/* What a step holds that the room has not seen yet.
 *
 * A build renders the rows it has not reached and hides them with
 * `hidden-step`, and a standfirst that holds height for a longer one is a
 * `ghost`. On the stage both are invisible, but they are in the markup,
 * and a phone is sent markup, so a phone's copy keeps none of what they
 * say. It keeps their boxes, though, because the layout is built on them:
 * a list spread down the stage puts its auto margins on its first and
 * last rows, and taking the unreached last row out moves the rows the
 * room can see.
 *
 * So each held element stays: its tag and its classes, and nothing else,
 * not an attribute that could carry a word or an image, and no content.
 * Its size is the one the deck measured on the stage (`holds`, one
 * `[width, height]` per held element in document order, a third field
 * `inline` for an inline box, `null` for an SVG group, which a figure's
 * viewBox lays out and needs no size). Set as a fixed border-box, it
 * takes exactly the room the real one took. Without sizes, or with a
 * count that disagrees with this render's, the boxes are kept empty and
 * unsized: nothing leaks, but the layout may differ until the deck says. */
const UNREACHED = /<([a-zA-Z][\w:-]*)\b[^>]*?\bclass="((?:[^"]*\s)?(?:hidden-step|ghost)(?:\s[^"]*)?)"[^>]*>/g;
const VOID = /^(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/* Where the element opened at `at` closes: its own end for a void or
   self-closed tag, else past its matching close tag. */
function closing(html, tag, open, at) {
  let end = at + open.length;
  if (VOID.test(tag) || open.endsWith('/>')) return end;
  const t = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  t.lastIndex = end;
  let depth = 1;
  for (let m = t.exec(html); m; m = t.exec(html)) {
    if (m[1]) depth--; else if (!m[2]) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length;
}

function held(html) {
  const found = [];
  UNREACHED.lastIndex = 0;
  for (let m = UNREACHED.exec(html); m; m = UNREACHED.exec(html)) {
    const end = closing(html, m[1], m[0], m.index);
    found.push({ start: m.index, end, tag: m[1], cls: m[2], self: VOID.test(m[1]) || m[0].endsWith('/>') });
    UNREACHED.lastIndex = end;                        // what is inside went with it
  }
  return found;
}

function withoutUnreached(html, holds = null) {
  const found = held(html);
  const sizes = Array.isArray(holds) && holds.length === found.length ? holds : null;
  let out = '';
  let from = 0;
  found.forEach((f, i) => {
    const h = sizes && sizes[i];
    const style = h ? ` style="box-sizing:border-box;flex:none;width:${Number(h[0])}px;height:${Number(h[1])}px;` +
      `min-width:0;min-height:0;max-width:none;max-height:none${h[2] === 'inline' ? ';display:inline-block' : ''}"` : '';
    out += html.slice(from, f.start) + `<${f.tag} class="${f.cls}"${style}${f.self ? '>' : `></${f.tag}>`}`;
    from = f.end;
  });
  return out + html.slice(from);
}

/** Every address a piece of markup has a browser fetch: `src`, each
 *  candidate in a `srcset`, `href` and `xlink:href` (an SVG `<image>`),
 *  `poster`, and `url(…)` in a style. As written, entities decoded. */
function references(html) {
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const out = [];
  for (const m of html.matchAll(/\s(?:src|href|xlink:href|poster)="([^"]*)"/g)) out.push(decode(m[1]));
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) {
    for (const part of decode(m[1]).split(',')) out.push(part.trim().split(/\s+/)[0]);
  }
  for (const m of decode(html).matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)) out.push(m[2]);
  return out.filter(Boolean);
}

/** The deck itself. `r` is what render() returned. With `notes: false`
 *  the page carries no script: every step's notes are emptied, and the
 *  deck is told so it does not offer to open them. That is the page
 *  another machine is sent. With `remote`, and only with the notes, the
 *  deck also says where it is to the server, for the notes on another
 *  device, and takes their commands (js/remote.js). */
function deckPage(r, { notes = true, remote = false } = {}) {
  const drives = notes && remote;
  const html = notes ? r.html : withoutNotes(r.html);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.deck.title)}</title>
<link rel="stylesheet" href="/css/theme.css">
${sheetLinks(r)}
</head>
<body>
<!--
  Generated from deck.md on every request. ${r.slides} slides, ${r.steps} steps.
  Edit deck.md, not this: there is nothing here to save.
-->
<main id="deck" data-deck="${esc(r.deck.key)}"${roomAttrs(r)}${notes ? '' : ' data-notes="off"'}${drives ? ' data-remote="window"' : ''}>
${html}
</main>
<div id="progress"><div id="progress-bar"></div></div>
<script src="/js/deck.js"></script>${roomScript(r)}${drives ? '\n<script src="/js/remote.js"></script>' : ''}
</body>
</html>
`;
}

/* The presenter window. It gets the same rendered deck, hidden, and reads
 * the current slide out of it, so the script it shows and the slide the
 * room sees can never come from two different renderings.
 *
 * `remote` says where it is opened. `notes` is this machine, where serve
 * offers the notes on another device: a control that asks the server for
 * the link and shows it with its QR code. The link is fetched, never
 * written into this page, so no page carries it. `device` is the other
 * device: the same page, with the channel to its deck carried by the
 * server (js/remote.js, loaded first so the notes speak over it), large
 * buttons to move the deck by touch, and no docking controls, since
 * there is nothing beside it to dock to. */
function presenterPage(r, port, version, remote = null) {
  const device = remote === 'device';
  const bar = device
    ? '  <span class="bar-room bar-alert" id="remote-status" role="status"></span>'
    : `  <span id="attach-note"></span>
  <button id="attach-btn" type="button" aria-label="Attach notes" title="Attach notes: put them back beside the deck (D)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M20 4l-9 9M11 7v6h6"/></svg></button>
  <button id="close-btn" type="button" aria-label="Close notes" title="Close notes: hide them (N)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  const link = remote === 'notes' ? `
    <div id="remote">
      <button id="remote-btn" type="button" aria-expanded="false" aria-controls="remote-panel" title="Open these notes on a phone or a tablet, to read and move the deck from there">On another device</button>
      <div id="remote-panel" hidden>
        <div id="remote-qr"></div>
        <code id="remote-url"></code>
        <p>Anyone with this link can read the script and move the deck.</p>
        <button id="remote-rotate" type="button" title="Make a new link; anything using this one is cut off">New link</button>
      </div>
    </div>` : '';
  const orphan = device
    ? `<strong>The deck on the laptop is not answering.</strong>
    <span>These notes follow the deck window that holds the room. Open the deck
    there; if another window holds the room, press <kbd>H</kbd> in the one to follow.</span>`
    : `<strong>The deck window is not answering.</strong>
    <span>Open the deck at <code>localhost:${port}</code> and press <kbd>N</kbd>.
    This window follows it; it does not run the talk on its own.</span>`;
  const controls = device ? `
<nav id="remote-controls" aria-label="Move the deck">
  <button type="button" data-command="left" aria-label="Previous movement" title="Previous movement (Left)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6"/></svg></button>
  <button type="button" data-command="back" aria-label="Previous step" title="Previous step (Page Up)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"/></svg>Back</button>
  <button type="button" data-command="next" aria-label="Next step" title="Next step (Page Down)">Next<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg></button>
  <button type="button" data-command="right" aria-label="Next movement" title="Next movement (Right)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13 6l6 6-6 6M5 6l6 6-6 6"/></svg></button>
</nav>` : '';
  const scripts = device
    ? `<script src="/js/remote.js"></script>
<script src="/js/presenter.js"></script>${roomScript(r)}`
    : `<script src="/js/presenter.js"></script>${roomScript(r)}${remote === 'notes'
      ? (r.deck.audience ? '' : '\n<script src="/js/qr.js"></script>') + '\n<script src="/js/remote.js"></script>' : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${device ? '\n<meta name="referrer" content="no-referrer">' : ''}
<title>Presenter — ${esc(r.deck.name)}</title>
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/presenter.css">
${sheetLinks(r)}
</head>
<body>
<main id="deck" data-deck="${esc(r.deck.key)}" data-version="${esc(String(version || ''))}"${roomAttrs(r)}${remote ? ` data-remote="${remote}"` : ''}>
${r.html}
</main>

<div class="notes-bar" id="notes-bar" role="toolbar" aria-label="Notes">
  <span class="bar-room" data-room-phones title="Phones connected"></span>
  <span class="bar-room" data-room-reactions title="Reactions from the room"></span>
  <span class="bar-room bar-pace" data-room-pace title="The pace the room asks for"></span>
  <span class="bar-room bar-alert" data-room-alert></span>
${bar}
</div>

<div id="wrap">
  <div class="pane" id="rail">
    <div class="shelf" id="now-shelf">
      <h4><button class="shelf-btn" id="now-btn" type="button" title="Hide the slide the room is seeing (1)">On screen<svg class="eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg></button></h4>
      <div class="shot-box" id="now"></div>
    </div>

    <div class="shelf" id="next-shelf">
      <h4><button class="shelf-btn" id="next-btn" type="button" title="Hide what is coming next (2)">Next<svg class="eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg></button></h4>
      <div class="shot-box empty" id="next"></div>
    </div>
  </div>

  <div class="pane" id="side">
    <div>
      <h4>Elapsed</h4>
      <div id="clock">00:00</div>
      <button id="timer-btn" type="button" title="Start, pause, then reset the clock and the bookmarks (T)">start · pause · reset</button>
      <p id="timer-note"></p>
    </div>${link}
  </div>

  <div class="pane" id="script">
    <h4>Script
      <button class="size-btn" id="smaller-btn" type="button" aria-label="Smaller script" title="Smaller script (-)">&minus;</button>
      <button class="size-btn" id="bigger-btn" type="button" aria-label="Bigger script" title="Bigger script (+)">+</button>
    </h4>
    <div id="notes"></div>
  </div>
  <pre id="fault"></pre>
</div>

<div id="orphan">
  <div>
    ${orphan}
  </div>
</div>
${controls}
${scripts}
</body>
</html>
`;
}

/* One step of one slide, the way a phone in the room is shown it: the
 * frame's stylesheet and the talk's, the step's own section and nothing
 * else of the deck, its script and what it has not reached yet taken out,
 * and no runtime. The phone puts it in a frame 1280x720 wide and scales
 * that frame to fit, so the slide is laid out exactly as on the stage.
 * Null when the talk has no such step. */
function slidePage(r, id, step, holds = null) {
  const section = r.stepHtml && r.stepHtml.get(`${id}/${step}`);
  if (!section) return null;
  const shown = withoutUnreached(withoutNotes(section), holds)
    .replace(/^(\s*<section class="slide[^"]*?)( current)?"/, '$1 current"');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(r.deck.title)}</title>
<base href="/">
<link rel="stylesheet" href="/css/theme.css">
${sheetLinks(r)}
</head>
<body>
<main id="deck" data-deck="${esc(r.deck.key)}">
${shown}
</main>
</body>
</html>
`;
}

/* What a phone in the room opens. It carries no part of the deck: the
 * talk's name, and a page its script fills from the stage stream. What
 * is kept, and where, is said on the page itself, because the person
 * holding the phone is the one it is about. */
function phonePage(name) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name || 'The room')}</title>
<link rel="stylesheet" href="/phone.css">
</head>
<body>
<div id="screen" role="img" aria-label="The slide on stage"></div>
<header>
  <h1 id="talk">${esc(name || 'The room')}</h1>
  <p id="status">Joining…</p>
</header>
<main id="phone"></main>
<footer>
  <p>Anonymous. This phone keeps a random token so that it counts once;
  no name and no address is kept. What you send stays on the speaker's
  laptop.</p>
</footer>
<script src="/phone.js"></script>
</body>
</html>
`;
}

/* The deck on paper: every step of every slide in the flow, no runtime,
 * and the print sheet linked last so it has the final word on where a
 * slide sits. `sipario export` prints this page and photographs it; a
 * browser's own print dialog can print it too. */
function printPage(r) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(r.deck.title)}</title>
<link rel="stylesheet" href="/css/theme.css">
${sheetLinks(r)}
<link rel="stylesheet" href="/css/print.css">
</head>
<body class="print">
<!--
  Generated from deck.md on every request. ${r.slides} slides, ${r.steps} steps,
  one page each. Edit deck.md, not this: there is nothing here to save.
-->
<main id="deck" data-deck="${esc(r.deck.key)}">
${r.html}
</main>
</body>
</html>
`;
}

/* A deck.md that will not render says so on the screen, rather than
 * serving a blank page or the last good copy. A deck that quietly keeps
 * showing yesterday's slide is the failure this whole thing is about. */
function errorPage(err) {
  return `<body style="font:16px/1.6 ui-monospace,monospace;padding:6vh 8vw;background:#0f172a;color:#e2e8f0">
       <h1 style="color:#f87171;font-size:22px">deck.md could not be rendered</h1>
       <pre style="white-space:pre-wrap;color:#fca5a5">${
         String(err.stack || err.message).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))
       }</pre>
       <p style="color:#94a3b8">Fix it and this page reloads itself.</p>
       <script>
       /* The stream sends its current token on connect. Reloading on that
          one reconnected and reloaded again, for ever; only a change means
          the file was saved. */
       var token=null;new EventSource('/reload').onmessage=function(e){if(token===null){token=e.data;return}if(e.data!==token){location.reload()}}
       </script>
       </body>`;
}

module.exports = { deckPage, presenterPage, printPage, errorPage, phonePage, slidePage,
                   withoutNotes, withoutUnreached, references };
