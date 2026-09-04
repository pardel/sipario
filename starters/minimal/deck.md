name: Minimal
title: Minimal — white paper, slate ink, one teal rule

# Title

## 1.1 White paper, slate ink, one teal rule
id: 1-a-slide-of-every-template
template: title
kicker: MINIMAL
subtitle: Raleway for the headings, Inter for the words, and a bar of teal on every slide
author: Mario Rossi

```notes
This deck exists twice over. It is the shortest thing that shows
every template in one place, and it is the fixture the test suite renders
to prove each one still works.
```

# How

## 2.1 The keys
id: 2-the-keys
template: labels
align: tight

- (slate) `← →` Previous and next part of the talk
- (slate) `↓ ↑` Next and previous step, then slide, within a part
- (slate) `Home / End` First and last slide
- (slate) `P` Show or hide the notes beside the deck
- (slate) `D` Move the notes to their own window, or bring them back
- (slate) `A` In that window, put them back beside the deck
- (slate) `O` Overview of every slide; the arrows move the selection
- (slate) `Enter` In the overview, show the selected slide
- (slate) `F` Full screen
- (slate) `C` Check every slide for content running off the stage
- (slate) `R` Back to the start, forgetting where each movement was left
- (slate) `?` This help

```notes
Everything the keyboard does, word for word what the deck's own help
shows on a question mark; the suite holds the two to one list. Left and
right move between the parts of the talk; down and up read within one, a
step at a time.
```

# Templates

## 3.1
id: 3-templates
template: section
letter: T

A letter the size of the stage, on the grid.

- The title page
- An act break
- A statement, line by line
- Rows led by an icon
- Labels and what they mean
- A terminal, verbatim
- A diff, the change coloured
- A directory listing
- A file under its path
- A figure, whole or in layers
- An acrostic
- The closing page

```notes
T is for Templates. A section slide opens a movement: the letter in teal at
the size of a whole word, the word beside it, on the sunk ground with the
grid showing through.
```

## 3.2 1. The title page
id: 3-the-title-page
template: title
kicker: MINIMAL
subtitle: A kicker above, a standfirst below, the rule, and a name
author: Mario Rossi

```notes
The title template, shown as one of the twelve. The deck's own opening
slide uses it too; this one is here so the programme runs in order.
```

## 3.3 2. An act break
id: 3-an-act-break
template: section
letter: A

A letter the size of the stage, a word, a rule and a line.

```notes
The section template, shown as one of the twelve. The one that opened
this movement uses it too, with the programme under its line.
```

## 3.4 3. A statement, line by line
id: 3-a-statement-arrives-a-line-at-a-time
template: statement

One bar of teal under every heading.

```notes
A statement is the plainest of them. One line, set large, with nothing
else on the stage competing with it.
```

--

Slate for the words, white for the room.

```notes
Add a step and the next line lands under the first. The line
already given stays exactly where it was, because the height was reserved
from the last step rather than grown into.
```

## 3.5 4. Rows led by an icon
id: 3-an-icon-list-builds-a-row-at-a-time
template: icon-list
align: spread

> Rows of an icon, a heading and a line, and a standfirst that may reword

A list can open with a line of its own before its first row.

- (file-text) **One file per template**
  A template is read on its own, because it is handed everything it uses.

```notes
An icon list is rows. Each row is an icon, a heading and a line
under it, and a bare paragraph among them is a lead rather than a row.
```

--

> Rewording, mid-build

- (folder) **Discovered, not listed**
  The registry reads the folder, so nothing in the engine names one.

- (check) **Checked at load**
  A template of the wrong shape is refused by name, not at the slide.

```notes
The rows this step has not reached are already on the stage,
hidden. That is what stops the block shifting under itself as it builds.
The standfirst has changed, and the rows did not move: the longest one on
the slide is held invisible under it to reserve the height.
```

## 3.6 5. Labels and what they mean
id: 3-labels-carry-a-palette-token
template: labels

- (green) `verified` checked against a source, which supports it
- (slate) `unverified` a source exists, the claim was not checked
- (red) `blocked` verification was attempted and failed
- (indigo) `inferred` not in any source, and said so rather than smuggled in

```notes
A label row is an ink, a name and a gloss. The ink names a palette
token rather than a colour, so restyling the theme restyles these too.
```

## 3.7 6. A terminal, verbatim
id: 3-a-terminal-is-set-verbatim
template: term
caption: Shown as it printed, because that is the point of showing it

```
$ npm test

  ok    every template in the registry compiles
  ok    the example deck renders
  ok    every template is exercised by the example deck

all checks passed
```

```notes
A term slide is a fenced block, set exactly as it came out. Nothing
reflows it and nothing prettifies it.
```

## 3.8 7. A diff, the change coloured
id: 3-a-diff-shows-the-correction
template: diff
file: src/greeting.js
caption: A `+` or a `-` in the first column colours the line. Nothing else is marked up, so what is on the slide is what came out of the tool.

```
 function greet(name) {
-  return "hello " + name;
+  return `hello ${name}`;
 }
```

```notes
A diff slide is pasted, not written. The template reads the first
character of each line and colours it, which is the only thing a
stylesheet cannot do for itself.
```

## 3.9 8. A directory listing
id: 3-a-listing-is-a-listing
template: tree
caption: Two or more spaces separate a path from its note. Indentation is kept, because it is what makes a tree a tree.

```
src/
  greeting.js       the one function
  index.js
test/
  greeting.test.js  and its test
README.md           what this is
```

```notes
A tree slide is a directory listing with a note against the rows that
earn one. A drawn picture of a folder structure is a picture of
something the room already reads fluently.
```

## 3.10 9. A file under its path
id: 3-a-file-under-its-path
template: file
file: README.md
caption: The path is the credibility: it says these words were not written for the slide

```
# greeting

One function. It takes a name and returns a greeting.
```

```notes
A file slide sets what is on disk, under the path it is at. A terminal
prints a session, which is a different thing and reads differently.
```

## 3.11 10. A figure, whole
id: 3-a-figure-that-arrives-whole
template: image
figure: one-piece
caption: Named from the folder beside the deck

```notes
An image slide with no layers is a picture that arrives whole. It
is an img tag pointing at the images folder beside this file.
```

## 3.12 10. A figure, in layers
id: 3-a-figure-revealed-a-layer-at-a-time
template: image
figure: in-layers
layers: source, output
caption: The caption is the last thing to arrive

```notes
Name the groups in the SVG and they are revealed one per step.
```

--

```notes
The second layer lands. The figure never moves under itself,
because the whole thing was always there and the parts not yet reached
were hidden rather than absent.
```

--

```notes
The caption arrives last, so the picture is read before it is told
what to make of it.
```

## 3.13 11. An acrostic
id: 3-an-acrostic-holds-the-spine
template: acrostic
kicker: MINIMAL

- **M** Markdown — the talk is one file, and that file is the source
- **I** Icons — named from a folder, not pasted in
- **N** Now — twelve templates, and the set is open

```notes
An acrostic is the shape a framework's name makes. A letter, a word
and a gloss, per row.
```

## 3.14 12. The closing page
id: 3-the-closing-page
template: close
colophon: a colophon along the foot · one dot between its parts

> A standfirst, then where to find things

- `a path`
  And a line saying what is there

```notes
The close template, shown as the last of the twelve. The deck's own last
slide uses it too, one movement on.
```

# Close

## 4.1 TAKE IT
id: 4-take-it
template: close
colophon: starters/minimal · docs/AUTHORING.md · docs/TEMPLATES.md

> A slide of every template

- `docs/AUTHORING.md`
  The deck.md format, and what each template needs in its front matter
- `docs/TEMPLATES.md`
  What a template is handed, what it returns, and how to add a tenth

```notes
Copy this folder, rewrite the slides, keep the shape. That is the
whole of starting a second talk.
```
