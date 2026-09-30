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
| **room** | the audience, on their phones, for a deck that says `audience:`. They react, signal the pace, answer polls and fill in a feedback form; the speaker sees it in the presenter window |
| **poll** | a ```` ```poll ```` block in a step: a question put to the room, answered on the phones and drawn by the talk's `poll` template |

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
| `template` | yes | Which of the talk's templates renders it. Thirteen below. |
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
| `poll` | a title, a ```` ```poll ```` block | nothing else | the poll; see [The room](#the-room) |

Those thirteen are what `starters/minimal/templates/` defines, and a talk is
free to change them or add to them. **This library ships none of them.**
What a slide of a given template looks like is the talk's design, so a
folder with no `templates/` is refused by name rather than quietly
borrowing somebody else's. What each one renders to is your
talk's `templates/<name>.html`, read as written. How to add a fourteenth:
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

## The room

A deck that says so in its head opens the talk to the audience's phones:

```markdown
name: My talk
audience: local
```

| Key | Takes | What it does |
|---|---|---|
| `audience` | `local` | `sipario serve` runs a relay and a second listener for phones on the same network, one port above the deck's. The banner prints the address to join at |
| | an `https://` address | the deck speaks the same protocol to a relay somewhere else. None ships with sipario |
| `audience-reactions` | `stage` | reactions float up the edge of the slide as well. Without it they are the presenter window's alone |

Anything else stops the render, and so does `audience-reactions` in a
deck with no `audience`. A deck without the key loads nothing and makes
no request: the script that would is not on its page.

The example's title slide carries a QR code of the address and the
address under it, drawn once the room is open. The address is this
machine's on the room's network: the interface the default route leaves
from, unless that is a VPN tunnel or a virtual bridge, in which case the
first private address on a real interface; never loopback or link-local.
`serve` prints it, and the interface it came from. `SIPARIO_JOIN_HOST=…`
names another, for a machine whose choice is wrong. For a relay
elsewhere, the code is of the relay's address.

The room follows one deck window, however many are open: the first to
open, until another goes full screen or is given `H`. Leaving full screen
keeps it; a window that closes gives it up after a few seconds, and the
phones then keep the last slide until a window takes the room again. The
notes window says whether its deck is the one.

The phones show the slide itself, above everything else on the page: the
real slide in the talk's own look, at the step the room is on. A phone is
only ever sent a step the room has already been shown, never one further
on, and never its script. Going back is fine; a slide the speaker jumped
past is not sent. If the deck window goes, the phones keep the last slide
and say it is the last one.

The phones follow the slide. While a poll is on the stage they show the
poll; once the deck reaches the feedback form they show that, to the end
of the talk; otherwise they offer five reactions and the pace, slower,
just right or faster. The notes' header bar shows how many phones are
connected, the reactions as counts and the pace, and, only when there is
something to say, a poll the phones are still showing with its answers, a
deck window that does not hold the room, or a relay that is not
answering. The room's screen shows only what a
template asks for: the join address, and a poll's answers on its slide.

**With the room open the deck listens on this machine alone** (127.0.0.1),
and the phones get a listener of their own that answers the join page and
the room's two routes and nothing else. `/presenter`, `/print` and every
file of the talk stay off the network. A relay that cannot be reached is
said once, in the presenter window, and the talk carries on.

### The notes on another device

Every run of `sipario serve` also opens the notes to one more device, a
phone or a tablet at the lectern or a second laptop, behind a link made
for that run:

```
[remote] the notes on another device: http://192.168.1.7:52814/presenter?key=…
```

The notes on your machine show the same link under the clock, "On
another device", with a QR code to open it by. It is the notes page
itself, following the deck, with large buttons to move it by touch: Back
and Next a step, the outer two a movement. The arrows and Page Up and
Page Down work from a keyboard or a clicker paired with the device. The
clock is shared: start, pause or reset it at either end and the other
follows, and a reset takes the deck back to the start, as it does from the
notes here.

The device follows the deck window that holds the room, and moves no
other: the first to open, until another goes full screen or is given `H`.
The rule is the same with no `audience:` in the deck. If that window goes,
the device says so and keeps the last slide. Any number of devices may
open the link, and each of them follows and drives.

It has a port of its own, chosen when `serve` starts, which answers
nothing at all without the key: not the notes, not their files, not even a
front page. The address is chosen as the join address is, and
`SIPARIO_JOIN_HOST` moves it the same way. `/print` is not on it, and
stays this machine's alone.

**The link is a password.** Anyone who has it can read your script and
move your deck. It travels as plain HTTP over the local network, so on an
open conference Wi-Fi someone watching the traffic could capture it.
"New link" makes another and cuts off every device using the old one at
once, and the next run of `serve` makes another anyway. Make a new one
after the talk, or before it if the link has been anywhere you did not
mean it to go, and do not use it on a network you do not trust. The
device has to reach your machine, too: a phone on mobile data cannot
reach a laptop on the venue's Wi-Fi, and a network that keeps its clients
apart from each other stops it as well.

### A poll

A fenced block in the step that puts the question, beside its script:

````markdown
## 3.4 Where are you now?
id: 3-where-are-you
template: poll

```poll
id: which-agent
question: Which of these runs in your production today?
- Nothing yet
- A copilot in the IDE
- An agent with write access
```

```notes
Hands up is for rooms of twelve. Phones out.
```
````

The id is declared, like a slide's, so rewording the question does not
orphan the answers already given. It is lowercase letters, digits and
hyphens. Once a step has put the poll on the stage it stays for the rest
of that slide, and the phones go on offering it for the rest of its
movement, so a room still answering when you move on can finish; it
closes when you leave the movement or go back to before it, and a later
poll in the same movement takes its place.
One vote a phone; voting again changes the vote. On paper, and in an
export, the question and options print with no answers.

What the answers look like is the talk's decision, in its `poll`
template: see `docs/TEMPLATES.md`.

### The feedback form

````markdown
```feedback
- rate: How useful was this, overall?
- rate: How was the pace?
- ask: What would you change?
```
````

A block in the step where the form should open, usually the last. From
that step on the phones show it, to the end of the talk; a poll put
after it goes first and the form comes back. `rate` is a score from 1
to 5, `ask` a line of text of up to 500 characters. Typed answers go to
the results and nowhere else, never the stage and never the presenter
window, so nothing anybody types can reach a shared screen. The block
prints nothing on the stage. A deck has one.

### Results

```bash
npx sipario results          # the latest session of ./talk
npx sipario results talk --session 20260927-140533-ab3f
```

A session is one run of `sipario serve`, named by when it began. It is
written as the room speaks, and only once a phone has said something, to
a folder outside the talk:

| Where | When |
|---|---|
| `$SIPARIO_DATA/sessions/<deck>/` | that variable is set |
| `~/Library/Application Support/sipario/sessions/<deck>/` | on a Mac |
| `%APPDATA%\sipario\sessions\<deck>\` | on Windows |
| `$XDG_DATA_HOME/sipario/sessions/<deck>/`, else `~/.local/share/…` | elsewhere |

`results` writes `<deck>-<session>.json` and `.csv` into the folder the
command ran from, never into the talk. The JSON is the session: every
poll with its counts, the reactions, what the room said while each slide
was up, and the feedback forms. The CSV is the same as one long table,
`kind, id, question, answer, count`, for a spreadsheet to pivot.

A rehearsal with phones in it is a session too. Restart `serve` before
the talk and the delivery is a session of its own.

**What is kept.** A phone makes a random token for itself and keeps it,
so it counts once. No name and no address is read; the relay never
writes a token to disk; and the file holds counts and the text of
feedback. The phone page says so.

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
- An `audience:` that is neither `local` nor an https address, or an
  `audience-reactions:` that is not `stage` or has no room
- A poll in a deck with no `audience:`, on a template that never prints
  one, or whose template marks no `data-option` for an option
- A poll with no `id:`, a malformed id, no `question:`, fewer than two
  options, a line that is none of those, an id another poll has, or a
  second poll on one slide
- A feedback form in a deck with no `audience:`, a question that is not
  `- rate:` or `- ask:`, a form that asks nothing, or a second form
- A ```` ```poll ```` or ```` ```feedback ```` block that is never closed
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
