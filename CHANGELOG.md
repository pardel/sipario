# Changelog

Newest first, one line per thing somebody using sipario would notice.
Every break is stated as a break: before 1.0 there is no major to spend,
so a break ships as a minor and this file is the whole of the warning.

## Unreleased

- **Added:** `sipario export pdf` and `sipario export pptx`. The deck as
  a PDF, a page per step at the stage's size, and as a PowerPoint deck of
  a picture per step with the step's script in its notes. Both photograph
  the new `/print` page through a browser already on the machine (Chrome,
  Chromium, Brave or Edge; `SIPARIO_BROWSER` names one elsewhere), so
  neither can disagree with the room. It refuses rather than writing a
  file that is wrong only to look at: a step the talk's sheets hide, a
  PDF a page short, a figure that did not load, and a save landing
  mid-run, which would pair one draft's pictures with another's scripts.
  A browser that goes away mid-run is an error too, rather than a wait
  that never ends.
  `exportPdf`, `exportPptx`, `outline`, `printPage` and `findBrowser`
  join the library's surface.
- **Fixed:** printing the deck page from the browser stacked every slide
  on one sheet. The rule that tried is gone; `/print` is the page that
  prints.
- **Fixed:** a request the URL parser refuses, such as `GET //[/`, took
  the server down. It threw where nothing could catch it, so anyone able
  to reach the port could end a talk between two slides. Such a request
  is now answered 400 and the server stays up.
- **Fixed:** `renumber` counted a `# ` line inside a comment at the head
  of a deck as a movement. The renderer ignores that comment, so a deck
  that rendered correctly was renumbered wrongly from its second slide
  on, and a `number-from:` line below the comment was never read at all.
  Both now skip the comment, which is put back untouched.
- **Fixed:** `renumber` prefixed a quoted id rather than reading through
  the quotes, so `id: '1-example'` became `id: 1-'1-example'` — a
  different anchor, and every link to that slide broken.
- **Fixed:** a link to a slide whose id is not plain ASCII opened the
  wrong slide. `#2-café` travels as `#2-caf%C3%A9`, which matched no id,
  so the deck opened at the start and then rewrote the address bar,
  losing the link. The fragment is now decoded before it is matched, and
  encoded when the deck writes it, so an id holding what looks like an
  escape — `2-100%20` — is read back as the name it is rather than as
  `2-100 `.
- **Fixed:** the presenter window called itself live before any deck had
  answered it. The page paints itself on load and the paint was what
  marked it live, so a `/presenter` opened with no deck behind it sat
  showing the first slide's script instead of the warning that the deck
  is not answering. Only a message from a deck marks it live now.
- **Changed:** the server closes its file watchers when it closes, and
  asked for port 0 names the port it was actually given.

## 0.3.0 — 2026-09-20

- **Fixed:** the docked notes announced themselves as a window. Whether
  the page is the dock's frame was decided after the first hello went
  out, so a deck with popups allowed opened a blank window by name and
  hid the dock. It is decided first now.
- **Fixed:** the version cache missed the deck page. Only the notes page
  went through it, so notes opened after a held save asked for a version
  the server had never kept and got the latest instead. The deck page is
  served through the cache too.
- **Fixed:** notes opened after a save the deck was holding back showed
  the file's latest, not the room's. The page now says which version it
  was rendered at, the notes take their version from that, and a deck
  reporting an earlier version is asked for by number: the server keeps
  its last few renders and serves the one the room is seeing.
- **Fixed:** a rename while the deck was in fullscreen left the notes
  stationary. Staging the renamed page closed the old channel, which the
  fullscreen deck was still driving on. The new channel is now opened
  beside the old as a probe, and the notes move over only when a deck
  there confirms the staged version.
- **Fixed:** a rename could still lose the detached window. The renamed
  deck's roll-call went unanswered when it loaded before its window had
  moved channel. A window of its own now says so in its hello, and a deck
  takes it back on either message, whichever comes first.
- **Fixed:** the notes ran ahead of a deck in fullscreen. The deck holds a
  save back while it is full screen; the notes took it at once, and read
  the script of a slide the room could not see. The deck now reports the
  version it is showing with every position, and the notes stage a fresh
  page until the deck reaches it. Leaving fullscreen takes the held save
  rather than dropping it.
- **Fixed:** renaming a deck cut its notes off. The channel is named for
  the deck, so the reloaded deck spoke on a channel the notes were not
  on. A refreshed notes window now moves to the channel the fresh page
  names, and the tab id and window name no longer carry the deck's name,
  so the pairing and the reclaim survive the rename.
- **Fixed:** a stylesheet added by a save was appended after the rest in
  the notes, so two sheets of equal specificity could resolve the other
  way round from the deck. Sheets are now placed in the fresh page's order.
- **Fixed:** a save that did not render stranded a detached notes window.
  The window reloaded into the server's error, a plain page with no
  listener, so the save that fixed the deck never reached it. The error
  is now shown inside the notes, over the script, with the previews and
  the clock left as the last good copy, and the stream stays connected.
- **Fixed:** a refreshed notes window kept its old stylesheets. The deck
  was swapped in but the sheets were not, so a dress edited mid-rehearsal
  left the previews in the old look. The sheets the fresh page carries are
  fetched again, one it gained is added, one it dropped goes.
- **Fixed:** reloading the deck lost its detached window. The window stayed
  open but the deck came back with no handle to it and believed the notes
  hidden, so P docked a second copy beside the deck: the script on the
  shared screen. A reloaded deck now asks over the channel whether its
  window is still there and, when it answers, takes it back by name.
- **Fixed:** a deck with a fault in it took the server down at startup.
  The listening callback rendered once for the banner and a render error
  there was thrown out of the process, so the error page that exists for
  exactly this state was never served. The failure is now logged and the
  server stays up, serving the error until the next save.
- **Fixed:** the error page reloaded itself for ever. The reload stream
  sends its current token on connect and the page reloaded on every
  message, that one included: connect, token, reload, connect. It now
  keeps the first token and reloads only when a later one differs.
- **Fixed:** an edited layered figure never reached the deck. The figure
  cache was keyed by path and never emptied, so a save of an SVG reloaded
  the page and the render was handed the old drawing for as long as the
  server ran. The cache now checks the file's mtime on every read and
  rereads a changed figure; an unchanged one is still served from memory.
- **Fixed:** a detached notes window went stale after a save. It kept the
  copy of the deck it loaded with and took only positions from the deck,
  so after an edit every move landed on the right number and the wrong
  script. It now listens for the same change the deck does, fetches its
  page again and swaps the fresh deck in without reloading, so the clock
  keeps running and the window stays put. The docked panel already
  reloaded with the deck, being its iframe.
- **Added:** `number-from: 0` in the deck's head counts the movements from
  0 instead of 1. A talk whose first movement is an opening rather than a
  beat had its beats one off from its slide numbers: beat three's section
  slide, marked 3, was 4.1. The renderer, the id prefixes and `renumber`
  all follow the key; anything but 0 or 1 stops the render.
- **Added:** the notes carry the map, top right, lit where the deck is.
  The position block was dropped from the notes earlier on the grounds
  that the deck's compass and minimap carry it; that put it on the screen
  behind the presenter, and turning round to find your place is what a
  notes panel is for. Same shape as the deck's minimap, built from the
  same groups. M, pressed on the deck or in the notes, shows or hides both.
- **Added:** Shift with the up arrow returns to the head of the movement
  you are in, from the deck or from the notes. Up alone reads back a step
  at a time and left returns to wherever the *previous* movement was left,
  so there was no way to restart the current one short of pressing up
  until it stopped. The help overlay and the starters' keys slide list it.
- **Fixed:** the notes now follow the deck window that opened them. The
  channel is named for the talk, which keeps two different decks apart but
  not two windows of the same one, and opening a deck twice is ordinary —
  one on the projector, one on the laptop. Every deck window was
  broadcasting its position to every panel, and each panel obeyed whichever
  spoke last, so the notes beside a deck on slide 1.1 could be reading the
  script for 2.3. Each window now carries an id, kept in `sessionStorage`
  so it survives the live reload, and a panel listens only to the window
  that opened it. A detached window also gets a name of its own, so a
  second deck's detach opens its own window instead of reusing the first's.
  A panel opened by hand at `/presenter` carries no id and still follows
  any deck, which is the only useful thing it can do.
- The next slide sits under the current one. The two previews are one
  narrow column with the clock and the position beside them, and the
  script runs the whole width underneath. Before, the previews sat apart,
  one across the top and one down the side, which set the panel's width by
  the wider of two pictures of slides the presenter has already seen.
  Nothing about the layout is decided by width, so docked and detached
  stay one arrangement.
- The script can be made bigger or smaller, with <kbd>+</kbd> and
  <kbd>-</kbd> or the two signs beside its heading, in seven steps from
  15px to 35px. How far a lectern is from the eyes is a property of the
  room rather than of the talk, so it is set in the room and remembered
  per deck. The ends of the range say so rather than letting a press do
  nothing.
- The keys the notes own, <kbd>1</kbd>, <kbd>2</kbd>, <kbd>+</kbd> and
  <kbd>-</kbd>, work from the deck window too: docked, the notes are an
  iframe and the hands are on the deck. A detached window hears them
  itself and is not sent a second copy.
- The next slide's heading is gone from under its preview. The preview
  is the slide, so the heading said the same thing twice in the panel
  whose other half is the words to be read. The end of the talk says
  itself: the box is empty.
- The position is gone from the notes: no movement name, no slide
  number, no dot per step. The deck's own compass and minimap carry it,
  on the screen the presenter is already looking at, and this panel is
  for the words. What is left beside the previews is the clock.
- Either preview can be put away, by the eye beside its label or by
  <kbd>1</kbd> and <kbd>2</kbd>, and the choice is remembered per deck.
  With both away the rail shrinks to the clock and the script takes the
  rest. The label stays whatever is hidden, so the way back is where the
  way out was, and the eye is struck through rather than unlit, so which
  state it is in can be read rather than inferred.

## 0.2.0 — 2026-09-05

- The slides move. Press → and the slide you are on goes out to the
  left, whole, as the next comes in from the right; ← the reverse, ↓ and
  ↑ the same vertically within a movement, Home and End as a jump back or
  forward. A step within a build moves nothing. Reduced motion turns it
  all off. To make it possible the slide's scale is now a custom
  property, `--k`, applied by the frame's stylesheet, where it used to be
  an inline transform written by the runtime.
- A minimap by the slide's top-right corner, on by default: a column per
  movement, a cell per slide, a build's cell marked, the cell you are on
  lit in the accent. M hides and shows it, and the choice is kept for the
  deck. The help overlay names it, and both starters' keys slides carry
  the row.
- The compass and the minimap keep an inset from the screen's edge when
  they sit in the band above or below the slide, where the slide's edge
  is the screen's.
- Four tokens a talk may set: `--surround` for the window around the
  slide, `--surround-ink` and `--surround-accent` for the chrome that
  sits on it, and `--slide-edge` for a hairline the slide wears. All
  default to what they were, so a talk that sets none looks as before.
  The minimal starter sets all four: its window is the slide's paper a
  shade sunk, so a slide moving in or out crosses nothing darker than
  that tint, and the slide draws its edge in the theme's hairline.
- The README shows the mark, the diff slide in both starters, and the
  moving slides, compass and minimap under "In the room".

## 0.1.1 — 2026-09-04

The first release. Everything below is what a talk gets from it. 0.1.0
went up and was withdrawn the same day; this is the same code.

- Two starters in `starters/`, each a complete talk you copy to begin:
  `minimal`, which `sipario new` copies, and `stylish`, the same deck
  slide for slide set like an Italian theatre bill, in Newsreader, black
  and curtain-red on paper. The look is the talk's alone: both carry it in
  `deck.css` and `templates/`, and the suite renders both. Each deck
  opens with its keys, then shows the twelve templates in the order its
  act-break slide lists them.
- No dependencies. The server is Node's own `http`; `express` is gone,
  and with it the only package a talk's install ever pulled. Node 22 or
  later.
- The server notices a save that replaces `deck.md`, which is how most
  editors save. It watched the file's inode before, so the first such save
  was the last it ever saw.
- The compass sits by the slide's bottom-right corner, on the surround
  when the letterbox has room and inside the corner when it has not,
  rather than in a corner of the window where it straddled the edge. It is
  smaller, a live arrow takes the talk's accent, and the slide's number
  sits in its middle. **Breaking:** the number is no longer printed on the
  slide, so `.slide::after` styles nothing, and the `--ink-dim` token
  that served it is gone; a `deck.css` that reaches for it fails the
  shared check that every token is declared.
- The map numbers each slide above it, not below, with the step count.
- The help overlay names ↓ and ↑, which it had left out.
- The engine, pulled out of the talk it was written for: the format and
  its parser,
  the template engine, the deck's runtime, the presenter window, the
  frame's stylesheet, and a server that renders per request and reloads on
  save. No templates and no design, which belong to the talk.
- A deck names itself. `name:` is required in the opening front matter and
  `title:` falls back to it; the name is the tab, the presenter title, the
  bookmark key and the channel the two windows share.
- `render()` has no talk to fall back on. `templateRoot` and `assetRoot`
  are required, and a missing one throws `MissingTalkOption` naming it.
- `talkChecks(t)` exports the rules true of any talk, so a consumer's
  suite runs them over its own folder instead of keeping a copy.
- `sipario new` gives a started talk no `title:` of its own. It used to
  inherit the example's, so every new talk's browser tab read "… — one
  slide per template", which described the fixture rather than the talk —
  and read to some as a rule that each slide needs a template of its own.
  `title:` falls back to `name:`, so a new tab now reads the talk's name.
  The example itself is retitled "a slide of every template", which is
  what it is: 13 slides over 12 templates, `image` used twice.
- A talk's `assets/` is gone, split into `fonts/` and `images/` at the top
  of the folder; icons live among the figures, told apart by their `icon-`
  prefix. Every folder in a talk is mounted at the URL of its own name, so
  a `src` the markup writes resolves against the talk unchanged, and the
  shared check that a referenced asset exists tests that URL by looking on
  disk. `render()` takes `imageRoot` in place of `assetRoot`, and templates
  get `imagePath` in place of `assetPath`. **Breaking** on all three
  counts.
- A talk's stylesheet is `deck.css`, beside `deck.md`, and a template may
  keep its own rules in `templates/<name>.css` beside its markup. `deck.css`
  carries the typefaces, the colours and the vocabulary templates share —
  headings, standfirsts, captions, paths, code blocks, plates; what one
  template alone puts on a slide sits beside that template, so deleting a
  template deletes its rules. Sheets load frame, `deck.css`, then the
  template sheets alphabetically, and a template's sheet may style only its
  own slides. **Breaking:** an existing talk moves its sheet to `deck.css`
  and repoints its `url()` refs.
- `new` and `serve` default their folder to `./talk`, so the two commands
  that get a stranger to a rendered deck take no argument: `npx sipario
  new` writes it, `npx sipario serve` reads it. A folder given explicitly
  still wins.
- `sipario new <dir>` starts a talk by copying `starters/minimal` and
  naming it from the folder. `serve` and `renumber` join it under the one
  `sipario` bin, and `sipario-serve` and `sipario-renumber` stay as bins
  of their own for talks that already have them in their scripts.
- MIT.
