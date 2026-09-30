'use strict';

/* The room: what the deck and the audience's phones say to each other,
 * held in one place.
 *
 * One protocol, two places it can run. With `audience: local` this relay
 * runs inside `sipario serve` and the phones reach it over the room's own
 * network. With `audience: https://…` the deck speaks the same messages
 * to a relay somewhere else, which this repository does not contain. The
 * deck cannot tell the two apart, which is the point of there being one.
 *
 * Four routes, named relative to where the relay lives:
 *
 *   GET  <base>/stream   relay -> deck, an event stream of tallies
 *   POST <base>/deck     deck -> relay, one message per request
 *   GET  /stream         relay -> phone, an event stream of the stage
 *   POST /phone          phone -> relay, one message per request
 *
 * Deck -> relay:   hello {deck, name, polls}   slide {window, id, step, holds, at, movement}
 *                  claim {window, and a slide's fields}
 *                  poll-open {id, question, options}   poll-close {id}
 *                  feedback-open {questions}
 * Phone -> relay:  react {token, kind}   pace {token, value}
 *                  vote {token, poll, option}   feedback {token, answers}
 * Relay -> deck:   tally {session, join, phones, reactions, pace, polls,
 *                  feedback}, throttled: counts and shares, never one
 *                  person's input, and never the text of an answer
 * Relay -> phone:  stage {session, deck, live, slide, mode, reactions, poll,
 *                  feedback}: what a phone shows now. `slide` is where the
 *                  talk is, `{id, step}`, and `live` whether a deck is there
 *                  to say so. A poll on the stage comes
 *                  first; after that, once opened, the feedback form
 *                  stays until the talk ends; otherwise reactions and pace.
 *
 * Every POST is `Content-Type: application/json` (see `post` below). A
 * relay on another origin, `audience: https://…`, is therefore sent a CORS
 * preflight by the deck, and has to answer it and allow the deck's origin
 * on its event stream; this one shares the deck's origin and never is.
 *
 * Server-Sent Events one way and a POST the other, rather than a
 * WebSocket. The deck already reloads over an event stream, EventSource
 * reconnects by itself when a phone's network drops, and a WebSocket
 * server written against Node's `http` alone is a framing parser this
 * library would then have to own. Nothing here needs a message from a
 * phone to arrive faster than a request can carry it.
 *
 * The relay is state and nothing else. It never learns who anybody is:
 * a phone is a random token it made for itself, no address is read, and
 * what goes to disk is counts.
 */

/* A session is one delivery of a talk, named by when it began, to the
   second, so a listing of them reads in order. The suffix keeps two
   started in the same second apart. */
function sessionId(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-` +
    `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

const { paceReading } = require('./pace.js');

/* The reactions a phone can send: a fixed set, named, so the protocol
   carries a word and the emoji is how this relay draws it. Counts, never
   a feed: nobody's reaction is shown as theirs. */
const REACTIONS = [
  { kind: 'clap', emoji: '\u{1F44F}' },
  { kind: 'love', emoji: '\u{2764}\u{FE0F}' },
  { kind: 'laugh', emoji: '\u{1F602}' },
  { kind: 'wow', emoji: '\u{1F62E}' },
  { kind: 'think', emoji: '\u{1F914}' },
];

/* How often one phone, and the whole room, may say a thing. A phone is a
   token it made for itself, so a determined one can make more; the room's
   own ceiling is what bounds that. Numbers in a talk, not in a benchmark:
   five reactions in ten seconds is enthusiasm, fifty is a thumb resting
   on the screen. */
const LIMITS = {
  react: { each: 5, room: 100, per: 10 * 1000 },
  pace: { each: 1, per: 2 * 1000 },
  vote: { each: 5, per: 10 * 1000 },
  feedback: { each: 3, per: 10 * 1000 },
};

/* A typed answer is a sentence, not an essay. */
const ANSWER = 500;

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const POLL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;

const reply = (status, body) => ({ status, body });
const ok = (body = {}) => reply(200, { ok: true, ...body });
const refuse = (status, error) => reply(status, { ok: false, error });

/** A relay for one session. `join` is asked for the address phones open,
 *  every time it is wanted, since a laptop's network can change mid-talk.
 *  `throttle` is how long a change waits for others before the deck is
 *  told; 0 tells it at once, which is what the suite wants. `now` is the
 *  clock, and `tick` how often the tally is sent unasked, so the pace
 *  reading falls away as the window passes over it; 0 never. `save` is
 *  handed the session's record once a phone has said something and then
 *  after each change, at most every `every` ms, and once more at close. */
function createRelay({ deck = '', session = sessionId(), join = () => '', throttle = 250,
                       now = Date.now, tick = 5000, save = null, every = 1000, grace = 3000 } = {}) {
  const started = new Date(now()).toISOString();
  const state = { deck, title: deck, slide: null };
  const decks = new Map();         // listeners for the tally -> the deck window each speaks for
  const phones = new Set();        // listeners for the stage
  let pending = null;

  const seen = new Set();          // every token that has said anything
  const totals = Object.fromEntries(REACTIONS.map((r) => [r.kind, 0]));
  const slides = new Map();        // slide id -> what the room said while it was up
  const pace = new Map();          // token -> its latest pace signal
  const recent = new Map();        // what+token -> times, for the limits
  const roomRecent = {};           // what -> times, for the room's ceiling
  const polls = new Map();         // id -> { id, question, options, votes: token -> option }
  let open = null;                 // the id of the poll on the stage, if any
  let form = null;                 // { questions, answers: token -> answers } once opened

  function slideLog() {
    const id = state.slide ? state.slide.id : '';
    if (!slides.has(id)) {
      slides.set(id, { reactions: Object.fromEntries(REACTIONS.map((r) => [r.kind, 0])),
                       pace: { slower: 0, ok: 0, faster: 0 } });
    }
    return slides.get(id);
  }

  function allow(what, token) {
    const L = LIMITS[what];
    const t = now();
    const within = (times) => (times || []).filter((x) => t - x < L.per);
    const mine = within(recent.get(what + token));
    if (mine.length >= L.each) return false;
    if (L.room) {
      const room = roomRecent[what] = within(roomRecent[what]);
      if (room.length >= L.room) return false;
      room.push(t);
    }
    mine.push(t);
    recent.set(what + token, mine);
    return true;
  }

  function tally() {
    return {
      type: 'tally', session, join: join(), phones: phones.size, joined: seen.size,
      reactions: REACTIONS.map((r) => ({ ...r, count: totals[r.kind] })),
      pace: paceReading([...pace.values()], now()),
      poll: open,
      /* The open poll, and whether the stage is on its own slide: while it
         is not, the presenter window says the phones are still showing it. */
      pollOpen: open ? (() => {
        const p = polls.get(open);
        return { id: p.id, question: p.question, total: p.votes.size,
                 here: !p.slide || (!!state.slide && state.slide.id === p.slide) };
      })() : null,
      polls: Object.fromEntries([...polls.values()].map((p) => [p.id, counts(p)])),
      feedback: form ? form.answers.size : null,
    };
  }

  /* A poll's answers as the room may see them: how many chose each
     option, and how many answered. Which phone chose what never leaves. */
  function counts(p) {
    const votes = p.options.map(() => 0);
    for (const i of p.votes.values()) votes[i] += 1;
    return { votes, total: p.votes.size };
  }

  /* What the room has been shown: each slide by its id, and the furthest
     step of it that has been on the stage. A phone is served these and
     nothing else, so it can never show a slide, or a step of one, before
     the room has seen it. A slide the speaker jumped past is not in it:
     earlier in the deck is not the same as seen. */
  const shown = new Map();

  /* The size of each element a step holds for what it has not shown yet,
     measured by the deck on the stage, so a phone's copy can hold the same
     room without holding the words (lib/pages.js, withoutUnreached). */
  const sizes = new Map();
  const HOLD = (h) => h === null || (Array.isArray(h) && (h.length === 2 || (h.length === 3 && h[2] === 'inline')) &&
    [h[0], h[1]].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20000));

  function holds(id, step) { return sizes.get(`${id}/${step}`) || null; }

  /** Every slide shown so far, `[id, furthest step]`. */
  function shownSlides() { return [...shown]; }

  function reached(id, step) {
    return shown.has(id) && Number.isInteger(step) && step >= 0 && step <= shown.get(id);
  }

  /* ---- which deck window drives the room
   *
   * Any number of deck windows may be open: the one on the projector, the
   * one on the laptop, a tab opened to check a slide. The room follows
   * one of them, the holder, and takes position from it alone: where the
   * talk is, what has been reached, which poll is open, the sizes a step
   * holds. Anything another window says about position is ignored.
   *
   * A window is the deck's own id for its tab, kept in sessionStorage, so
   * it survives the window's reload on a save and is not shared with a
   * second tab of the same talk. The notes window is never a deck window
   * and can never hold the room.
   *
   *   Before anyone has held it, the first deck window to make contact
   *   holds it, so a rehearsal in one window needs nothing done.
   *   Going full screen in a deck window, or pressing H in it, claims it:
   *   the latest claim wins. Leaving full screen keeps it, so a speaker
   *   who drops out to show a demo keeps the phones.
   *   The holder's window gone past `grace` (it drops for a moment on
   *   every reload) leaves the room unheld: the phones keep the last
   *   slide and say the deck has gone quiet, until a window claims it.
   *   Nothing is promoted by itself, because a window left open by
   *   accident taking over is the failure this rule is here to prevent.
   *
   * A message that names no window is from a deck that does not say, and
   * moves the room only while nobody has ever held it. */
  const windows = new Map();       // window id -> its connected deck streams
  let holder = null;
  let everHeld = false;
  let live = false;
  let losing = null;

  function hold(id) {
    holder = id;
    everHeld = true;
    presence();
    changed();
  }

  function presence() {
    clearTimeout(losing);
    if (holder !== null && windows.has(holder)) {
      if (!live) { live = true; restage(); }
      return;
    }
    const gone = () => {
      if (holder !== null) { holder = null; changed(); }
      if (live) { live = false; restage(); }
    };
    if (holder === null || !grace) return gone();
    losing = setTimeout(gone, grace);
    if (losing.unref) losing.unref();
  }

  /* Whether a message may move the room. A window that has not been seen
     before takes an unheld room only if nobody ever held it. */
  function mayMove(m) {
    if (m.window === undefined) return !everHeld;
    if (typeof m.window !== 'string' || !m.window) return false;
    /* First contact can come before the window's stream has connected, so
       whether it is there is left to the stream to say, not judged now. */
    if (!everHeld) { holder = m.window; everHeld = true; changed(); }
    return m.window === holder;
  }

  function stage() {
    const p = open && polls.get(open);
    return { type: 'stage', session, deck: state.title, live, slide: state.slide,
             mode: p ? 'poll' : form ? 'feedback' : 'react',
             reactions: REACTIONS,
             poll: p ? { id: p.id, question: p.question, options: p.options } : null,
             feedback: form ? { questions: form.questions } : null };
  }

  /* The session as it goes to disk: counts, and the text of feedback,
     with no token and nothing that says which phone said what. The
     responses are in no particular order, and each is one phone's form. */
  function record() {
    return {
      deck: state.title, session, started, updated: new Date(now()).toISOString(),
      joined: seen.size,
      polls: [...polls.values()].map((p) => {
        const c = counts(p);
        return { id: p.id, question: p.question, total: c.total,
                 options: p.options.map((text, i) => ({ text, votes: c.votes[i] })) };
      }),
      reactions: { ...totals },
      slides: [...slides].map(([id, log]) => ({ id, reactions: { ...log.reactions }, pace: { ...log.pace } })),
      feedback: form ? { questions: form.questions, responses: [...form.answers.values()] } : null,
    };
  }

  /* Nothing is written until a phone has said something, so a rehearsal
     nobody joined leaves no session behind. */
  let saving = null;
  let spoken = false;
  function persist() {
    if (!save) return;
    spoken = true;
    if (!saving) saving = setTimeout(() => { saving = null; save(record()); }, every);
  }

  /* Each listener is told, of the room, whether its own deck window holds
     it: `yours`, `other` or `none`. Worked out per listener, so no window
     is ever told another's id. */
  function forListener(t, who) {
    return { ...t, room: holder === null ? 'none' : who && who === holder ? 'yours' : 'other' };
  }

  function push() {
    clearTimeout(pending);
    pending = null;
    const t = tally();
    for (const [fn, who] of decks) fn(forListener(t, who));
  }

  /* Many phones pressing at once is one tally, not a hundred. */
  function changed() {
    if (!throttle) return push();
    if (!pending) pending = setTimeout(push, throttle);
  }

  function restage() {
    const s = stage();
    for (const fn of phones) fn(s);
  }

  /* A poll as the deck describes it. The same poll described again, after
     a reload or on the way back to it, keeps its answers. Options that
     changed are a different question, and answers to the old ones would
     be counted against the wrong words, so those start again. `slide` and
     `movement` and `at` say where in the deck it is put, when the deck
     says. */
  const isPoll = (p) => p && typeof p.id === 'string' && POLL_ID.test(p.id) && text(p.question, 500) &&
    Array.isArray(p.options) && p.options.length >= 2 && p.options.length <= 12 && p.options.every((o) => text(o, 200));
  function define(p) {
    const had = polls.get(p.id);
    if (!had || had.options.join('\n') !== p.options.join('\n')) {
      polls.set(p.id, { id: p.id, question: p.question, options: p.options.slice(), votes: new Map(), slide: null });
    } else {
      had.question = p.question;
    }
    if (typeof p.slide === 'string') polls.get(p.id).slide = p.slide.slice(0, 200);
  }

  /* Which poll is open, decided here from where the deck is and where
     each poll sits, never by a phone. A poll opens at the step that puts
     it and stays open for the rest of its movement, the later slides
     included, so a room still answering when the speaker moves on can
     finish. It closes when the deck leaves the movement, and also when
     the deck goes back to before it: the question has not been asked at
     that point of the talk. A later poll in the same movement takes over
     from an earlier one. `map` is the deck's list, from its hello. */
  let map = null;
  function decide(at, movement) {
    const now = map
      .filter((p) => p.movement === movement && p.at <= at)
      .sort((a, b) => b.at - a.at)[0];
    const next = now ? now.id : null;
    if (next === open) return;
    open = next;
    restage();
    changed();
  }

  function fromDeck(m) {
    if (!m || typeof m !== 'object') return refuse(400, 'not a message');
    if (m.type === 'hello') {
      /* The deck's `name:`, which is what it calls itself, not the tab's
         longer `title:`. */
      if (typeof m.name === 'string' && m.name) state.title = m.name.slice(0, 200);
      if (m.polls !== undefined) {
        const ok = Array.isArray(m.polls) && m.polls.length <= 200 && m.polls.every((p) => isPoll(p) &&
          typeof p.slide === 'string' && Number.isInteger(p.movement) && Number.isInteger(p.at));
        if (!ok) return refuse(400, 'polls is a list of {id, question, options, slide, movement, at}');
        m.polls.forEach(define);
        map = m.polls.map((p) => ({ id: p.id, movement: p.movement, at: p.at }));
      }
      return ok({ session, join: join() });
    }
    /* A claim takes the room for the window that makes it, if that window
       is a deck window connected now, and carries where it is, so the
       room moves to it in the same step. */
    if (m.type === 'claim') {
      if (typeof m.window !== 'string' || !windows.has(m.window)) {
        return refuse(409, 'only a deck window connected to the room can take it');
      }
      if (holder !== m.window) hold(m.window);
      if (m.id === undefined) return ok({ held: true });
      m = { ...m, type: 'slide' };
    }
    if (['slide', 'poll-open', 'poll-close', 'feedback-open'].includes(m.type) && !mayMove(m)) {
      return ok({ ignored: 'another window holds the room' });
    }
    if (m.type === 'slide') {
      if (typeof m.id !== 'string' || !Number.isInteger(m.step)) return refuse(400, 'slide needs an id and a step');
      if (m.holds !== undefined && !(Array.isArray(m.holds) && m.holds.length <= 500 && m.holds.every(HOLD))) {
        return refuse(400, 'holds is a list of [width, height] or null');
      }
      const id = m.id.slice(0, 200);
      /* The same step with new sizes, measured again once the deck's type
         had loaded: the phones are told to fetch it again. */
      const at = `${id}/${m.step}`;
      const fresh = m.holds !== undefined && JSON.stringify(sizes.get(at) || null) !== JSON.stringify(m.holds);
      if (m.holds !== undefined) sizes.set(at, m.holds);
      const again = state.slide && state.slide.id === id && state.slide.step === m.step;
      state.slide = { id, step: m.step, v: again ? state.slide.v + (fresh ? 1 : 0) : 0 };
      if (!(shown.get(id) >= m.step)) shown.set(id, m.step);
      if (map && Number.isInteger(m.at) && Number.isInteger(m.movement)) decide(m.at, m.movement);
      if (open) changed();                          // on its slide or off it, the presenter is told
      restage();
      return ok();
    }
    if (m.type === 'poll-open') {
      if (!isPoll(m)) return refuse(400, 'poll-open needs an id, a question and two to twelve options');
      define(m);
      open = m.id;
      restage();
      changed();
      return ok();
    }
    /* No id closes whatever is open: a deck that has just loaded does not
       know what the relay was showing before it. */
    /* The form, once the deck reaches the step that carries it, and from
       then to the end of the session. Questions that changed start the
       answers again, as a poll's options do. */
    if (m.type === 'feedback-open') {
      const qs = m.questions;
      if (!Array.isArray(qs) || !qs.length || qs.length > 20 ||
          !qs.every((q) => q && (q.kind === 'rate' || q.kind === 'ask') && text(q.text, 300))) {
        return refuse(400, 'feedback-open needs one to twenty questions, each rate or ask');
      }
      const same = form && JSON.stringify(form.questions) === JSON.stringify(qs);
      if (!same) form = { questions: qs.map((q) => ({ kind: q.kind, text: q.text })), answers: new Map() };
      restage();
      changed();
      return ok();
    }
    if (m.type === 'poll-close') {
      if (open !== null && (m.id === undefined || m.id === null || m.id === open)) {
        open = null;
        restage();
        changed();
      }
      return ok();
    }
    return refuse(400, `no deck message "${m.type}"`);
  }

  function fromPhone(m) {
    if (!m || typeof m !== 'object') return refuse(400, 'not a message');
    if (typeof m.token !== 'string' || !TOKEN.test(m.token)) {
      return refuse(400, 'a token is 8 to 64 letters, digits, - and _');
    }
    if (m.type === 'react') {
      if (!REACTIONS.some((r) => r.kind === m.kind)) return refuse(400, `no reaction "${m.kind}"`);
      if (!allow('react', m.token)) return refuse(429, 'one moment');
      seen.add(m.token);
      totals[m.kind] += 1;
      slideLog().reactions[m.kind] += 1;
      changed();
      persist();
      return ok();
    }
    if (m.type === 'pace') {
      if (m.value !== -1 && m.value !== 0 && m.value !== 1) return refuse(400, 'pace is -1, 0 or 1');
      if (!allow('pace', m.token)) return refuse(429, 'one moment');
      seen.add(m.token);
      pace.set(m.token, { token: m.token, value: m.value, at: now() });
      slideLog().pace[m.value < 0 ? 'slower' : m.value > 0 ? 'faster' : 'ok'] += 1;
      changed();
      persist();
      return ok();
    }
    /* One answer a phone, and the last one stands: a vote cast again
       replaces the one before rather than adding to it. Only the poll on
       the stage takes votes. */
    if (m.type === 'vote') {
      const p = polls.get(m.poll);
      if (!p || open !== m.poll) return refuse(409, 'that poll is not open');
      if (!Number.isInteger(m.option) || m.option < 0 || m.option >= p.options.length) {
        return refuse(400, `option is 0 to ${p.options.length - 1}`);
      }
      if (!allow('vote', m.token)) return refuse(429, 'one moment');
      seen.add(m.token);
      p.votes.set(m.token, m.option);
      changed();
      persist();
      return ok({ option: m.option });
    }
    /* A phone's form, whole; sent again, it replaces the one before. A
       score is 1 to 5 and a typed answer is text, and either may be left
       out, but not all of them. */
    if (m.type === 'feedback') {
      if (!form) return refuse(409, 'the form is not open');
      const qs = form.questions;
      if (!Array.isArray(m.answers) || m.answers.length !== qs.length) {
        return refuse(400, `answers are a list of ${qs.length}`);
      }
      const answers = m.answers.map((a, i) => {
        if (a === null || a === undefined || a === '') return null;
        if (qs[i].kind === 'rate') return Number.isInteger(a) && a >= 1 && a <= 5 ? a : undefined;
        return typeof a === 'string' && a.length <= ANSWER ? a.trim() || null : undefined;
      });
      if (answers.includes(undefined)) return refuse(400, `a score is 1 to 5, and an answer at most ${ANSWER} characters`);
      if (answers.every((a) => a === null)) return refuse(400, 'the form is empty');
      if (!allow('feedback', m.token)) return refuse(429, 'one moment');
      seen.add(m.token);
      form.answers.set(m.token, answers);
      changed();
      persist();
      return ok();
    }
    return refuse(400, `no phone message "${m.type}"`);
  }

  /* A listener is told the current state as it joins, so a phone opened
     mid-talk shows what is on stage rather than waiting for a change. */
  /** `deck` is the id of the deck window listening, which makes it one;
      `of` is the id of the deck a notes window belongs to, which does not.
      Either says whose point of view the tally's `room` takes. */
  function onTally(fn, { deck: win = null, of = null } = {}) {
    const id = typeof win === 'string' && win ? win : null;
    decks.set(fn, id || (typeof of === 'string' ? of : null));
    if (id) {
      windows.set(id, (windows.get(id) || 0) + 1);
      if (!everHeld) { holder = id; everHeld = true; }
      presence();
      changed();
    }
    fn(forListener(tally(), decks.get(fn)));
    return () => {
      decks.delete(fn);
      if (id) {
        const n = windows.get(id) - 1;
        if (n > 0) windows.set(id, n); else windows.delete(id);
        presence();
      }
    };
  }

  function onStage(fn) {
    phones.add(fn);
    fn(stage());
    changed();
    return () => { phones.delete(fn); changed(); };
  }

  /* The pace reading changes with nobody pressing anything, as the window
     slides off the signals in it, so while there are any the deck is told
     again every few seconds. */
  const ticking = tick ? setInterval(() => { if (pace.size) push(); }, tick) : null;
  if (ticking && ticking.unref) ticking.unref();

  function close() {
    clearTimeout(pending);
    clearInterval(ticking);
    clearTimeout(saving);
    clearTimeout(losing);
    if (save && spoken) save(record());
    decks.clear();
    phones.clear();
  }

  return { session, state, slides, fromDeck, fromPhone, tally, stage, record, reached, holds, shownSlides,
           onTally, onStage, restage, close };
}

// ----------------------------------------------------------------- routes

/* A message is small. Anything larger is refused before it is read in
   full, so a phone cannot make the laptop hold a body of any size. */
const LIMIT = 16 * 1024;

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > LIMIT) { resolve({ error: 413 }); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      try { resolve({ body: JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
      catch { resolve({ error: 400 }); }
    });
    req.on('error', () => resolve({ error: 400 }));
  });
}

function json(res, { status, body }) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/* Open a stream and hand `subscribe` a function that writes one event.
   A comment line every 25 seconds keeps a quiet stream from being closed
   by whatever sits between a phone and the laptop. */
function stream(req, res, subscribe) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const off = subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  const alive = setInterval(() => res.write(':\n\n'), 25000);
  alive.unref();
  req.on('close', () => { clearInterval(alive); off(); });
}

/* A message has to say it is JSON. A page on some other site can POST
   plain text to a port on this machine without asking; it cannot send
   this header without a preflight, and nothing here answers one, so a
   drive-by page cannot move the phones or vote on their behalf. */
function post(req, res, handle) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
    return json(res, refuse(415, 'send application/json'));
  }
  return readJson(req).then(({ body, error }) => {
    if (error) return json(res, refuse(error, error === 413 ? 'too large' : 'not JSON'));
    return json(res, handle(body));
  });
}

/** The four routes, over one relay. */
function routes(relay) {
  return {
    /* A deck window says so with `?deck=<its window id>`, which is how the
       relay knows a deck is there and which one; a notes window listens
       with `?of=<its deck's id>`, and is never a deck. */
    deckStream: (req, res) => {
      const q = new URL(req.url, 'http://relay').searchParams;
      return stream(req, res, (fn) => relay.onTally(fn, { deck: q.get('deck'), of: q.get('of') }));
    },
    deckPost: (req, res) => post(req, res, relay.fromDeck),
    phoneStream: (req, res) => stream(req, res, relay.onStage),
    phonePost: (req, res) => post(req, res, relay.fromPhone),
  };
}

module.exports = { createRelay, routes, sessionId, REACTIONS, LIMITS };
