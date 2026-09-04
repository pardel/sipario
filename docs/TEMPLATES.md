# Templates

**The templates belong to the talk.** What a slide rendered by a given
template looks like is a design decision, owned the same way a talk owns its words, its
figures and its typefaces, so every talk carries its own `templates/` folder beside its
`deck.md` and its images. Two talks can define the same
template differently, or define ones the other has never heard of, and neither
can reach the other's. Nothing ships a default set: a talk with no
templates has not said what its slides look like, and guessing on its
behalf would be the engine deciding the design.

A slide picks its template by name: `template: icon-list` in the front
matter renders through `templates/icon-list.html`. The file **is** the
vocabulary, which is why the key says `template` and not `kind`.

A template is **`<name>.html`**: the markup, with placeholders, read
exactly as written. Beside it, only where its values have to be worked
out rather than looked up, **`<name>.js`** exporting `data(ctx)`.

```
lib/
  engine.js        the placeholder language, ~110 lines, no dependency
  templates.js     reads a talk's folder, compiles every .html, caches it

starters/minimal/templates/         <- a talk's own set, and the fixture
  title.html       term.html         <- markup only
  file.html                          <- markup only
  statement.html   statement.js      <- which lines this step has reached
  icon-list.html   icon-list.js      <- which rows, and the ghost standfirst
  image.html       image.js          <- inlining an SVG, hiding groups by step
  labels.html      labels.js         <- its row grammar
  acrostic.html    acrostic.js       <- its row grammar
  close.html       close.js          <- a non-breaking colophon
  section.html     section.js        <- the movement's name, from `meta.group`
  diff.html        diff.js           <- colouring by the first column
  tree.html        tree.js           <- splitting a path from its note
```

**The library ships none of these.** They are one talk's design, copied
into the next talk and changed there. Nothing in `lib/render.js` names
one. Adding a template is adding an `.html`,
and a `.js` only if it needs one. **Three need no JavaScript at all**, and
the suite fails if that stops being true of any of them: if every one
grew a `data`, the markup would have drifted back into code and the split
would be buying nothing.

A `<name>.js` is for what is peculiar to that template, never for reading
markdown that another might also want read. Anything generic —
blocks, a standfirst, rows, a fence, a pair — belongs in `lib/render.js`
beside the rest of the parser and arrives in the context above. Four of
these files started out doing parsing that belonged there; `fenced` and
`pairs` are what came back, and they took `term.js` and most of
`close.js` with them.

## The placeholder language

| Written | Does |
|---|---|
| `{{path}}` | A value, escaped. |
| `{{path\|inline}}` | Through a named filter. |
| `{{path\|raw}}` | Already HTML, inserted as it is. |
| `{{#path}}…{{/path}}` | Once if truthy. Once per item if an array. |
| `{{^path}}…{{/path}}` | Once if falsy or empty. |
| `{{! … }}` | Dropped. |

A section over an array may say how to join its items:

```html
{{#rows join="\n"}}<div class="labels-row">{{name}}</div>{{/rows}}
```

That is the one thing plain mustache cannot express and every list on a
slide needs: the separator *between* rows matters and the one after the
last row is not wanted. The `\n` lands the next row where the section tag
itself sits, so a list nested two deep carries no count of spaces that
the output's indentation could later make wrong.

Inside a section an item's fields are in scope, and so are the enclosing
scopes, innermost first. A row's `body` therefore beats the slide's,
which is what you want.

Filters: `escape` (the default), `raw`, `inline`, `br`. A filter name
nothing provides stops the render and says which template asked for it.

### A template is laid out for whoever reads it

**Indent it, group it, leave blank lines between the parts.** None of
that reaches the slide, and none of it has to be checked against the
markup it produces. This is a rule, not a convenience: a template is
markup a person edits, and one with the output's indentation smuggled
into it stops being that.

| In the file | In the slide |
|---|---|
| A newline, however much space around it | one newline, at the output's own indent |
| A line indented past the template's own base | that nesting, kept |
| A blank line | nothing |
| A comment alone on its line | nothing |
| A space with no newline in it | exactly that space |

The last row is the one that matters: a newline between block elements
never meant anything, but the gap between two inline elements is a space
and losing it would run two words together. So a run of whitespace is
rewritten only when it contains a newline.

The template's own base indent is whatever its least-indented line uses,
so a file can sit at any depth. Nesting is measured against that, which
takes two lines at different depths to show — one indented line is just
an author who indents.

**A value is never touched.** A fenced transcript keeps its blank lines
and an inlined SVG keeps its shape: their newlines are held aside while
the layout is settled and put back afterwards. That is also why a section
which renders nothing leaves no blank line behind it, while a blank line
inside a `<pre>` survives.

## What a template is handed

Every template, without writing any JavaScript:

| Field | What it is |
|---|---|
| `meta` | The slide's front matter, plus what the headers carry: `{{meta.slide}}`, `{{meta.title}}`, `{{meta.group}}`, `{{meta.figure}}`. |
| `body` | This step's body, the script removed, trimmed. |
| `note` | This step's spoken script. Templates rarely want it. |
| `step` | This step's index in the slide, from 0. |
| `steps` | Every step of the slide. |
| `lastStep` | The slide's final step. **Reserve height from it.** |
| `bs` | `body` already split into blocks. |
| `sub` | The standfirst's text, or `''`. A template that never reaches for this makes a `>` line on its slides an error rather than a silent loss. |
| `fenced` | The first fenced block's content, fence removed. |
| `pairs` | `- line` + its indented note, as `{lead, note}`. |
| `imagePath` | URL prefix for figures and icons. Default `images`. |

Then whatever `<name>.js` returns, merged over the above.

## Writing a data function

```js
module.exports = {
  data({ body, meta, bs, step, lastStep, steps, t }) {
    return { rows: [/* … */] };          // merged into the template's scope
  },
};
```

One argument, always. A function that took the pieces separately would
have to be edited every time the engine learned to pass something new,
and the suite checks the arity for that reason.

`t` is the toolkit, for parsing a body into the shapes a template needs:

| Call | What it does |
|---|---|
| `t.esc(s)` | `&`, `<`, `>`, `"` to entities. |
| `t.inline(s)` | `esc`, then `**strong**` and `*em*`. |
| `t.br(s)` | `esc` each line, join with `<br>`. |
| `t.blocks(body)` | Body to blocks, blank-line separated, fences kept whole. |
| `t.standfirst(bs)` | The `>` block's text, or `''`. |
| `t.items(bs)` | Blocks to `{tag, head, body}` rows and `{lead}` paragraphs. |
| `t.figure.read(name)` | An SVG off disk, cached. |
| `t.figure.align(svg)` | Force `preserveAspectRatio` to the left edge. |
| `t.figure.names(meta)` | `layers:` split into an ordered list. |

**Return data, not markup.** A `data` that builds HTML has put the markup
back where this split took it from. `image.js` is the one place that
returns a fragment, because inlining an SVG and hiding groups inside it is
a transform on a document rather than a template's job.

## Class names

**A class a template writes is prefixed with the template's name.**
`title.html` writes `title-kicker`, `acrostic.html` writes
`acrostic-kicker`, and the two can be styled apart without a
`.slide.template-title` qualifier in front of them. A rule in a template's sheet
names the file that emits it, which is the whole reason for the
convention.

Seven names are deliberately shared, and a tenth template gets them for
free:

| Shared | What it is |
|---|---|
| `rule` `wide` | the horizontal rule, and its full-bleed variant |
| `hidden-step` | present, holding height, not yet reached |
| `first` `last` | the ends of a run of rows |
| `ghost` `over` | a standfirst reserving height, and the one laid over it |

Everything else is prefixed. The suite fails on a class that is neither.

## Adding a template

1. Write `<talk>/templates/<name>.html`.
2. Add `<talk>/templates/<name>.js` only if something has to be computed.
3. Style it in `templates/<name>.css`, beside the markup. The slide carries
   `template-<name>`; prefix the classes it writes with `<name>-`, per
   the section above.
4. Add a slide of it to your `deck.md`.

Steps 1 and 2 are in **your talk's** `templates/`, not a shared one.
Step 4 is not optional and the suite enforces it, for the example's own
templates: one that nothing renders can break without saying so, and the
example is what a second talk gets copied from, so a rotted one would be
inherited rather than discovered.

## How a build reserves its height

A step states what it adds, and the parser hands a template everything
the slide has shown so far. What a step has *not* reached yet is still
rendered and then hidden with `hidden-step`, rather than left out.

This is the rule most likely to be got wrong in a new template. Leaving a row
out re-centres the stage, and the line the room is reading jumps as the
next one lands. Reserve from `lastStep`, hide what has not arrived.

`icon-list.js` reserves from the *longest* standfirst rather than the
last, because length stands in for height when the measure and the type
are the same on every step.

## Failures, and where they surface

| What is wrong | When it stops | What it says |
|---|---|---|
| A section never closed, or closed by the wrong name | Load | the template, and both names |
| A placeholder naming no filter | Load | the template, the tag, the filter |
| `<name>.js` with no `<name>.html` | Load | the orphaned file |
| `<name>.js` exporting no `data` | Load | the file |
| A class written but never styled, or styled but never written | Test | the class |
| A class a template writes without its prefix | Test | the class and the prefix it wanted |
| A deck naming a template its talk does not have | Render | every such slide, and the set it does have |
| A `>` standfirst a template never prints | Render | the slide, and the template ignoring it |
| A deck still using the old `kind:` key | Render | every such slide, and what to write instead |
| A deck in the old `---` shape | Render | that `---` opened a slide, and what opens one now |
| A `slide:`, `group:`, `title:` or `word:` key | Render | the key, and which header took it over |
| A `##` line with no number on it | Render | the line, and the two headers it could have been |
| Front matter running into the body | Render | the stray line, and the blank line that separates them |
| A talk with no `templates/` folder | Render | the folder looked for, and where to copy one from |

`css/theme.css` is the frame and styles no template's slides, so their rules
belong in that template's own sheet. The suite fails if a `.template-`
rule appears in the shared sheet.

Every one stops rather than degrades, and every one is caught when the
templates are compiled rather than when a deck first reaches that one.
An unclosed section in a template nobody reached would otherwise surface
in a room.
