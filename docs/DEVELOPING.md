# Developing sipario

The loop is: start the example, edit, watch the browser reload, run the
suite. There is no build step, so nothing sits between a file and what
the page shows.

## Setup

```bash
npm install
```

One package arrives, `jsdom`, and only the suite uses it. The library
depends on nothing outside Node, so a talk that links this folder by path
(`npm install ../path/to/sipario`) runs whether or not this step was
ever taken. Node 22 or later. jsdom itself asks for a newer 22 than
that (its `engines` names the security lines it supports) and npm says
so once at install as a warning, but the suite runs on any 22.

## Running the example

```bash
npm run minimal          # sipario serve starters/minimal
npm run stylish          # the same deck, set like a theatre bill
```

Then http://localhost:9999. `PORT=8080 npm run minimal` moves it.

The server renders `deck.md` on every request and holds an event stream
open to the page. Saving anything under `starters/minimal/`, `lib/`,
`css/` or `js/` reloads the browser, and the renderer's modules are
dropped from the require cache first, so an edit to the engine takes
effect without a restart. `lib/server.js` is the exception: the server
already listening is the old copy of itself, so restart it.

A deck that cannot render answers with the error rather than a page. That
is the intended behaviour, not a rough edge; see the last section.

## A scratch talk, and clearing it away

The example is the fixture, so it is the thing to edit when the engine
changes. To see instead what a stranger gets, start one:

```bash
node bin/sipario.js new       # a copy of the example, in ./talk
node bin/sipario.js serve     # the same folder, at http://localhost:9999
```

Both default to `./talk`, so neither needs an argument; give either one a
folder and it uses that instead.

A scratch talk is the only thing these commands leave behind, and
`/talk/` is gitignored so it cannot reach a commit:

```bash
rm -rf talk
git status               # clean
```

If an install goes strange, `rm -rf node_modules && npm ci` puts it back
to exactly what the lockfile says.

## Where things live

| Path | Holds |
|---|---|
| `index.js` | the public surface: everything a consumer may require |
| `lib/` | the parser and renderer, the template engine, the shared checks, the CLI, the server |
| `js/` | what runs in the browser: `deck.js` in the room, `presenter.js` in the notes |
| `css/` | the frame's stylesheet and the presenter's, and no talk's design |
| `bin/` | argv, and nothing else; the commands are in `lib/cli.js` |
| `docs/` | the format, writing a template, and the calls behind the engine |
| `starters/minimal/` | the shortest complete talk |
| `starters/stylish/` | the same deck in a different dress: the look is the talk's, not the frame's |
| `test.js` | the suite |

`starters/minimal/` is two things at once, deliberately. It is what
`sipario new` copies, and it is the fixture the suite renders. A check
that breaks there breaks the folder a stranger starts from, rather than
being found in a room. The cost of that is worth stating: changing the
example to make a check pass changes what everybody's first talk looks
like, so change the engine instead unless the example is what is wrong.

## The suite

```bash
npm test
```

146 checks, one line each, with a count at the end and exit status 1 if
any failed. Nothing stops at the first failure: every check runs, so one
broken thing does not hide the next.

Broadly, what they cover:

| Region | Checks |
|---|---|
| the page | `deck.js` runs, exactly one slide is current, and it is scaled to the window and centred |
| moving through a talk | the arrows and PageDown reach every step in order, each movement remembers where it was left, the map opens and Enter plays a build rather than dropping you at its end |
| builds and figures | a step adds rather than restates, height is reserved so nothing shifts, a layered SVG reveals one group per step, and a misspelt layer name stops the render |
| ids and numbers | every slide declares both, a number or a section that disagrees with where the slide sits stops the render, and `renumber` agrees with the renderer |
| the presenter window | docked and detached are the same page, the channel between the two windows carries both directions, and the reset asks before forgetting |
| the format | front matter, scripts, and every renamed or unknown key refused by name rather than ignored |
| the template engine | a folder is read and compiled once, two talks load apart, and a template the talk has no file for is refused with the set named |
| the CLI | `new` copies the example, renames it from the folder and refuses a folder that already holds something; the old bin names still run |
| the frame | it names no template of the talk it is serving, its `url()`s resolve, its colours are named for their job, and the talk's sheet loads last |
| any talk | `talkChecks`, run over `starters/minimal` and again over `starters/stylish` |

### It runs against a real DOM

`jsdom`, because the deck's layout is decided at runtime by `fit()`, and a
static render says nothing about it. Two bugs shipped that way and both
are one assertion in there now: the slide off-centre when stacks became
grid items, and the slide unscaled when a leftover call to a deleted
function killed the script on its first line.

The DOM half builds the page the server would send, in the same order:
the frame's stylesheet then the talk's, the rendered markup inside
`<main id="deck" data-deck="...">`, then `js/deck.js` evaluated in the
window, which is fixed at 1600x900. Keys arrive as real `keydown`
events, so a check exercises the same path a presenter does.

### Adding a check

```js
check('a name that says what is true', () => { ... });
```

`fn` throws with a message naming what is wrong, or returns. Name it as a
sentence about the deck or the talk, in the voice of its neighbours: what
holds, not what the function does. Put it under the banner it belongs to
rather than at the end of the file.

Two helpers carry most checks. `eq(a, b, what)` compares and says which
value was which, and `R(src)` renders a deck written for one check against
the example's templates. The DOM is built once and shared, so a check that
moves the deck leaves it moved: call `forget()` first where it matters
which slide the arrows land on.

### `talkChecks` is the shared-rules contract

**A rule true of any talk goes in `lib/lint.js`, not `test.js`.** That
split is the contract. `test.js` checks sipario; `talkChecks(t)` returns
the rules every talk has to keep, as `{ name, fn }` pairs, and each
consumer runs them over its own folder:

```js
for (const { name, fn } of talkChecks(talk('./talk'))) check(name, fn);
```

The suite ends with that same loop over `starters/minimal` and over
`starters/stylish`, so the shared rules are exercised here as well as
there. A rule written into `test.js`
that belonged in `lib/lint.js` is a rule no consumer ever gets, and the
copy that eventually appears in their suites is the first of the two to
go stale.

Adding a rule adds it to every consumer's suite at once. Run theirs
before calling it done.

## What must stay true

- **No build step.** Every file is read at the moment it is used, so
  nothing on screen can be a stale copy of something since edited. A
  compile step would put an artefact between the file and the room.
- **The format is hand-parsed on purpose.** A general markdown parser has
  to be fought back into these shapes, and the failure mode of fighting it
  is a slide that renders plausibly and wrongly. `lib/render.js` is that
  parser, and it stays one.
- **There are no dependencies.** Nothing under `lib/` or `bin/` requires
  anything outside Node; the server is `node:http`, and the file serving
  it needs sits beside the routes in `server.js`. `jsdom` is a devDependency the
  suite alone reaches for, and the suite checks the rest of this claim.
- **Errors stop the render.** A standfirst on a slide whose template never
  prints one, a step restating a line already on the stage, a layer name
  absent from the SVG, an id in the wrong section: each one stops the
  render and names both what is wrong and where. Never add a fallback that
  lets a broken deck through. A slide that renders plausibly and wrongly
  is worse in a room than one that never rendered.
- **The library ships no design.** Templates and stylesheet belong to the
  talk, and nothing under `lib/`, `js/` or `css/` may name a template. The
  suite checks that in both directions.
- **The example carries the format.** Anything the format grows has to
  appear in `starters/minimal`, or the suite has nothing to render it
  against.

