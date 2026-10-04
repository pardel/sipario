# A voice for the script

`sipario voice` reads a talk's script aloud in your own voice. A voice
engine on your machine listens to ten seconds of a take you recorded,
then speaks every step's ```notes block in that voice, and the result is
a take like any other: `export video` makes a video of it, and `sipario
takes` lists it.

```bash
npx sipario voice                   # the latest live take's voice, every step read
npx sipario export video            # the video of the take just made
```

sipario ships no voice model and depends on none. The engine is borrowed
from the machine the way ffmpeg and the browser are, named by
`SIPARIO_TTS`; this page sets up [Chatterbox](https://github.com/resemble-ai/chatterbox),
a local model from Resemble AI under the MIT licence, as one. Your voice
never leaves the machine.

## What it does, and what it does not

- **It reads the script, not the talk.** Each step's notes are spoken as
  written, in the deck's order, one after the other. What you ad-lib in the
  room is not in them, and the pacing is the engine's, not yours.
- **A step with no script is held silent** for two seconds, or for
  `--hold <seconds>`, and never sent to the engine. Every step is in the
  take, a step of a build with nothing to say included.
- **It always makes a new take.** The live take the voice came from is
  read and never written; the voiced take sits beside it, with its own
  `voice.wav`, the sample it was cloned from and its `take.json`.
- **It keeps every clip.** Each step's clip is kept in sipario's data
  folder (`voice/<deck>/`), named by a hash of what the engine says of
  itself, the sample and the script. A run stopped part way, by a crash or
  by Ctrl-C, keeps every clip it finished, and the next run starts where
  it stopped; an edit to one step's script means one new clip. Both hold
  while the sample does: a newer live take is a new sample, so the next
  run voices every step again, in the voice cut from that take. `--from
  <take>` keeps the voice, and the clips, of the take named. So does an
  engine that says nothing new of itself: a new release of it voices every
  step again.
- **It does not re-voice part of a live take.** A take is either your
  recording or the engine's reading of the whole script.
- **It does not choose for you which take is the video.** `export video`
  takes the latest take of either kind, and says which kind it took:
  `(live)` or `(voiced from <take>)`. `--take` names another.

## Consent

Clone your own voice, and nobody else's. sipario holds to that as far as
a tool can: the sample is cut only from a **live** take of the deck, a
recording made with <kbd>V</kbd> in the notes window, and never from a
voiced take (a clone of a clone drifts further from the voice each time,
and is not a recording of anybody) or from a file handed in from
elsewhere. `--from <take>` names which live take; a voiced take named
there is refused.

What sipario cannot know is whose voice is on a live take. If someone else
gave the talk with <kbd>V</kbd> on, their voice is in it; do not voice a
deck from their take without asking them.

## The watermark

Every clip Chatterbox makes carries Resemble AI's
[Perth](https://github.com/resemble-ai/Perth) watermark: an inaudible mark
that a detector can find in the audio, there so that synthetic speech can
be told from a recording. Chatterbox applies it to every output and has no
switch for it, and sipario keeps it: the take's audio is the clips joined
end to end, never filtered. Perth's own detector found it in a voiced
take's audio as read back out of the exported video's AAC, and in a clip
re-encoded to MP3 (both checked 2026-10-03).
A voiced take also says what it is in its own `take.json` (`kind:
"voiced"`, and which steps are synthetic), so the take does not pass for a
recording even to a reader without a detector.

## Running it

```
sipario voice [path/to/talk] [--from <live take>] [--hold <seconds>]
```

1. **The sample.** From the latest live take, or the one `--from` names,
   sipario finds ten seconds of speech with ffmpeg's `silencedetect`:
   anything quieter than -35 dB for a second or more is a pause, and the
   first stretch of ten seconds without one is cut out, as a 24 kHz mono
   WAV. Ten, because Chatterbox listens to the first ten seconds of a
   sample and no more. Natural speech pauses for breath every few seconds,
   which is why a pause is a second and not less. With no stretch of ten,
   the longest serves, down to five seconds; a take without five seconds
   of speech at a stretch is refused, with the longest it found.
2. **The engine** is started once for the run and reports that it is
   ready. Its log is shown while it gets ready (the first run downloads
   the model), and kept afterwards for any error.
3. **Each step**, in the deck's order, is taken from the clip cache or
   sent to the engine, a line on stderr each:
   `[voice] 3/7 0-outside: 18.42s, new in 24.0s`.
4. **The take**: every clip converted to 24 kHz mono 16-bit, the silences
   written for the steps with no script, all of it joined into
   `voice.wav`, and `take.json` written last. Where each step begins is
   counted in frames from the clips' own WAV headers, so the steps sit on
   their words to the sample, however long the deck.

The engine is started even when every clip is already in the cache,
because a clip is cached under what the engine says of itself, and only
the engine can say it.

### What a voiced take keeps

`take.json` has the shape of a live take's, so whatever reads one reads
the other:

```json
{
  "version": 1,
  "kind": "voiced",
  "source": "20261003-221126-sm7d",
  "audio": "voice.wav",
  "created": "2026-10-03T22:40:00.000Z",
  "deck": "sipario:my-talk",
  "length": 312.4,
  "marks": [{ "id": "0-title", "t": 0, "v": "deck:4f1c2a9be03d" }],
  "notes": { "deck:4f1c2a9be03d": { "0-title": "Good afternoon…" } },
  "voice": {
    "engine": "chatterbox",
    "ready": { "ready": true, "engine": "chatterbox", "version": "0.1.7", "device": "mps", "sr": 24000,
               "watermark": "perth", "limit": 300, "pause": 0.25 },
    "sample": { "take": "20261003-221126-sm7d", "offset": 203.56, "length": 10, "file": "sample.wav" },
    "synthetic": ["0-title"],
    "held": [],
    "hold": 2
  }
}
```

`source` is the live take the voice was cloned from. A mark's script is
`notes[mark.v][mark.id]`, for either kind of take. A live take's version
`v` is the server's reload token, a number; a voiced take's is `deck:` and
the first twelve hex digits of the SHA-256 of the `deck.md` it was read
from, which cannot be mistaken for a reload token and is the same for
every run over the same draft.

## The protocol

`SIPARIO_TTS` names one executable, by an absolute path or a name on
`PATH`. It is run with no arguments and no shell, once per `sipario
voice`, with stdin and stdout as pipes and stderr as its log. Any program
that does the following is an engine:

1. **Ready.** Once it can serve, it writes one line to stdout:
   `{"ready": true, "engine": "<name>", ...}`. `engine` names it, and the
   line is kept in the take as said. Clips are cached under the whole
   line, so put in it whatever would change the voice it makes (its
   release, the device, a setting) and nothing that changes from one run
   to the next, such as a time or a process id, or no clip is ever found
   again. sipario waits ten minutes for this line, for a first run that
   downloads a model.
2. **Requests.** sipario writes one JSON object a line to stdin,
   `{"id": "<step id>", "text": "<the script>", "sample": "<path>",
   "out": "<path>"}`, and waits for the reply before it sends the next.
   `sample` is a WAV of the voice to speak in; `out` is where to write
   the clip, a path ending `.wav` in a folder that exists. Both are
   absolute.
3. **Replies.** For each request, exactly one line on stdout:
   `{"id": "<the same id>", "ok": true, "out": "<path>"}` once the clip is
   written and closed, or `{"id": "<the same id>", "ok": false, "error":
   "<what went wrong>"}`. The clip is a WAV, PCM (8 to 32 bits) or IEEE
   float, any rate and any number of channels; sipario converts it.
4. **The end.** When stdin closes, the engine exits.

Text is sent whole, however long: if the engine can say only so much at
once, splitting it is the engine's job. Stdout carries protocol lines and
nothing else; a line on it that is not JSON ends the run, named, because a
library printing there could as well print half way through a reply.
sipario renames a clip into the cache only after the reply says `ok` and
the file reads as a whole WAV, so an engine killed mid-clip leaves nothing
that looks complete.

A request is given two minutes and half a second for each character of
its text; past that, or on an engine that exits, the engine is killed and
the run stops, named with the step and the last lines the engine wrote on
stderr.

## Chatterbox, set up as an engine

Measured on 2026-10-03 on an Apple M4 Max with Chatterbox 0.1.7 and
Python 3.11. It needs [uv](https://docs.astral.sh/uv/) (`brew install
uv`), or plain `python3 -m venv` and `pip` in the same steps.

```bash
uv venv --python 3.11 ~/.local/share/sipario-tts
VIRTUAL_ENV=~/.local/share/sipario-tts uv pip install chatterbox-tts 'setuptools<81'
```

**Why `setuptools<81`.** Chatterbox marks every clip with Perth, and Perth
1.0.1 imports `pkg_resources`, which a uv venv does not have and setuptools
81 removed. Without it the watermarker does not load and Chatterbox stops
at its first line with `TypeError: 'NoneType' object is not callable`,
rather than speak without a watermark. The venv is about 1 GB.

Save the adapter below as `~/.local/share/sipario-tts/sipario-tts`, change
its first line to that venv's Python if your home is not `/Users/you`, and
make it executable:

```bash
chmod +x ~/.local/share/sipario-tts/sipario-tts
export SIPARIO_TTS=~/.local/share/sipario-tts/sipario-tts    # in your shell's profile
```

```python
#!/Users/you/.local/share/sipario-tts/bin/python
"""sipario-tts: Chatterbox (Resemble AI, MIT) speaking sipario's voice
protocol (docs/VOICE.md in sipario).

stdin:  one request a line, {"id", "text", "sample", "out"}
stdout: {"ready": true, ...} once the model is loaded, then one reply a
        request, {"id", "ok": true, "out"} or {"id", "ok": false, "error"}
stderr: everything else. Exits when stdin closes.

CHATTERBOX_DEVICE=cpu (or mps, or cuda) overrides the device it picks.
"""
import json
import os
import re
import sys

# Stdout is the protocol and nothing else. The libraries below print to it,
# from Python and from C, so before any of them loads, file descriptor 1 is
# pointed at stderr and the protocol keeps a copy of the real stdout.
proto = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS


def say(obj):
    proto.write(json.dumps(obj) + "\n")
    proto.flush()


device = os.environ.get("CHATTERBOX_DEVICE") or (
    "cuda" if torch.cuda.is_available()
    else "mps" if torch.backends.mps.is_available()
    else "cpu")
model = ChatterboxTTS.from_pretrained(device=device)

try:
    from importlib.metadata import version
    release = version("chatterbox-tts")
except Exception:
    release = None

# One generate() call stops at 1000 speech tokens, about 40 s of speech,
# and drops the rest without a word. So a script goes in pieces of at most
# LIMIT characters, broken at sentence ends and paragraphs, a sentence too
# long for one piece broken between words, joined by PAUSE seconds of
# silence.
LIMIT = 300
PAUSE = 0.25

# sipario caches each clip under this whole line, so everything that
# changes the voice is in it: the release, the device and the two settings
# above. Edit one and every step is voiced again.
say({"ready": True, "engine": "chatterbox", "version": release,
     "device": device, "sr": model.sr, "watermark": "perth",
     "limit": LIMIT, "pause": PAUSE})


def pieces(text):
    units = []
    for sentence in re.split(r"(?<=[.!?;:])\s+|\n\s*\n", text.strip()):
        cur = ""
        for word in sentence.split():
            if cur and len(cur) + 1 + len(word) > LIMIT:
                units.append(cur)
                cur = word
            else:
                cur = f"{cur} {word}".strip()
        if cur:
            units.append(cur)
    out, cur = [], ""
    for unit in units:
        if cur and len(cur) + 1 + len(unit) > LIMIT:
            out.append(cur)
            cur = unit
        else:
            cur = f"{cur} {unit}".strip()
    return out + ([cur] if cur else [])


voice = None          # the sample the model is conditioned on now
for line in sys.stdin:
    if not line.strip():
        continue
    rid = None
    try:
        req = json.loads(line)
        rid = req.get("id")
        # Conditioning on a sample takes seconds; a run sends the same one
        # for every step, so it is done once.
        key = (req["sample"], os.stat(req["sample"]).st_mtime_ns)
        if voice != key:
            model.prepare_conditionals(req["sample"])
            voice = key
        gap = torch.zeros(1, int(model.sr * PAUSE))
        clips = []
        for piece in pieces(req["text"]):
            clips += [model.generate(piece), gap]
        wav = torch.cat(clips[:-1], dim=1) if clips else torch.zeros(1, 0)
        torchaudio.save(req["out"], wav, model.sr, format="wav",
                        encoding="PCM_S", bits_per_sample=16)
        say({"id": rid, "ok": True, "out": req["out"],
             "seconds": wav.shape[-1] / model.sr})
    except Exception as e:
        say({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})
    finally:
        if device == "mps":
            torch.mps.empty_cache()
```

**The first run** downloads the model from Hugging Face into its cache
(`~/.cache/huggingface`, or `$HF_HOME`): about 3.2 GB, a few minutes on a
fast connection. sipario shows the engine's log while it waits, and waits
up to ten minutes for it to say it is ready; on a slow line, run the
adapter once by hand first (`echo | $SIPARIO_TTS`) and let the download
finish.

**Speed**, measured 2026-10-03 on an M4 Max (128 GB) with the model
cached: about 9 s from start to ready, then about 1.3 seconds of work for
each second of speech, so a 25-minute talk takes over half an hour to
voice. The first generation ever on a machine adds a one-off warm-up of
about 40 s on Apple's GPU. On the CPU a short step took about the same.
Smaller Macs are not measured; Chatterbox's issue tracker reports memory
growth over long runs on Apple's GPU and an error on an 8 GB M1, and
`CHATTERBOX_DEVICE=cpu` is the way round either.

## Something else as the engine

Anything that speaks the protocol above will do: another model, a hosted
service behind a small script, or `say` on a Mac for a quick listen to the
pacing (no clone, and a different `engine` name, so its clips never mix
with Chatterbox's in the cache). The sample is passed with every request;
an engine that does not clone may ignore it.

When the engine is a script that starts another program (a venv's Python,
a client for a hosted service), start that program with `exec`, so the
process sipario runs is the engine and not a shell waiting on it. sipario
stops a run by killing the engine's whole process group, which reaches a
program left as the script's child; one an engine moves into a group of
its own is the engine's to stop.
