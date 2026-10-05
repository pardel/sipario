# SSML: directing the voice

`sipario voice` reads each step's script aloud ([VOICE.md](VOICE.md)). A
script can tell it how, with a few SSML tags: where to pause, what an
abbreviation stands for, how to read a number, a date or a phone number,
when to slow down, speak up or change language. This file is the one
reference for those tags: every tag, every value and what it comes to,
what is refused and why, and what was measured.

The tag set is
[Vonage's](https://developer.vonage.com/en/voice/voice-api/concepts/customizing-tts),
cut to what sipario can do itself with any engine. sipario reads the tags
and does the work; the engine is asked only to say words, with a language
when a `<lang>` gives one, so every direction but `<lang>` comes out the
same whichever engine speaks it.

**Two tags are not settled.** `<prosody pitch>` and `<lang>` work and are
checked by the suite, but whether they sound good enough to keep is
waiting on a listening test, Paul's call on 2026-10-04. Until it passes,
treat them as provisional: they may change, or go. Their sections say
what is known so far.

## Where the tags go

In the ```` ```notes ```` block, the step's script.

A tag may sit on a line of its own. The notes close up around it, so the
paragraph or the list it sits in stays one:

```notes
1. The relay counts the votes.
<break time="1s"/>
2. The deck shows them.
```

is still one list of two items on stage.

## What the notes show, and what the voice hears

On stage, in the notes window, on paper and in a PowerPoint export, the
notes show the script with the tags taken out. The voice hears the
directions.

- A `<sub>` shows its own text, never the alias: `<sub alias="A P I">API</sub>`
  shows "API".
- A `<say-as>` shows what you wrote, never the words it is read as:
  `<say-as interpret-as="date" format="dmy">6/10/2026</say-as>` shows
  "6/10/2026".
- `&lt;`, `&gt;` and `&amp;` show as `<`, `>` and `&`.

A script with no tags in it reads and sounds exactly as it did before
tags existed, unless it holds `&lt;`, `&gt;` or `&amp;`, or something
sipario reads as a tag ([Writing < and & in a script](#writing--and--in-a-script)).

## An example

The opening of *Your next customer is a robot*, directed:

```notes
<break time="1s"/>Imagine this scenario...

It's 2am on <say-as interpret-as="date" format="dmy">6/10/2026</say-as>,
and an agent is reading our <sub alias="A P I">API</sub> docs.
<prosody rate="slow">Nobody sent it, and nobody is watching it.</prosody>
```

The notes show "Imagine this scenario...", then "It's 2am on 6/10/2026,
and an agent is reading our API docs. Nobody sent it, and nobody is
watching it." The voice waits a second, then says "Imagine this
scenario... It's 2am on the sixth of October, twenty twenty-six, and an
agent is reading our A P I docs." as one request, and the last line as a
second, a tenth slower.

## The tags at a glance

| Tag | What the voice does |
|---|---|
| [`<break/>`](#break) | a silence of a set length |
| [`<p>`](#p-and-s) | a paragraph: silence either side |
| [`<s>`](#p-and-s) | a sentence: a full stop after it if it has none |
| [`<sub>`](#sub) | says the alias in place of the text |
| [`<say-as>`](#say-as) | reads a number, date, time, phone number or letters into words, or bleeps a word |
| [`<prosody>`](#prosody) | slower or faster, quieter or louder, higher or lower |
| [`<lang>`](#lang) | asks the engine for another language |
| [`<speak>`](#speak) | nothing; it may wrap the whole script |

Attributes take `"` or `'`. A tag that holds nothing ends `/>`; every
other tag is closed.

## break

```notes
Two things.<break time="1.5s"/>First, the relay.
Second<break strength="weak"/>the deck.
```

A silence, written into the audio as silence, so it is exactly as long as
asked. It takes `time` or `strength`; with neither, it is `medium`.
Given both, `time` is used and `strength` ignored.

| Attribute | Values | Comes to |
|---|---|---|
| `time` | seconds or milliseconds: `1s`, `1.5s`, `500ms` | that long, up to `10s` |
| `strength` | `none` | 0 s |
| | `x-weak` | 0.1 s |
| | `weak` | 0.25 s |
| | `medium`, and a bare `<break/>` | 0.4 s |
| | `strong` | 0.75 s |
| | `x-strong` | 1.2 s |

`strength="none"`, like `time="0s"`, is no pause at all: the words either
side are sent as one request, a space apart, as the notes show them. Two
breaks side by side add, since each was asked for. A break longer than
10 s stops the render.

The silence is exact; what the listener hears around it is not quite.
See [Clip edges](#clip-edges).

## p and s

```notes
<p>The room is the audience's phones.</p>
<p>The relay counts what they send.</p>
```

`<p>` is a paragraph: 0.6 s of silence before it and after it. Two
paragraphs side by side share one 0.6 s, not two. A break beside a
paragraph meets its 0.6 s as the longer of the two rather than adding to
it. A paragraph's silence at the very start or very end of a step is
dropped, because the step before ends and the next begins without it; a
`<break>` there was asked for, and stays.

`<s>` is a sentence: a full stop after it if it has no ending of its own
(`.`, `!`, `?`, `…`, `;`, `:` or `,`). Sentences side by side stay one
request: `<s>Hello</s><s>World?</s>` is sent as "Hello. World?".

Neither takes an attribute. A `<p>` inside a `<p>` or an `<s>`, and an
`<s>` inside an `<s>`, are refused: they mean nothing.

Use `<p>` or `<break>` for a pause between paragraphs. A blank line is
not one: the voice is sent the script with its lines joined
([Without tags](#without-tags-what-the-punctuation-does)).

## sub

```notes
Our <sub alias="A P I">API</sub> speaks <sub alias="M C P">MCP</sub>.
```

The voice says `alias` in place of the text; the notes show the text.
`alias` is required, and is any text with at least one letter or digit
in it: an alias of punctuation alone would be said as nothing, so it is
refused.

A `<sub>` stays inside the sentence around it: the engine is sent "Our A
P I speaks M C P." as one request.

Use it for an abbreviation, a word the engine says wrongly (spelled as it
sounds, `<sub alias="tom-AH-toe">tomato</sub>`), or a URL, which written
out is read as "https colon slash slash".

`<sub>` holds text only; a tag inside it is refused.

## say-as

```notes
Since <say-as interpret-as="date" format="dmy">3/10/2026</say-as>,
<say-as interpret-as="cardinal">1,500</say-as> agents have called.
```

Reads its text into words before the engine sees it, in English, the
British way. The words stay inside the sentence around it, as with
`<sub>`; only a bleep splits it. `interpret-as` is required; `format` is
for a date, is required there, and is refused on anything else.
`<say-as>` holds text only; a tag inside it is refused.

| interpret-as | Writes | Reads |
|---|---|---|
| `cardinal` | `2026`, `1,500`, `-3.14` | two thousand and twenty-six; one thousand five hundred; minus three point one four |
| `ordinal` | `3`, `21st` | third; twenty-first |
| `digits` | `4071` | four zero seven one |
| `character` | `MCP`, `W3C` | M, C, P; W, three, C |
| `telephone` | `020 7946 0958`, `+44 20 7946 0958`, `1234567` | oh two oh, seven nine four six, oh nine five eight; plus four four, two oh, seven nine four six, oh nine five eight; one two three, four five six seven |
| `date` | `3/10/2026` with `format="dmy"` | the third of October, twenty twenty-six |
| `time` | `30"`, `1'30"`, `1:30`, `1:02:30` | thirty seconds; one minute thirty seconds; one minute thirty seconds; one hour two minutes thirty seconds |
| `expletive` | a word | a bleep |

**cardinal.** A whole number, with or without commas between thousands,
optionally signed and with a decimal part. `-` or `−` reads "minus", `+`
is not read, and the decimal part is read digit by digit, "three point
one four". "And" goes where British English puts it: "one hundred and
five". Up to 999 trillion; a larger number stops the render.

**ordinal.** A whole number, with or without `st`, `nd`, `rd` or `th`
after it.

**digits.** Each digit as a word, 0 as "zero". Spaces are allowed and
not read.

**character.** Each letter and digit on its own, letters as capitals,
digits as words, a comma between them. Spaces, `.`, `_` and `-` are left
out; anything else is refused. The commas are there because without them
Qwen3-TTS read letters as a word ([Measured](#spelling)).

**telephone.** Digits, spaces, `( ) - .` and a leading `+`. The number is
read in the groups you wrote, 0 as "oh", a leading `+` as "plus", a comma
between groups, where the engine pauses briefly
([Measured](#phone-numbers)). A number written without separators, more
than four digits long, is read in threes, a single digit left at the end
joining the last group: `1234567` is "one two three, four five six
seven".

**date.** Numbers separated by `/`, `-`, `.` or a space, in the order
`format` gives:

| format | Writes | Reads |
|---|---|---|
| `dmy` | `3/10/2026` | the third of October, twenty twenty-six |
| `mdy` | `10/3/2026` | the third of October, twenty twenty-six |
| `ymd` | `2026-10-03` | the third of October, twenty twenty-six |
| `yyyymmdd` | `20261003`, eight digits together | the third of October, twenty twenty-six |
| `dm`, `md` | `3/10`, `10/3` | the third of October |
| `ym`, `my` | `2026/10`, `10/2026` | October twenty twenty-six |
| `d` | `3` | the third |
| `m` | `10` | October |
| `y` | `2026`, `2005`, `1905`, `1900` | twenty twenty-six; two thousand and five; nineteen oh five; nineteen hundred |

Whatever the order written, it is read the British way: the day as an
ordinal before the month, and the year as it is said. A date that is not
one (a month 13, a 30 February, a 29 February outside a leap year) stops
the render.

**time.** A length of time, not a time of day: `30"`, `1'30"`, `1:30` or
`1:02:30`. Curly quotes and primes are read as `'` and `"`. More than 59
in a place that counts to 59 stops the render.

**expletive.** The word is not sent to the engine. In its place is a
1 kHz tone about as long as the word would have taken: 0.075 s a
character, at least 0.3 s. It takes the volume around it, so it is
silent inside a `silent`, and is stretched with the rate around it. Like
a `<break>`, it splits the sentence around it into two requests.

Vonage's `fraction`, `unit` and `address` are refused
([What is refused](#what-is-refused)).

## prosody

```notes
<prosody rate="slow">Nobody sent it.</prosody>
<prosody volume="soft">And nobody is watching it.</prosody>
```

Changes how the voice sounds, not what it says. Each is applied by
ffmpeg to the audio the engine returned, after the clip is cached, so
changing one never asks the engine again. A `<prosody>` takes any of
`rate`, `volume` and `pitch`, and at least one: one with none is refused.

### rate

Slower or faster, pitch unchanged.

| Value | Factor |
|---|---|
| `x-slow` | 0.75× |
| `slow` | 0.9× |
| `medium` | 1× |
| `fast` | 1.1× |
| `x-fast` | 1.25× |
| `50%` to `200%` | a percentage of the voice's own, written without a sign: `80%` is 0.8× |

A rate always replaces the one around it; it never compounds. `slow`
inside `fast` is 0.9×.

### volume

Quieter or louder.

| Value | Gain |
|---|---|
| `default`, `medium` | 0 dB |
| `x-soft` | -10 dB |
| `soft` | -5 dB |
| `loud` | +4 dB |
| `x-loud` | +8 dB |
| `silent` | no sound, for as long as the words take |
| `-40dB` to `+12dB` | that change, written with its sign: `+3dB`, `-6dB` |

Volume above 0 dB is held under -1 dBFS by a limiter, so it does not
clip, and a clip that arrives with its peaks near full scale gains less
than asked. Qwen3-TTS clips do ([Measured](#loudness)), so on that engine
the top of the range sounds much like `x-loud`. Quieter is exact.

### pitch

> **Awaiting a listening test** (Paul's call, 2026-10-04). Pitch is read,
> applied and checked, but nobody has yet judged whether a moved voice
> sounds good enough to keep. Until that passes it may change or go.

Higher or lower, length unchanged.

| Value | Change |
|---|---|
| `default`, `medium` | 0 |
| `x-low` | -4 semitones |
| `low` | -2 semitones |
| `high` | +2 semitones |
| `x-high` | +4 semitones |
| `-50%` to `+100%` | that change in frequency, written with its sign: `+100%` is an octave up (+12 semitones), `-50%` an octave down (-12), `+10%` about +1.65 |

Pitch is moved by playing the clip faster or slower and stretching it
back to its length, because the ffmpeg sipario runs on has no rubberband.
That method costs quality: past a few semitones the voice is heard as
processed. That is a property of the method, not a measurement.

## lang

> **Awaiting a listening test** (Paul's call, 2026-10-04). The language
> reaches the engine and the engine speaks it, but nobody has yet listened
> for whether it sounds more like the language than the same words sent
> without one. Until that passes it may change or go.

```notes
Ciao, <lang xml:lang="it-IT">buongiorno a tutti</lang>, and welcome.
```

The text inside is sent to the engine as a request of its own, with its
language as `language` ([VOICE.md](VOICE.md), the protocol).
`xml:lang` is required and is a language tag: `it-IT`, `fr`, `en-GB`.
The comma after the `</lang>` goes with the words before it, so the
example is three requests: "Ciao,", "buongiorno a tutti," in Italian, and
"and welcome.".

What the engine does with it is the engine's: Qwen3-TTS speaks the ten
languages its checkpoint lists, by the tag's first part, and refuses any
other; Chatterbox refuses anything but English. A refusal stops the run,
named with the step. On 2026-10-04 an Italian line sent as `it-IT` and
the same line sent with no language both came back from a transcriber
word for word ([VOICE.md](VOICE.md), Languages); how much more Italian
the first sounds is for the ear.

## speak

Does nothing. It is there so a script can be wrapped like an SSML
document; a `<speak>` inside any other tag is refused.

## Nesting

Tags nest, and the inner one wins where they disagree.

- **A signed value is a change** to the voice around it, as in SSML. A
  `volume="+3dB"` inside an `x-soft` is -7 dB; a `pitch="+10%"` inside a
  `low` is a little less low (about -0.35 semitones).
- **A named value, and any rate, is the voice's own** and replaces the
  one around it: `soft` inside `loud` is -5 dB.
- **A change that takes the voice past the ranges** (-40 dB to +12 dB,
  -50% to +100% in pitch) stops the render: `+6dB` inside `x-loud` would
  come to +14 dB.
- `<sub>` and `<say-as>` hold text only. `<p>` does not nest, and cannot
  sit in an `<s>`; `<s>` does not nest. `<speak>` sits inside nothing.
- A tag must be closed in the order it was opened, and must hold some
  text.

## Writing < and & in a script

`&lt;`, `&gt;` and `&amp;` are the only entities, and stand for `<`, `>`
and `&` in text and in attribute values alike. Any other `&` is text.

A `<` that opens no whole tag is text, so "x < 5", "a<b",
`<https://example.com>` and `<paul@pardel.dev>` need nothing. The
exception is a `<` followed by the name of a tag sipario reads or
refuses: `<break time=1s/>` is a tag written wrongly, not words, and
stops the render.

Anything that is a whole tag is read as one, so `<Enter>` or `Vector<T>`
stop the render as tags sipario does not read. Write `&lt;Enter&gt;` and
`Vector&lt;T&gt;`.

## What is refused

A refused tag stops the render, named with its slide, its step and the
reason; every step that has one is named at once, not just the first. It
is refused rather than passed over because a direction the voice would
ignore, left sitting in a script, looks obeyed.

| Refused | Why | Write instead |
|---|---|---|
| `<emphasis>` | no voice engine sipario drives can stress a word | rewrite the line so the word carries itself, or set it apart with `<break/>` or `<prosody rate="slow">` |
| `<phoneme>` | not read | the word spelled as it sounds, `<sub alias="tom-AH-toe">tomato</sub>` |
| `<say-as>` as `fraction`, `unit` or `address` | not read into words here | the words as they are said: "three quarters", "five kilograms" |
| any other tag, HTML included | not read | the text without it, or `&lt;` for a `<` meant as text |
| an attribute a tag does not take, or the same one twice | not read | the attributes in the sections above |
| a value not in the tables, a date that is not one, a number too large | the voice cannot say it | a value from the tables |
| a `<sub>` whose alias has no letter or digit | the voice would say nothing | an alias with words in it |
| a tag left open, closed out of order, or holding no text | the direction has no extent | close it around the words it directs |
| `<p>` in `<p>` or `<s>`, `<s>` in `<s>`, `<speak>` inside anything, any tag inside `<sub>` or `<say-as>` | the nesting means nothing | see [Nesting](#nesting) |
| a comment or a declaration, `<!-- -->` or `<?xml?>` | not read | take it out |

## How a directed script is spoken

The script is split into runs of text between its pauses and its changes
of voice. Each run is one request to the engine; text beside text in the
same voice is one run, so a `<sub>` or any `<say-as>` but `expletive`
keeps the sentence around it whole. A pause is written as silence, a
bleep as a tone, and the volume, rate and pitch of a run are applied to
its audio afterwards.

A `<break>`, a `<p>`, a `<prosody>` that changes the voice, a `<lang>`
or an expletive in the middle of a sentence therefore splits it into
separate requests, and the engine starts each one fresh. A run of a
word or two can come out flatter than the same words inside a sentence.
Direct the places that need it, not every line.

## Measured on Qwen3-TTS

Measured on one engine and one voice, a Qwen3-TTS clone through the
adapter in [VOICE.md](VOICE.md), on 2026-10-04. Another engine or voice
may differ.

### Clip edges

A break's silence is exact, but the clips either side keep whatever
quiet the engine left at their ends, so the pause heard is longer than
the one written by that much. It varies from clip to clip: 0 to 0.12 s of
quiet below -45 dBFS on four clips.

### Loudness

The limiter that keeps a louder clip from clipping takes back some of
what was asked, because Qwen3-TTS clips arrive with their peaks near full
scale. On two clips: `+4dB` gave +3.3 dB, `+8dB` (`x-loud`) +5.1 to
+5.4 dB, and `+12dB` +6.3 to +6.8 dB. Quieter is exact.

### Spelling

Read back by faster-whisper: letters with nothing between them ran into a
word (CAT, NASA and GIF heard as words); with a space between them GIF
was still heard as a word; with a hyphen or a comma every one was
spelled, the comma the most apart, 0.25 to 0.58 s a letter. Glued dots
read W.3.C. as "W2HTHD". `character` puts a comma between them for this
reason.

### Phone numbers

The engine paused 0.16 to 0.19 s at the comma between groups. Exact
silences would make each group a request of two or three words of its
own, which a model reads worse than a sentence, so the number stays one
request with commas in it.

### Without tags: what the punctuation does

Measured on the same voice, the same day: 767 clips, each variant
against the spread four seeds give the same words. These are the effects
that held there.

- **A punctuation mark gives a pause, but not a length.** Any mark adds
  about 0.2 to 0.3 s over none; a full stop is the longest, and a comma,
  `;`, `:`, a dash and `...` are within noise of each other. For a pause
  of a set length, use `<break>`.
- **Short sentences pause more.** Splitting long sentences added 0.6 to
  1.2 s of pause across a ten-second passage without speeding the words.
- **A `?` rises.** About four to five semitones at the end; a tag question
  ("…, right?") rises no higher.
- **A word set off as its own phrase,** between commas or dashes, comes out
  a little longer and higher. It is phrasing, not stress.
- **Blank lines and line breaks are not pauses.** The voice is sent the
  script with its lines joined, so a new paragraph sounds like a space.
  Use `<p>` or `<break>`.
- **No effect:** `!`, `*italic*` and `**bold**` (taken out before the
  voice hears them), quotes, repeating a word. CAPITALS may be spelled
  letter by letter.
- **Write a URL as it is said**, or put it in `<sub alias="…">`: written
  out, `https://` is read as "https colon slash slash".
- **The same words do not come out the same way twice.** Between
  generations a pause moves by about 0.2 s and the pitch at the end by
  about 3.6 semitones, so a punctuation effect is no bigger than that
  noise. Only `<break>`, `<p>` and `<prosody>` are exact.
