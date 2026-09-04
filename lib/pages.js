'use strict';

/* The two pages a served talk is: the deck, and the presenter window.
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

/** The deck itself. `r` is what render() returned. */
function deckPage(r) {
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
<main id="deck" data-deck="${esc(r.deck.key)}">
${r.html}
</main>
<div id="progress"><div id="progress-bar"></div></div>
<script src="/js/deck.js"></script>
</body>
</html>
`;
}

/* The presenter window. It gets the same rendered deck, hidden, and reads
 * the current slide out of it, so the script it shows and the slide the
 * room sees can never come from two different renderings. */
function presenterPage(r, port) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Presenter — ${esc(r.deck.name)}</title>
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/presenter.css">
${sheetLinks(r)}
</head>
<body>
<main id="deck" data-deck="${esc(r.deck.key)}">
${r.html}
</main>

<div id="wrap">
  <div class="pane">
    <h4>On screen</h4>
    <div class="shot-box" id="now"></div>
  </div>

  <div class="pane" id="side">
    <div id="attach-row">
      <button id="attach-btn" type="button" title="Put the notes back beside the deck (A)">attach</button>
      <span id="attach-note"></span>
    </div>
    <div>
      <h4>Elapsed</h4>
      <div id="clock">00:00</div>
      <button id="timer-btn" type="button" title="Start, pause, then reset the clock and the bookmarks (T)">start · pause · reset</button>
      <p id="timer-note"></p>
    </div>
    <div>
      <h4>Where</h4>
      <div id="group"></div>
      <div id="where"></div>
      <div id="dots"></div>
    </div>
    <div>
      <h4>Next</h4>
      <div class="shot-box empty" id="next"></div>
      <p id="next-label"></p>
    </div>
  </div>

  <div class="pane" id="script">
    <h4>Script</h4>
    <div id="notes"></div>
  </div>
</div>

<div id="orphan">
  <div>
    <strong>The deck window is not answering.</strong>
    <span>Open the deck at <code>localhost:${port}</code> and press <kbd>P</kbd>.
    This window follows it; it does not run the talk on its own.</span>
  </div>
</div>

<script src="/js/presenter.js"></script>
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
       <script>new EventSource('/reload').onmessage=(e)=>location.reload()</script>
       </body>`;
}

module.exports = { deckPage, presenterPage, errorPage };
