'use strict';

/* Directing the voice from the script: a small subset of SSML, the tags a
 * speaker writes in a ```notes block to tell `sipario voice` where to
 * pause, how to read a number, what an abbreviation stands for, and when
 * to slow down, speak up or change language. The tag set is Vonage's
 * (developer.vonage.com, Customizing TTS), cut to what sipario can do
 * itself with any engine:
 *
 *   speak                         wraps the script, or nothing; does nothing
 *   break time="1s"|"500ms"       a silence of exactly that long, up to 10 s
 *   break strength="..."          none 0, x-weak 0.1, weak 0.25, medium 0.4,
 *                                 strong 0.75, x-strong 1.2 seconds
 *   p                             a paragraph: 0.6 s of silence either side
 *   s                             a sentence: ended with a full stop if it
 *                                 has no ending of its own
 *   sub alias="..."               says the alias; the notes show the text
 *   say-as interpret-as="..."     character, cardinal, ordinal, digits,
 *                                 telephone, date (with format), time,
 *                                 expletive; read into words here, in English
 *   prosody volume|rate|pitch     applied to the voice by ffmpeg afterwards
 *   lang xml:lang="it-IT"         sent to the engine as `language`
 *
 * Nothing else is read, and nothing is passed over: emphasis and phoneme,
 * say-as fraction, unit and address, any other tag, any attribute or value
 * not listed, a tag left open, closed out of order or holding no text, and
 * nesting that means nothing (a paragraph inside a sentence) are refused by
 * name, so a direction the voice would ignore never sits in a script
 * looking obeyed.
 *
 * Notes with no tag in them are returned exactly as they came, by both
 * readings below, but for three entities: `&lt;`, `&gt;` and `&amp;` are
 * `<`, `>` and `&`, the way to write a `<Enter>` or a `Vector<T>` that
 * would otherwise be read as a tag. A `<` that opens no whole tag is text
 * ("x < 5", "<https://example.com>", "a<b"), unless what follows it is
 * the name of a tag sipario reads, when it is a tag written wrongly. A `&`
 * before anything else is text.
 *
 * Two readings of one script:
 *
 *   plain(text)    what the notes show, on stage and in every export: the
 *                  tags taken out, a sub or a say-as showing its own text,
 *                  never the alias or the words it is read as.
 *   speech(text)   what the voice says: `{ text, language?, volume?,
 *                  rate?, pitch? }` to send to the engine, `{ pause }` of
 *                  exact silence and `{ tone }` for a bleep, in order.
 *                  Text next to text with the same voice is one item, so a
 *                  sub or a say-as mid-sentence keeps the sentence whole.
 */

class SsmlError extends Error {}

/* Seconds of silence. A break with neither attribute is medium, as in
   SSML. Paragraph silence sits either side of a <p>, and meets a break
   beside it as the longer of the two rather than adding; two breaks side
   by side add, since each was asked for. */
const STRENGTH = { none: 0, 'x-weak': 0.1, weak: 0.25, medium: 0.4, strong: 0.75, 'x-strong': 1.2 };
const PARAGRAPH = 0.6;
const LONGEST_BREAK = 10;

/* Prosody, as ffmpeg applies it: rate a tempo factor (atempo), volume a
   gain in dB (silent is no sound at all, for as long as the words take),
   pitch in semitones. Percentages and dB outside these ranges are
   refused: past them the voice is no longer a voice. */
const RATE = { 'x-slow': 0.75, slow: 0.9, medium: 1, fast: 1.1, 'x-fast': 1.25 };
const VOLUME = { default: 0, silent: -Infinity, 'x-soft': -10, soft: -5, medium: 0, loud: 4, 'x-loud': 8 };
const PITCH = { default: 0, 'x-low': -4, low: -2, medium: 0, high: 2, 'x-high': 4 };
const RANGE = { rate: [50, 200], volume: [-40, 12], pitch: [-50, 100] };

/* How long a bleep lasts: about as long as the word would have taken. */
const BLEEP = { least: 0.3, char: 0.075 };

/* Between spelled characters. Measured on Qwen3-TTS, 2026-10-04, read
   back by faster-whisper: letters with nothing between them run into a
   word (CAT, NASA and GIF heard as words, about 0.1 s a letter); with a
   space, GIF was still heard as a word; with a hyphen or a comma every
   one was spelled, the comma the most apart (0.25 to 0.58 s a letter).
   Glued dots read W.3.C. as "W2HTHD". */
const SPELL = ', ';

const TAG = /<[A-Za-z/!?]/;
const READ = /<[A-Za-z/!?]|&(?:lt|gt|amp);/;
const ENTITY = { lt: '<', gt: '>', amp: '&' };
const decode = (s) => s.replace(/&(lt|gt|amp);/g, (_, e) => ENTITY[e]);
const SAYS = ['character', 'cardinal', 'ordinal', 'digits', 'telephone', 'date', 'time', 'expletive'];
const FORMATS = ['mdy', 'dmy', 'ymd', 'md', 'dm', 'ym', 'my', 'd', 'm', 'y', 'yyyymmdd'];
const NAMES = 'speak, break, p, s, sub, say-as, prosody and lang';
const list = (xs) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/* What each tag takes. `text`: it holds text and nothing else. */
const ELEMENTS = {
  speak: { attrs: [] },
  break: { attrs: ['time', 'strength'], empty: true },
  p: { attrs: [] },
  s: { attrs: [] },
  sub: { attrs: ['alias'], need: 'alias', text: true },
  'say-as': { attrs: ['interpret-as', 'format'], need: 'interpret-as', text: true },
  prosody: { attrs: ['volume', 'rate', 'pitch'] },
  lang: { attrs: ['xml:lang'], need: 'xml:lang' },
};

/* Tags Vonage reads and sipario does not, and what to write instead. */
const REFUSED = {
  emphasis: '<emphasis> is not read: no voice engine sipario drives can stress a word. ' +
    'Rewrite the line so the word carries itself, or set it apart with <break/> or <prosody rate="slow">',
  phoneme: '<phoneme> is not read: spell the word as it sounds instead, <sub alias="tom-AH-toe">tomato</sub>',
};
const REFUSED_SAYS = {
  fraction: 'write the fraction as it is said, "three quarters"',
  unit: 'write the unit as it is said, "five kilograms"',
  address: 'write the address as it is said',
};

const fail = (msg) => { throw new SsmlError(msg); };
const shown = (s) => JSON.stringify(s.length > 48 ? `${s.slice(0, 45)}...` : s);

// ------------------------------------------------------------ attributes

function breakSeconds(a) {
  if (a.time !== undefined) {
    const m = /^(\d+(?:\.\d+)?)(s|ms)$/.exec(a.time);
    if (!m) fail(`<break time="${a.time}">: a time is seconds or milliseconds, "1s", "1.5s" or "500ms"`);
    const secs = Number(m[1]) / (m[2] === 'ms' ? 1000 : 1);
    if (secs > LONGEST_BREAK) fail(`<break time="${a.time}"> is longer than ${LONGEST_BREAK}s, the longest break read`);
    return secs;
  }
  if (a.strength !== undefined) {
    if (!(a.strength in STRENGTH)) {
      fail(`<break strength="${a.strength}">: a strength is ${list(Object.keys(STRENGTH))}`);
    }
    return STRENGTH[a.strength];
  }
  return STRENGTH.medium;
}

/* Signed values are changes to the voice around them, as in SSML: a +3dB
   inside x-soft is -7 dB, a +10% inside a low pitch a little less low. A
   named value, or a rate, is the voice's own and replaces it. */
function prosody(a, outer) {
  const out = {};
  if (a.rate === undefined && a.volume === undefined && a.pitch === undefined) {
    fail('<prosody> changes nothing: give it a rate, a volume or a pitch');
  }
  if (a.rate !== undefined) {
    const [lo, hi] = RANGE.rate;
    if (a.rate in RATE) out.rate = RATE[a.rate];
    else {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(a.rate);
      if (!m || Number(m[1]) < lo || Number(m[1]) > hi) {
        fail(`<prosody rate="${a.rate}">: a rate is ${list(Object.keys(RATE))}, or a percentage of the voice's own from ${lo}% to ${hi}%`);
      }
      out.rate = Number(m[1]) / 100;
    }
  }
  if (a.volume !== undefined) {
    const [lo, hi] = RANGE.volume;
    if (a.volume in VOLUME) out.volume = VOLUME[a.volume];
    else {
      const m = /^([+-]\d+(?:\.\d+)?)dB$/.exec(a.volume);
      if (!m || Number(m[1]) < lo || Number(m[1]) > hi) {
        fail(`<prosody volume="${a.volume}">: a volume is ${list(Object.keys(VOLUME))}, or a change in decibels from ${lo}dB to +${hi}dB, written with its sign, "+3dB" or "-6dB"`);
      }
      out.volume = (outer.volume || 0) + Number(m[1]);
      if (out.volume !== -Infinity && (out.volume < lo || out.volume > hi)) {
        fail(`<prosody volume="${a.volume}"> inside a volume of ${outer.volume > 0 ? '+' : ''}${outer.volume}dB comes to ${out.volume > 0 ? '+' : ''}${out.volume}dB, past the ${lo}dB to +${hi}dB a voice is taken to`);
      }
    }
  }
  if (a.pitch !== undefined) {
    const [lo, hi] = RANGE.pitch;
    if (a.pitch in PITCH) out.pitch = PITCH[a.pitch];
    else {
      const m = /^([+-]\d+(?:\.\d+)?)%$/.exec(a.pitch);
      if (!m || Number(m[1]) < lo || Number(m[1]) > hi) {
        fail(`<prosody pitch="${a.pitch}">: a pitch is ${list(Object.keys(PITCH))}, or a change from ${lo}% to +${hi}%, written with its sign, "+10%" or "-5%"`);
      }
      out.pitch = (outer.pitch || 0) + 12 * Math.log2(1 + Number(m[1]) / 100);
      const most = 12 * Math.log2(1 + hi / 100);
      const least = 12 * Math.log2(1 + lo / 100);
      if (out.pitch < least - 1e-9 || out.pitch > most + 1e-9) {
        fail(`<prosody pitch="${a.pitch}"> inside a raised or lowered pitch comes past the ${lo}% to +${hi}% a voice is taken to`);
      }
    }
  }
  return out;
}

function language(a) {
  const v = a['xml:lang'];
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(v)) {
    fail(`<lang xml:lang="${v}">: a language is a language tag, "it-IT", "fr" or "en-GB"`);
  }
  return v;
}

function sayAsAttrs(a) {
  const as = a['interpret-as'];
  if (REFUSED_SAYS[as]) fail(`<say-as interpret-as="${as}"> is not read: ${REFUSED_SAYS[as]}`);
  if (!SAYS.includes(as)) fail(`<say-as interpret-as="${as}">: sipario reads ${list(SAYS)}`);
  if (as === 'date') {
    if (a.format === undefined) fail(`<say-as interpret-as="date"> needs a format, which says the order of its parts: ${list(FORMATS)}`);
    if (!FORMATS.includes(a.format)) fail(`<say-as interpret-as="date" format="${a.format}">: a format is ${list(FORMATS)}`);
  } else if (a.format !== undefined) {
    fail(`<say-as interpret-as="${as}" format="${a.format}">: format is for a date, and only a date`);
  }
  return { as, format: a.format };
}

// --------------------------------------------------------------- reading

const OPEN = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[^\s=<>/"']+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const ATTR = /([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(name, raw) {
  const a = {};
  for (const m of raw.matchAll(ATTR)) {
    const k = m[1];
    const v = m[2] !== undefined ? m[2] : m[3];
    if (!ELEMENTS[name].attrs.includes(k)) {
      const takes = ELEMENTS[name].attrs;
      fail(`<${name}> has no attribute ${k}: ` + (takes.length ? `it takes ${takes.length > 1 ? list(takes) : takes[0]}` : 'it takes none'));
    }
    if (k in a) fail(`<${name}> has ${k} twice`);
    a[k] = decode(v);
  }
  const need = ELEMENTS[name].need;
  if (need && a[need] === undefined) {
    const what = { alias: 'what to say in place of its text', 'interpret-as': `how to read its text: ${list(SAYS)}`,
                   'xml:lang': 'the language, "it-IT"' }[need];
    fail(`<${name}> needs ${need}="...": ${what}`);
  }
  if (name === 'sub' && !/[\p{L}\p{N}]/u.test(a.alias)) {
    fail(`<sub alias="${a.alias}"> gives the voice nothing to say: the alias is the words said in place of the text`);
  }
  return a;
}

/* A tag on a line of its own leaves that line empty once it is taken out,
   and an empty line is where a paragraph or a list ends: the line goes
   with it, so "1. a\n<break/>\n2. b" is still one list. `cuts` are the
   places in `display` a tag was taken from. */
function unline(display, cuts) {
  if (!cuts.length) return display;
  const kept = [];
  let at = 0;
  for (const line of display.split('\n')) {
    const end = at + line.length;
    if (line.trim() || !cuts.some((c) => c >= at && c <= end)) kept.push(line);
    at = end + 1;
  }
  return kept.join('\n');
}

/** The script read through: `{ display, events, tags }`. Throws an
 *  SsmlError saying what is wrong with the first tag that is. */
function read(text) {
  const events = [];
  const stack = [];                    // { name, ctx, attrs, held }
  const cuts = [];
  let display = '';
  let content = '';                    // the text of the sub or say-as open
  let removed = false;                 // a tag was taken out just before
  let gap = false;                     // and it stood between words
  const ctx = () => (stack.length ? stack[stack.length - 1].ctx : {});
  const inside = () => stack.find((e) => ELEMENTS[e.name].text);

  const addText = (raw) => {
    if (!raw) return;
    const t = decode(raw);
    if (t.trim()) for (const e of stack) e.held = true;
    let s = t;
    if (removed) {
      if (/[ \t]$/.test(display) && /^[ \t]/.test(s)) s = s.replace(/^[ \t]+/, '');
      else if (gap && display && /\S$/.test(display) && /^\S/.test(s)) s = ` ${s}`;
    }
    removed = false;
    gap = false;
    display += s;
    if (inside()) content += t;
    else events.push({ type: 'text', text: t, ctx: ctx() });
  };

  let i = 0;
  let from = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (!TAG.test(text.slice(lt, lt + 2))) { i = lt + 1; continue; }
    const snippet = text.slice(lt).split('\n')[0];
    if (text[lt + 1] === '!' || text[lt + 1] === '?') {
      fail(`${shown(snippet)}: comments and declarations are not read in a script; take it out`);
    }
    OPEN.lastIndex = lt;
    const m = OPEN.exec(text);
    if (!m || (m[1] && (m[3].trim() || m[4]))) {
      /* "<https://example.com>", "a<b": text, as it always was, unless it
         opens with a name sipario reads, which makes it a direction
         written wrongly rather than words. */
      const named = /^<\/?([A-Za-z][\w.:-]*)/.exec(snippet);
      if (!named || !(ELEMENTS[named[1]] || REFUSED[named[1]])) { i = lt + 1; continue; }
      fail(`${shown(snippet)} is not a whole tag: a tag is <name attribute="value">, and one that holds nothing ends />`);
    }
    const [whole, close, name, raw, empty] = m;
    addText(text.slice(from, lt));
    if (REFUSED[name]) fail(REFUSED[name]);
    if (!ELEMENTS[name]) fail(`<${name}> is not a tag sipario reads: it reads ${NAMES}. A < meant as text is written &lt;`);
    const el = ELEMENTS[name];
    const within = inside();

    if (close) {
      if (el.empty) fail(`</${name}>: <${name}> holds nothing and has no closing tag; write <${name} .../>`);
      const top = stack[stack.length - 1];
      if (!top) fail(`</${name}> closes nothing: no <${name}> is open`);
      if (top.name !== name) fail(`</${name}> comes while <${top.name}> is still open: close <${top.name}> first`);
      stack.pop();
      if (!top.held) fail(`<${name}> holds no text`);
      if (name === 'sub' || name === 'say-as') {
        if (name === 'sub') events.push({ type: 'words', text: top.attrs.alias, ctx: ctx() });
        else events.push({ type: 'say', ...sayAs(content, top.say.as, top.say.format), ctx: ctx() });
        content = '';
      } else if (name === 'p') {
        events.push({ type: 'para' });
      } else if (name === 's') {
        events.push({ type: 'send' });
      }
    } else {
      if (within) fail(`<${within.name}> holds text only, and <${name}> is inside it`);
      if (el.empty && !empty) fail(`<${name}> holds nothing: write <${name} .../>`);
      if (!el.empty && empty) fail(`<${name}/> holds nothing: <${name}> wraps text, <${name}>...</${name}>`);
      const a = attributes(name, raw);
      if (name === 'speak' && stack.length) {
        fail(`<speak> wraps the whole script or nothing, and cannot sit inside <${stack[stack.length - 1].name}>`);
      }
      if (name === 'p') {
        const out = stack.find((e) => e.name === 'p' || e.name === 's');
        if (out) fail(out.name === 'p' ? '<p> inside <p>: paragraphs do not nest' : '<p> inside <s>: a sentence cannot hold a paragraph; close the <s> first');
      }
      if (name === 's' && stack.some((e) => e.name === 's')) fail('<s> inside <s>: sentences do not nest');
      if (name === 'break') {
        events.push({ type: 'break', seconds: breakSeconds(a) });
      } else {
        const entry = { name, attrs: a, ctx: ctx() };
        if (name === 'prosody') entry.ctx = { ...entry.ctx, ...prosody(a, entry.ctx) };
        if (name === 'lang') entry.ctx = { ...entry.ctx, language: language(a) };
        if (name === 'say-as') entry.say = sayAsAttrs(a);
        if (name === 'p') events.push({ type: 'para' });
        if (name === 's') events.push({ type: 'sentence' });
        stack.push(entry);
      }
    }
    removed = true;
    cuts.push(display.length);
    if (name === 'break' || name === 'p' || name === 's') gap = true;
    i = lt + whole.length;
    from = i;
  }
  addText(text.slice(from));
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is opened and never closed`);
  return { display: unline(display, cuts), events, tags: cuts.length };
}

/** What the notes show: the script with its tags taken out. */
function plain(text) {
  if (!text || !READ.test(text)) return text;
  return read(text).display;
}

/** Whatever is wrong with a script's tags, as a sentence, or null. */
function problem(text) {
  if (!text || !READ.test(text)) return null;
  try { read(text); return null; } catch (err) {
    if (err instanceof SsmlError) return err.message;
    throw err;
  }
}

const VOICE = ['language', 'volume', 'rate', 'pitch'];
const DEFAULT = { volume: 0, rate: 1, pitch: 0 };
const tidy = (t) => t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

/** What the voice says, in order: `{ text, language?, volume?, rate?,
 *  pitch? }`, `{ pause }` and `{ tone, volume? }`, seconds both. A script
 *  with no tags is one item, its entities read, its text trimmed and
 *  otherwise as written. */
function speech(text) {
  const r = text && READ.test(text) ? read(text) : { display: text || '', tags: 0 };
  if (!r.tags) {
    const t = r.display.trim();
    return t ? [{ text: t }] : [];
  }
  const out = [];
  let cur = null;
  /* Punctuation is not a thing to say on its own: the comma after a
     <lang> goes with the words before it, whatever their voice, rather
     than opening the next request or being one. */
  const flush = () => {
    if (!cur) return;
    let t = tidy(cur.text);
    const last = out[out.length - 1];
    const lead = /^[.,;:!?…]+/.exec(t);
    if (lead && last && last.text) {
      last.text += lead[0];
      t = t.slice(lead[0].length).trim();
    }
    if (t && /[\p{L}\p{N}]/u.test(t)) out.push({ ...cur, text: t });
    cur = null;
  };
  const voiceOf = (c) => {
    const v = {};
    for (const k of VOICE) if (c[k] !== undefined && c[k] !== DEFAULT[k]) v[k] = c[k];
    return v;
  };
  const same = (a, b) => VOICE.every((k) => a[k] === b[k]);
  const say = (t, c) => {
    const v = voiceOf(c);
    if (cur && !same(cur, v)) flush();
    if (!cur) cur = { text: '', ...v };
    cur.text += t;
  };
  /* No pause at all is no pause: the words either side stay one request,
     as the notes show them, a space apart. */
  const pause = (seconds, hard) => {
    if (!seconds) { if (cur) cur.text += ' '; return; }
    flush();
    const last = out[out.length - 1];
    const p = last && last.wait ? last : (out.push({ wait: true, hard: 0, soft: 0 }), out[out.length - 1]);
    if (hard) p.hard += seconds;
    else p.soft = Math.max(p.soft, seconds);
  };
  for (const e of r.events) {
    if (e.type === 'text' || e.type === 'words') say(e.text, e.ctx);
    else if (e.type === 'say') {
      /* A bleep takes the volume around it, silent included, and is
         stretched with the words around it. */
      if (e.tone) {
        flush();
        const { volume, rate } = voiceOf(e.ctx);
        out.push({ tone: Math.round(e.tone / (rate || 1) * 1000) / 1000, ...(volume !== undefined ? { volume } : {}) });
      } else say(e.words, e.ctx);
    } else if (e.type === 'break') pause(e.seconds, true);
    else if (e.type === 'para') pause(PARAGRAPH, false);
    else if (e.type === 'sentence' && cur) cur.text += ' ';
    else if (e.type === 'send' && cur) {
      const t = cur.text.replace(/\s+$/, '');
      if (t && !/[.!?…;:,]["'”’)\]]*$/.test(t)) cur.text = `${t}.`;
      cur.text += ' ';
    }
  }
  flush();
  /* A paragraph's silence at the very start or end of a step is nobody's:
     the step before ends, and the next begins, without it. A break there
     was asked for, and stays. */
  const items = out.map((x, n) => {
    if (!x.wait) return x;
    const edge = n === 0 || n === out.length - 1;
    const secs = edge ? x.hard : Math.max(x.hard, x.soft);
    return secs > 0 ? { pause: Math.round(secs * 1000) / 1000 } : null;
  }).filter(Boolean);
  return items;
}

// ------------------------------------------------- reading text as words

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

const under100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
const under1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : '', h && r ? 'and' : '', r ? under100(r) : ''].filter(Boolean).join(' ');
};

/** A whole number in words, the British way: "one hundred and five",
 *  "two thousand and twenty-six". Up to 999 trillion. */
function cardinal(digits) {
  const s = String(digits).replace(/^0+(?=\d)/, '');
  if (s === '0') return 'zero';
  if (s.length > 15) fail(`${s} is too large to read: up to 999 trillion is read`);
  const groups = [];
  for (let i = s.length; i > 0; i -= 3) groups.unshift(Number(s.slice(Math.max(0, i - 3), i)));
  const parts = [];
  groups.forEach((g, i) => {
    if (!g) return;
    const scale = SCALES[groups.length - 1 - i];
    parts.push(under1000(g) + (scale ? ` ${scale}` : ''));
  });
  const last = groups[groups.length - 1];
  if (groups.length > 1 && last > 0 && last < 100 && parts.length > 1) parts.splice(parts.length - 1, 0, 'and');
  return parts.join(' ');
}

const IRREGULAR = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const ordinal = (digits) => cardinal(digits).replace(/[a-z]+$/, (w) => IRREGULAR[w] || (w.endsWith('y') ? `${w.slice(0, -1)}ieth` : `${w}th`));
const digitWords = (s, zero = 'zero') => [...s].map((d) => (d === '0' ? zero : ONES[Number(d)])).join(' ');

/* A year as it is said: twenty twenty-six, nineteen oh five, nineteen
   hundred, two thousand and five. */
function year(y) {
  const n = Number(y);
  if (y.length < 4) return cardinal(y);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (n % 1000 < 10) return cardinal(y);
  if (!lo) return `${under100(hi)} hundred`;
  return `${under100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : under100(lo)}`;
}

const days = (m, y) => (m === 2 ? (y === undefined || ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28)
  : [4, 6, 9, 11].includes(m) ? 30 : 31);

function date(content, format) {
  const tag = `<say-as interpret-as="date" format="${format}">`;
  let parts;
  if (format === 'yyyymmdd') {
    if (!/^\d{8}$/.test(content)) fail(`${tag} reads eight digits, "20261003", and ${shown(content)} is not`);
    parts = { y: content.slice(0, 4), m: content.slice(4, 6), d: content.slice(6) };
  } else {
    const bits = content.split(/[\s./-]+/);
    if (bits.length !== format.length || bits.some((b) => !/^\d+$/.test(b))) {
      fail(`${tag} reads ${format.length} number${format.length > 1 ? 's' : ''} in the order ${format}, ` +
        `"${format.split('').map((c) => ({ d: '3', m: '10', y: '2026' }[c])).join('/')}", and ${shown(content)} is not that`);
    }
    parts = {};
    [...format].forEach((c, n) => { parts[c] = bits[n]; });
  }
  const y = parts.y !== undefined ? Number(parts.y) : undefined;
  if (parts.y !== undefined && parts.y.length > 4) fail(`${tag}: ${parts.y} is not a year`);
  const m = parts.m !== undefined ? Number(parts.m) : undefined;
  if (m !== undefined && (m < 1 || m > 12)) fail(`${tag}: ${parts.m} is not a month`);
  const d = parts.d !== undefined ? Number(parts.d) : undefined;
  if (d !== undefined && (d < 1 || d > (m ? days(m, y) : 31))) fail(`${tag}: ${shown(content)} has no day ${parts.d}`);
  const month = m && MONTHS[m - 1];
  if (d && m) return `the ${ordinal(String(d))} of ${month}${y !== undefined ? `, ${year(parts.y)}` : ''}`;
  if (d) return `the ${ordinal(String(d))}`;
  if (m && y !== undefined) return `${month} ${year(parts.y)}`;
  if (m) return month;
  return year(parts.y);
}

function duration(content) {
  const t = content.replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  let h = 0;
  let m = 0;
  let s = 0;
  let x;
  if ((x = /^(\d+)'(?:(\d+)")?$/.exec(t))) { m = Number(x[1]); s = Number(x[2] || 0); }
  else if ((x = /^(\d+)"$/.exec(t))) s = Number(x[1]);
  else if ((x = /^(\d+):(\d\d):(\d\d)$/.exec(t))) { h = Number(x[1]); m = Number(x[2]); s = Number(x[3]); }
  else if ((x = /^(\d+):(\d\d)$/.exec(t))) { m = Number(x[1]); s = Number(x[2]); }
  else fail(`<say-as interpret-as="time"> reads a length of time, 1'30", 1:30 or 1:02:30, and ${shown(content)} is not one`);
  if (s > 59 || (x.length === 4 && m > 59 && /:/.test(t))) fail(`<say-as interpret-as="time">: ${shown(content)} has more than 59 in a place that counts to 59`);
  const said = [[h, 'hour'], [m, 'minute'], [s, 'second']].filter(([n]) => n)
    .map(([n, unit]) => `${cardinal(String(n))} ${unit}${n === 1 ? '' : 's'}`);
  return said.length ? said.join(' ') : 'zero seconds';
}

/* A phone number in its groups, a comma between them: the engine pauses
   at a comma (on Qwen3-TTS, 0.16 to 0.19 s between groups, 2026-10-04),
   and the number stays one request. Exact silences would make each group
   a request of two or three words of its own, which a model reads worse
   than a sentence. */
function telephone(content) {
  if (!/^\+?[\d\s().-]+$/.test(content) || !/\d/.test(content)) {
    fail(`<say-as interpret-as="telephone"> reads digits, spaces, ( ) - . and a leading +, and ${shown(content)} has more`);
  }
  let groups = content.replace(/^\+/, '').split(/[\s().-]+/).filter(Boolean);
  if (groups.length === 1 && groups[0].length > 4) {
    const g = groups[0];
    groups = [];
    for (let i = 0; i < g.length; i += 3) groups.push(g.slice(i, i + 3));
    if (groups[groups.length - 1].length === 1) {
      const one = groups.pop();
      groups[groups.length - 1] += one;
    }
  }
  return (content.startsWith('+') ? 'plus ' : '') + groups.map((g) => digitWords(g, 'oh')).join(', ');
}

function characters(content) {
  const chars = [...content.replace(/[\s._-]/g, '')];
  const bad = chars.find((c) => !/[A-Za-z0-9]/.test(c));
  if (bad || !chars.length) {
    fail(`<say-as interpret-as="character"> spells letters and digits, and ${shown(content)} has ${bad ? JSON.stringify(bad) : 'none'}`);
  }
  return chars.map((c) => (/\d/.test(c) ? ONES[Number(c)] : c.toUpperCase())).join(SPELL);
}

/** A say-as's text read as words: `{ words }`, or `{ tone }` seconds for
 *  an expletive. The text is the tag's own, trimmed. */
function sayAs(raw, as, format) {
  const content = raw.trim();
  const tag = `<say-as interpret-as="${as}">`;
  if (as === 'cardinal') {
    const m = /^([-+−]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(content);
    if (!m) fail(`${tag} reads a number, "42", "-3", "1,500" or "3.14", and ${shown(content)} is not one`);
    return { words: (m[1] && m[1] !== '+' ? 'minus ' : '') + cardinal(m[2].replace(/,/g, '')) + (m[3] ? ` point ${digitWords(m[3])}` : '') };
  }
  if (as === 'ordinal') {
    const m = /^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)?$/i.exec(content);
    if (!m) fail(`${tag} reads a whole number, "3" or "3rd", and ${shown(content)} is not one`);
    return { words: ordinal(m[1].replace(/,/g, '')) };
  }
  if (as === 'digits') {
    if (!/^[\d\s]+$/.test(content)) fail(`${tag} reads digits, and ${shown(content)} has more than digits`);
    return { words: digitWords(content.replace(/\s/g, '')) };
  }
  if (as === 'character') return { words: characters(content) };
  if (as === 'telephone') return { words: telephone(content) };
  if (as === 'date') return { words: date(content, format) };
  if (as === 'time') return { words: duration(content) };
  /* expletive */
  return { tone: Math.round(Math.max(BLEEP.least, BLEEP.char * content.length) * 1000) / 1000 };
}

/** How much of a line is the tags it opens with, and the space after
 *  them: where a list marker sits on a line that opens a <prosody>. */
const LEADING = new RegExp(`^(?:\\s*${OPEN.source})*\\s*`);
const lead = (line) => LEADING.exec(line)[0].length;

module.exports = { plain, speech, problem, lead, sayAs, cardinal, ordinal, year, SsmlError,
                   STRENGTH, PARAGRAPH, RATE, VOLUME, PITCH, RANGE, SPELL };
