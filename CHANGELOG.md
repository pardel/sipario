# Changelog

Newest first, one line per thing somebody using sipario would notice.
Every break is stated as a break: before 1.0 there is no major to spend,
so a break ships as a minor and this file is the whole of the warning.

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
