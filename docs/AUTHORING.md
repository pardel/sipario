# Authoring a deck

The format. `starters/minimal/` is the shortest complete talk, holding
one slide of every template it defines, and it is the suite's fixture, so
the folder you copy cannot break unnoticed.

## Starting a talk

```bash
npx sipario new          # a copy of starters/minimal, in ./talk
npx sipario serve        # the same folder, at http://localhost:9999
```

A talk is a folder holding `deck.md`, `deck.css`, `fonts/`, `images/` and
`templates/`. Each folder is mounted at the URL of its own
name, so a `src` the markup writes resolves against the talk unchanged. The words, the figures, the typefaces and what a slide of
each template renders are all the talk's own. Shared are the engine, the
frame's stylesheet and the deck's runtime. The server takes the talk
folder as its one argument, falling back to `./talk`; the library itself
still has no talk, and `render()` has no folder to fall back on.

```
my-talk/
  deck.md
  deck.css        its typefaces, its colours, its shared vocabulary
  fonts/          the .woff2 files and their licences
  images/         the figures and the icons, named from the deck
  templates/      one .html per template, and optionally .js and .css
```

Two talks can define the same template differently, or define ones the other
has never heard of. Nothing ships a default set, so a folder with no
`templates/` is refused by name rather than quietly borrowing somebody
else's design.

Calling the renderer directly:

```js
const { render, talk } = require('sipario');
const fs = require('fs');

const t = talk('./talk');                  // the three paths, in one place
const { html, deck, slides, steps } = render(fs.readFileSync(t.deck, 'utf8'), t);
```

`talk()` returns exactly the shape `render` takes: `templateRoot` for the
slide templates, `imageRoot` for the figures on disk, and `imagePath` for
the URL prefix written into the markup. Disk and URL are separate because
one is read here and the other is served to a browser.
`templateRoot` and `imageRoot` are required, and a missing one throws a
`MissingTalkOption` naming it: a default here would render somebody
else's slides and succeed.

## The vocabulary

The words the rest of this file uses, defined once.

| Word | Is |
|---|---|
| **talk** | the folder: `deck.md`, `deck.css`, `fonts/`, `images/`, `templates/` |
| **deck** | the talk's words, all of them, in one `deck.md` |
| **movement** | a part of the talk. A `# ` line opens one, and nothing else does. Every slide belongs to exactly one, and reaches it as `meta.group` |
| **slide** | one thing on screen. A `## <number> <title>` line opens one; the number is required, the title optional |
| **front matter** | the `key: value` lines directly under a slide's header, ending at the blank line that starts its body. The run at the top of the file is the deck's own, and names it |
| **step** | one state of a slide as it builds. `--` on its own line starts the next. A step states only what it *adds*; everything already shown stays shown |
| **standfirst** | a `>` line under the header. The one exception to the rule above: a new one *replaces* the one before it, so a slide can reword as it builds |
| **script** | what you say. A ```` ```notes ```` block, belonging to the step it sits in, shown in the presenter window and never on the slide |
| **template** | how a kind of slide looks: `templates/<name>.html`, plus `<name>.js` where values have to be worked out and `<name>.css` for the rules only it needs. A slide picks one by name |
| **figure** | an SVG in `images/`, named from the deck without a path or extension |
| **icon** | a small figure a template puts beside a line. Same folder; the `icon-` prefix is what tells them apart, and it is the template's convention, not the engine's |
| **layer** | a `<g class="layer" data-layer="…">` group inside a figure, revealed one step at a time by a slide's `layers:` list |
| **key** | `sipario:` plus the slugged deck name. The bookmark store and the channel the deck and presenter window talk over, which is why two decks on one origin never collide |

## The shape of the file

A deck opens by naming itself, above everything else:

```markdown
name: My talk
title: My talk — and what it is about
```

`name` is required. It is the browser tab, the presenter window's title,
the key the deck's bookmarks are saved under and the name of the channel
the deck and its presenter window talk over. Two decks served from one
origin would otherwise share all four and drive each other. `title` is
optional and falls back to the name.

Then the deck itself:

````markdown
# Opening

## 2.1 What is actually running
id: 2-what-is-running
template: icon-list

> The standfirst

- (folder) **A heading**
  The line under it.

```notes
The spoken script for this step.
```

--

- (check) **A second row**
  Which arrives at this step.

```notes
The script for the second step.
```
````

`# ` opens a movement. `## <number> <title>` opens a slide; the title is
optional, the number is not. The `key: value` lines directly under it are
its front matter, ending at the blank line that starts the body. `--` on
its own line starts the next step of the same slide. A ```` ```notes ````
block is the spoken script for the step it sits in.

Headers rather than `---` because `---` could not say which of the two
things it was: it opened a slide **and** it closed front matter, and one
a terminal slide printing a markdown file has its own `---` front matter,
byte-identical to both. `^## \d+\.\d+` is a shape nothing else
in a deck has. The number carries it rather than the title because every
slide has a number and only some have a title, so the header is never
left standing empty — and because a header takes the whole rest of its
line, a title with a colon in it needs no quotes.

The script is fenced because it has to end as well as begin: it can then
sit before the body, after it, or in several blocks that read as
paragraphs, and a line that runs on is unmistakably still the script. A
plain ```` ``` ```` fence in the body is a terminal transcript and is left
alone.

**A step states what it adds.** Everything the slide has already shown is
still shown, so a line is written once and the build is the order the
lines arrive in. Restating one puts it on the stage twice and stops the
render.

A `>` standfirst is the exception, because a slide may reword its
standfirst as it builds: a new one replaces the one before it rather than
joining it.

Height is reserved from the slide's last step, which is what stops a
build shifting under itself. That is the engine's job, not the author's:
a step never has to mention what it is holding room for.

## Front matter

The number, the title and the movement are on the headers. What is left
is front matter, on every slide whatever renders it:

| Key | Required | What it is |
|---|---|---|
| `id` | yes | The URL hash. Must open with the section number. |
| `template` | yes | Which of the talk's templates renders it. Twelve below. |
| `align` | no | `spread`, `bottom` or `tight`. Anything else stops the render. |
| `dark` | no | `true` puts the slide on the dark ground. |
| `kicker` | no | Small line above the heading. |
| `caption` | no | Line under a figure or a terminal. |

Then per template:

| `template` | Needs | Also takes | Body is |
|---|---|---|---|
| `title` | a title | `subtitle`, `author`, `kicker` | empty |
| `statement` | — | — | one paragraph per line, last is the one landing |
| `section` | `letter` | — | the movement's line |
| `icon-list` | a title | `align` | `> standfirst` and `- (icon) **Head**` rows |
| `labels` | a title | — | ``- (ink) `name` gloss`` rows |
| `term` | a title | `caption` | a fenced block, set verbatim |
| `image` | a title, `figure` | `layers`, `caption` | empty |
| `acrostic` | a title | `kicker` | `- **L** Word — gloss` rows |
| `close` | a title | `colophon` | a standfirst, then link and note pairs |
| `diff` | a title | `file`, `caption` | a fenced diff, coloured by the first column |
| `tree` | a title | `caption` | a fenced listing, path and note split on two spaces |
| `file` | a title, `file` | `caption` | a fenced excerpt, set under its path |

Those twelve are what `starters/minimal/templates/` defines, and a talk is
free to change them or add to them. **This library ships none of them.**
What a slide of a given template looks like is the talk's design, so a
folder with no `templates/` is refused by name rather than quietly
borrowing somebody else's. What each one renders to is your
talk's `templates/<name>.html`, read as written. How to add a thirteenth:
`docs/TEMPLATES.md`.

## Movements

The deck is divided into the talk's movements, and a `# ` line opens one.
That is the only thing that does. The movement's name reaches every slide
under it as `meta.group`, which is how the example's `section` template
names the movement it opens without the deck saying the word twice — in
`templates/section.js`, in the talk, rather than anywhere shared.

Every slide belongs to exactly one, so the file has to open with a `# `
line or the render stops. Groups are `display: contents`, so they carry
structure and take no part in layout.

## Ids and numbers

Both are **declared and then verified, never derived and never trusted.**

An id opens with its section number, so a URL says where in the talk it
lands: `#3-start-with-two` is in the third movement without having to
look. Declaring it rather than deriving it means the anchor is a name you
chose and does not move when you rewrite a heading. Three things are
checked: every slide has one, its prefix is the section it is actually
in, and no two are the same.

A number is the slide's section and its place in it, so inserting a slide
renumbers one movement instead of everything after it. The deck is still
numbered from position, and a declaration that disagrees stops the render
and names both. `npx sipario renumber talk/deck.md` rewrites the `## `
lines from position and is a no-op on a deck that is already right.

The number is the one part of a slide the author does not choose, and it
lives on the header anyway, because that is what makes the header a shape
nothing else has. A `## ` line without one opens no slide at all — its
contents are read as more body for the slide above it — so that is
refused by name rather than rendered.

The steps of one slide take its id with a numeric suffix:
`3-start-with-two`, `3-start-with-two-2`.

## Assets

Named, never pasted in. An icon row's `(folder)` reads
`images/icon-folder.svg`; an image slide's `figure: gates` reads
`images/gates.svg`. Icons and figures share the folder, and the `icon-`
prefix is what tells them apart — it is the template's convention, not
the engine's.

**The look travels with the talk.** `deck.css` declares the typefaces,
sets the two family tokens `--head` and `--body`, and carries the
vocabulary the templates share — headings, rules, standfirsts, captions,
paths, code blocks, plates. What one template alone puts on a slide is in
`templates/<name>.css`, beside its markup, so deleting a template deletes
its rules with it.

The order is the frame, then `deck.css`, then each template's sheet, so a
template can override a rule the talk shares out. Retinting is still one
file: the colour and family tokens are declared in `deck.css` and nothing
shared. The library's `css/theme.css` is only the frame and styles no
template's slides.

Vendor the font files under `fonts/` and their licences with them:
a deck that fetches type over the network is a deck that renders
differently in a room with bad wifi.

**Colours are named for their job.** `--ink` is what a heading is set in,
`--ground` is what a slide sits on, `--accent` is the one colour that is
not either. Nothing anywhere asks for `--slate-500`, because a shade name
tells you what a colour is and leaves you to guess where it belongs.

| Token | For |
|---|---|
| `--ground` `--ground-sunk` `--ground-deep` | a slide, a slide that steps back, the surround |
| `--ink` `--ink-body` `--ink-soft` `--ink-faint` `--ink-dim` | on a light ground, loudest first |
| `--ink-lit` … `--ink-lit-dimmer` | the same ramp on a deep ground |
| `--accent` `--accent-lit` | the one accent, in its two grounds |
| `--hairline` `--hairline-deep` | the line between rows, on each ground |
| `--code-ground` `--code-ink` | a terminal transcript, which is neither |
| `--label-good` `--label-quiet` `--label-bad` `--label-note` | the four label inks, by signal |

Retinting a talk is redeclaring these in its `deck.css`. Two that
share a value today need not: `--ink` and `--ground-deep` are both
`#0f172a`, and separating them is one line.

A figure revealed in steps names its groups:

```markdown
template: image
figure: in-layers
layers: source, output
caption: Arrives last
```

The SVG marks them `<g class="layer" data-layer="source">`. Both halves
of that contract are checked: a misspelt layer name would throw nothing
and simply never hide the group, showing the whole figure at step one
while looking entirely normal. The step count is checked too, one per
layer plus one for the caption, because a slide with fewer steps than
layers would never reach its last one.

## What stops the render

Everything below stops rather than degrades, because a slide that renders
plausibly and wrongly is worse in a room than one that never rendered.

- A deck that does not open with a `name:` line
- A deck in the old `---` shape, or a `slide:`, `group:`, `title:` or `word:` key
- A `##` line with no number on it, which opens no slide and is read as body
- A front-matter run with a line in it that is not `key: value`
- A ```` ```notes ```` block that is never closed
- A `Note:` line, which is what a script used to be
- A step restating something an earlier step already shows
- A `>` standfirst on a slide whose template never prints one
- A talk folder with no `templates/` in it
- A slide with no `template`, or one naming a template its talk does not have
- A missing, misprefixed or duplicated `id`
- A declared number that disagrees with the slide's position
- An `align:` value that is not one of the three
- A layer name absent from the SVG, or a layer count the steps cannot reach
- A slide belonging to no group
- A call to `render()` with no `templateRoot` or `imageRoot`

## Checking it

A talk's own suite runs the checks any talk has to pass:

```js
const { talk, talkChecks } = require('sipario');
for (const { name, fn } of talkChecks(talk('./talk'))) check(name, fn);
```

They cover the templates compiling, every class one writes having a rule
and every rule a class, every figure the deck names being on disk, every
step having a script, and the typefaces travelling with the folder.

```bash
npx sipario serve        # then press C to measure every step against the stage
```

`C` is the one a rehearsal needs: it measures every step against the
1280×720 box and names any that overflow, in pixels.
