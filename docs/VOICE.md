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
`SIPARIO_TTS`. This page sets up two local models as one:
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), from Alibaba's Qwen team
under the Apache-2.0 licence, the recommended engine, and
[Chatterbox](https://github.com/resemble-ai/chatterbox), from Resemble AI
under the MIT licence, the lighter alternative. Your voice never leaves
the machine.

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

Every clip either engine below makes carries Resemble AI's
[Perth](https://github.com/resemble-ai/Perth) watermark: an inaudible mark
that a detector can find in the audio, there so that synthetic speech can
be told from a recording. Chatterbox applies it to every output and has no
switch for it. Qwen3-TTS marks nothing it makes, so its adapter applies
Perth itself, reads the mark back off the very samples it is about to
write, and refuses the clip if the mark does not read. sipario keeps the
mark either way: the take's audio is the clips joined end to end, never
filtered. Perth's own detector found it in a Chatterbox take's audio as
read back out of the exported video's AAC, and in a clip re-encoded to MP3
(both checked 2026-10-03), and in a Qwen3-TTS take's `voice.wav` and its
video's AAC, where it read 1.0, against 0.0 on the speaker's own sample
(checked 2026-10-04).
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
   sample and no more, and Qwen3-TTS cloned a voice about as closely from
   ten seconds, levelled, as from thirty (0.85 against 0.86 in the measure
   under Chatterbox below, 2026-10-04). Natural speech pauses for breath every few seconds,
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
    "engine": "qwen3-tts",
    "ready": { "ready": true, "engine": "qwen3-tts", "model": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
               "version": "0.1.1", "device": "mps", "dtype": "bfloat16", "sr": 24000,
               "temperature": 0.9, "top_k": 50, "seed": "sha256('sipario:'+text)[:4]",
               "loudness": "-20 LUFS, TP -2", "transcriber": "faster-whisper 1.2.1 medium.en",
               "watermark": "perth", "limit": 800, "pause": 0.25 },
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
   float, any rate and any number of channels; sipario converts it. Write
   it to the file named, not through a pipe into it: a WAV written to a
   pipe never has its size filled in, and is refused, since a clip cut
   short looks the same.
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

## Qwen3-TTS, set up as an engine

The recommended engine. Paul listened to five candidates side by side on
2026-10-04, each reading the same lines in his cloned voice, and Qwen3-TTS
sounded most like him, his British accent kept. Measured on 2026-10-04 on
an Apple M4 Max (128 GB) with qwen-tts 0.1.1, the
`Qwen/Qwen3-TTS-12Hz-1.7B-Base` model and Python 3.12. It needs
[uv](https://docs.astral.sh/uv/) (`brew install uv`), or plain `python3 -m
venv` and `pip` in the same steps, and ffmpeg on `PATH`, which sipario
needs anyway.

```bash
uv venv --python 3.12 ~/.local/share/sipario-tts-qwen
VIRTUAL_ENV=~/.local/share/sipario-tts-qwen uv pip install qwen-tts==0.1.1 \
  torch==2.14.1 torchaudio==2.11.0 transformers==4.57.3 \
  faster-whisper==1.2.1 av==18.1.0 resemble-perth==1.0.1 'setuptools<81'
```

**Why these pins.** They are the versions measured, and two of them are
needed whatever else changes. `av==18.1.0`, because av 19 dropped an
argument that faster-whisper 1.2.1 passes to it, and the transcriber
stops at the first sample with `TypeError: open() got an unexpected
keyword argument 'metadata_errors'`. `setuptools<81`, because Perth
imports `pkg_resources`, as under Chatterbox below. The venv is about 1.2 GB. Its log says SoX and
flash-attn are not installed; qwen-tts runs without either, and the
measurements here had neither.

Save the adapter below as `~/.local/share/sipario-tts-qwen/sipario-tts`,
change its first line to that venv's Python if your home is not
`/Users/you`, and make it executable:

```bash
chmod +x ~/.local/share/sipario-tts-qwen/sipario-tts
export SIPARIO_TTS=~/.local/share/sipario-tts-qwen/sipario-tts    # in your shell's profile
```

```python
#!/Users/you/.local/share/sipario-tts-qwen/bin/python
"""sipario-tts: Qwen3-TTS (Alibaba Qwen, Apache-2.0) speaking sipario's
voice protocol (docs/VOICE.md in sipario).

stdin:  one request a line, {"id", "text", "sample", "out"}
stdout: {"ready": true, ...} once the models are loaded, then one reply a
        request, {"id", "ok": true, "out"} or {"id", "ok": false, "error"}
stderr: everything else. Exits when stdin closes.

QWEN_TTS_DEVICE=cpu (or mps, or cuda) overrides the device it picks.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Stdout is the protocol and nothing else. The libraries below print to it,
# from Python and from C, so before any of them loads, file descriptor 1 is
# pointed at stderr and the protocol keeps a copy of the real stdout.
proto = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)
sys.stdout = sys.stderr

from importlib.metadata import version

import numpy as np
import soundfile as sf
import torch
import perth
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps
from qwen_tts import Qwen3TTSModel


def say(obj):
    proto.write(json.dumps(obj) + "\n")
    proto.flush()


MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
TRANSCRIBER = "medium.en"
TEMPERATURE = 0.9
TOP_K = 50
LOUDNESS = "loudnorm=I=-20:TP=-2"
# A script goes in pieces of at most LIMIT characters, broken at sentence
# ends and paragraphs, a sentence too long for one piece broken between
# words, joined by PAUSE seconds of silence. One generate() call stops at
# 8192 codec frames (655 s at 12.5 a second), and a 1581-character
# paragraph came out whole in one call (81 s, every word heard back), so
# the limit is half that for margin, not a cap; a piece whose length is
# far off its word count is made again (see speak()).
LIMIT = 800
PAUSE = 0.25
TRIES = 3

ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    sys.exit("sipario-tts: ffmpeg is not on PATH, and the sample is loudness-normalised with it")

device = os.environ.get("QWEN_TTS_DEVICE") or (
    "cuda" if torch.cuda.is_available()
    else "mps" if torch.backends.mps.is_available()
    else "cpu")
dtype = torch.float32 if device == "cpu" else torch.bfloat16
model = Qwen3TTSModel.from_pretrained(MODEL, device_map=device, dtype=dtype,
                                      attn_implementation="sdpa")
whisper = WhisperModel(TRANSCRIBER, device="cpu", compute_type="int8")
marker = perth.PerthImplicitWatermarker()
sr = int(model.model.speech_tokenizer.get_output_sample_rate())
work = tempfile.mkdtemp(prefix="sipario-tts-qwen-")

# sipario caches each clip under this whole line, so everything that
# changes the voice is in it: the model and its release, the device and
# precision, the sampling settings, how the seed is chosen, how the sample
# is levelled and transcribed, and the two settings above. The sampling
# settings not named here are the checkpoint's own (generation_config.json).
say({"ready": True, "engine": "qwen3-tts", "model": MODEL,
     "version": version("qwen-tts"), "device": device,
     "dtype": str(dtype).replace("torch.", ""), "sr": sr,
     "temperature": TEMPERATURE, "top_k": TOP_K,
     "seed": "sha256('sipario:'+text)[:4]", "loudness": "-20 LUFS, TP -2",
     "transcriber": f"faster-whisper {version('faster-whisper')} {TRANSCRIBER}",
     "watermark": "perth", "limit": LIMIT, "pause": PAUSE})


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


def prepare(sample):
    """The voice to clone: the sample levelled to -20 LUFS (sipario cuts it
    at the room's own level, often 20 dB quieter) and transcribed, since
    Qwen3-TTS clones best from the audio and the words said in it. A sample
    that is mostly quiet, or in which nothing is heard, is refused rather
    than cloned from a transcript of nothing."""
    level = os.path.join(work, "sample.wav")
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", sample, "-af", LOUDNESS,
                    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", level], check=True)
    # Speech is found by faster-whisper's own voice detector (Silero), which
    # goes by the shape of a voice and not its level: a sample cut at the
    # room's level is quiet throughout, speech and pauses alike.
    audio = decode_audio(level, sampling_rate=16000)
    spoken = sum(t["end"] - t["start"] for t in get_speech_timestamps(audio, VadOptions()))
    if spoken < 0.5 * len(audio):
        raise ValueError(f"the sample {sample} is mostly silence: speech was heard in "
                         f"{spoken / 16000:.1f}s of its {len(audio) / 16000:.1f}s")
    segments, _ = whisper.transcribe(level, language="en", beam_size=5)
    words = " ".join(s.text.strip() for s in segments).strip()
    if len(words.split()) < 3:
        raise ValueError(f"no words were heard in the sample {sample} ({words!r}), "
                         "and Qwen3-TTS clones from the words as well as the voice")
    print(f"[sipario-tts] the sample says: {words}", flush=True)
    prompt = model.create_voice_clone_prompt(ref_audio=level, ref_text=words)
    return prompt, words


def speak(piece, prompt, seed):
    """One piece, made again with the next seed if its length is far off
    what its words need: under 0.12 s a word is words dropped, over a
    second a word (plus two) is a model that did not stop."""
    words = len(piece.split())
    for t in range(TRIES):
        torch.manual_seed(seed + t)
        np.random.seed((seed + t) % 2**32)
        wavs, rate = model.generate_voice_clone(
            text=piece, language="English", voice_clone_prompt=prompt,
            temperature=TEMPERATURE, top_k=TOP_K)
        wav = np.asarray(wavs[0], dtype=np.float32)
        secs = len(wav) / rate
        if 0.12 * words <= secs <= words + 2:
            return wav
        print(f"[sipario-tts] {secs:.1f}s for {words} words, made again", flush=True)
    raise ValueError(f"{TRIES} tries at {piece[:60]!r} each came out {secs:.1f}s for {words} words")


voice = None          # (key, prompt, transcript) for the sample in use
try:
    for line in sys.stdin:
        if not line.strip():
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            # Levelling and transcribing take seconds; a run sends the same
            # sample for every step, so it is done once.
            key = (req["sample"], os.stat(req["sample"]).st_mtime_ns)
            if voice is None or voice[0] != key:
                voice = (key, *prepare(req["sample"]))
            seed = int.from_bytes(hashlib.sha256(("sipario:" + req["text"]).encode()).digest()[:4], "big")
            gap = np.zeros(int(sr * PAUSE), dtype=np.float32)
            clips = []
            for piece in pieces(req["text"]):
                clips += [speak(piece, voice[1], seed), gap]
            wav = np.concatenate(clips[:-1]) if clips else np.zeros(0, dtype=np.float32)
            # Qwen3-TTS marks nothing it makes, so the adapter does, with
            # Resemble AI's Perth, and reads the mark back off the 16-bit
            # samples that are written before writing them.
            wav = marker.apply_watermark(wav, sample_rate=sr)
            pcm = (np.clip(wav, -1, 1) * 32767).round().astype(np.int16)
            mark = float(np.mean(marker.get_watermark(pcm.astype(np.float32) / 32767, sample_rate=sr)))
            if mark < 0.9:
                raise ValueError(f"the watermark read back at {mark:.2f}, not 1")
            sf.write(req["out"], pcm, sr, subtype="PCM_16", format="WAV")
            say({"id": rid, "ok": True, "out": req["out"], "seconds": len(pcm) / sr,
                 "watermark": round(mark, 3)})
        except Exception as e:
            say({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})
        finally:
            if device == "mps":
                torch.mps.empty_cache()
finally:
    shutil.rmtree(work, ignore_errors=True)
```

**Why it transcribes the sample.** Qwen3-TTS clones a voice either from
its sound alone or from a recording together with the words said in it,
and the second comes out much closer: from the same thirty seconds of
Paul, 0.80 against 0.70 in the similarity measure under Chatterbox below.
sipario sends a sample and no transcript, so the adapter makes one, with
faster-whisper's `medium.en` on the CPU, and writes it to its log. A sample
that is mostly silence, by faster-whisper's own voice detector, or in which
fewer than three words are heard is refused with that error, rather than
cloned from a transcript of nothing.

**Why it levels the sample.** sipario cuts the sample at the room's own
level, and a laptop's microphone across a room recorded Paul's speech at
around -48 dB. Levelled to -20 LUFS first, the same ten seconds cloned
closer: 0.84 and 0.85 against 0.82 and 0.81, over two seeds.

**The same script makes the same clip.** Each request is seeded from its
text, with the first four bytes of the SHA-256 of `sipario:` and the text,
so a step voiced again comes out the same: two runs in separate processes
wrote identical files on Apple's GPU (2026-10-04). Whether another machine
makes the same bits is not measured. The sampling settings the ready line
does not name (a repetition penalty of 1.05, and 0.9 and 50 for the second
stage) are the checkpoint's own `generation_config.json`.

**Long scripts.** A script is spoken in pieces of up to 800 characters,
broken at sentence ends, with a quarter of a second between them. That is
margin, not the model's limit: one call stops at 8192 frames, about eleven
minutes, and a 1581-character paragraph came out whole in a single call,
81 s with every word heard back by the transcriber. A piece whose length
is far off its word count (under 0.12 s a word, or over a second a word
and two more) is made again with the next seed, up to three times, and
then refused, so neither a dropped sentence nor a model that does not stop
becomes a clip. Neither happened in the measurements here.

**The first run** downloads the model and the transcriber from Hugging
Face into its cache (`~/.cache/huggingface`, or `$HF_HOME`): about 5.7 GB
on disk, 4.2 GB of it the model. It took 104 s from start to ready on a
fast connection. sipario waits up to ten minutes for it to say it is
ready; on a slow line, run the adapter once by hand first
(`$SIPARIO_TTS < /dev/null`) and let the download finish.

**Speed**, measured 2026-10-04 on the M4 Max with the models cached: about
7 s from start to ready, then about 0.9 seconds of work for each second of
speech. A deck's seven scripted steps, 121 s of speech, took 106 s to
voice, and the whole `sipario voice` run 115 s. The first step carries the
sample's levelling and transcription and the GPU's warm-up (24.9 s for
24.2 s of speech); every later step ran at 0.82 to 0.86. On the CPU
(`QWEN_TTS_DEVICE=cpu`, which also runs in float32) one 13.5 s step took
24.8 s, its sample's preparation included. Smaller Macs are not measured.

## Chatterbox, the alternative

Lighter than Qwen3-TTS: a single install, a 3.2 GB model and no
transcriber. Its output can lean American on a British speaker: that is
Paul's listening, 2026-10-04, comparing the two in his own cloned voice.
A measure from the same day points the same way. It scores a clip by the
cosine between speaker embeddings (SpeechBrain's ECAPA model trained on
VoxCeleb) of the clip and of three recordings of Paul giving the talk,
where each of his own recordings scores 0.87 to 0.94 against the other
two. It hears who is speaking, not the accent. Over three clips each,
Chatterbox as set up below scored 0.77, cloned from the ten seconds
sipario cut from a live take, and Qwen3-TTS as set up above 0.85, cloned
from another ten seconds of the same take. Cloned from one and the same
sample, sipario's cut, three steps scored 0.79 under Chatterbox and 0.83
under Qwen3-TTS.

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
with a cloned voice's in the cache). The sample is passed with every
request; an engine that does not clone may ignore it.

When the engine is a script that starts another program (a venv's Python,
a client for a hosted service), start that program with `exec`, so the
process sipario runs is the engine and not a shell waiting on it. sipario
stops a run by killing the engine's whole process group, which reaches a
program left as the script's child; one an engine moves into a group of
its own is the engine's to stop.
