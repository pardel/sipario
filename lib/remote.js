'use strict';

/* The notes on another device: a phone or a tablet at the lectern, or a
 * second laptop, following the deck and driving it.
 *
 * The notes window and its deck talk over a BroadcastChannel, which never
 * leaves one browser. A device elsewhere is given the same conversation
 * through the server instead: the deck window on this machine says where
 * it is, and the server passes that on to every device; a device says
 * what the notes would say (next, back, a movement, the clock), and the
 * server hands it to one deck window, which acts as if its own notes had
 * said it. The messages are the ones the channel already carries, so
 * js/presenter.js runs on a device as it runs here.
 *
 *   GET  /events?window=<id>   server -> deck window, this machine only
 *   POST /remote/window        deck window -> server: state, claim, clock
 *   GET  /events               server -> device, with the key
 *   POST /remote/command       device -> server, with the key
 *
 * The two streams are each page's one stream (lib/server.js), where what
 * goes to a deck window or a device is a `remote` event: a browser holds
 * six connections open to one origin, and a stream for every purpose
 * spent them.
 *
 * A device is anyone holding the key, a random string made per run of
 * `serve` and replaced on request. It is a password: it reads the script
 * and moves the deck. Compared in constant time, never written anywhere
 * but where the speaker asked to see it.
 *
 * Which deck window a device drives is the one that holds the room. With
 * a room open the relay already decides that (lib/relay.js), and this
 * asks it; without one this keeps the same rule itself: the first deck
 * window to connect, until another is given H or goes full screen. The
 * holder gone, nothing is driven and the devices are told, until a window
 * claims it again. Nothing moves a window that does not hold it.
 */

const crypto = require('crypto');
const { post } = require('./relay.js');

/* 192 bits, URL-safe: 32 characters, well inside what a QR code carries. */
const newKey = () => crypto.randomBytes(24).toString('base64url');
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

/* What a device may ask of the deck: what the notes window may, less
   what only makes sense beside it (docking, closing, detaching). */
const COMMANDS = new Set(['next', 'back', 'go', 'top', 'reset', 'map']);
const DIRS = new Set(['up', 'down', 'left', 'right']);

/* Lightly: a thumb on a button, or a clicker held down, is well inside
   this; a loop posting as fast as it can is not. For all devices at once. */
const LIMIT = { count: 20, per: 2000 };

const reply = (status, body) => ({ status, body });
const ok = (body = {}) => reply(200, { ok: true, ...body });
const refuse = (status, error) => reply(status, { ok: false, error });

/** `holding` is asked which deck window holds the room: the relay's
 *  answer while a room is open, `undefined` when there is none, in which
 *  case this keeps its own. `now` is the clock. */
function createRemote({ holding = () => undefined, now = Date.now } = {}) {
  let key = newKey();
  const devices = new Map();       // a device's listener -> what ends its stream
  const windows = new Map();       // deck window id -> its listeners
  const states = new Map();        // deck window id -> { channel, msg }, where it last was
  let own = null;                  // the holder, when there is no room to ask
  let everHeld = false;
  let clock = null;                // { elapsed, running, paused, at }
  let recent = [];

  function holder() {
    const h = holding();
    return h === undefined ? own : h;
  }
  const live = () => { const h = holder(); return h !== null && windows.has(h); };

  /** Whether `given` is the key. Both sides are hashed first, so the
      comparison takes the same time whatever the lengths. */
  function allows(given) {
    return typeof given === 'string' && given !== '' && crypto.timingSafeEqual(digest(given), digest(key));
  }

  /* The clock as it reads now, in the notes' own message. */
  function clockNow() {
    return clock && { from: 'presenter', type: 'clock', running: clock.running, paused: clock.paused,
                      elapsed: clock.elapsed + (clock.running ? now() - clock.at : 0) };
  }

  function toDevices(event) { for (const fn of devices.keys()) fn(event); }
  function toHolder(msg) {
    for (const fn of windows.get(holder()) || []) fn({ type: 'message', msg });
  }

  /* What a device is told as it connects, and again whenever the deck it
     follows changes: whether there is one, where it is, and the clock. */
  function catchUp(fn) {
    fn({ type: 'live', live: live() });
    const st = states.get(holder());
    if (st) fn({ type: 'message', channel: st.channel, msg: st.msg });
    const c = clockNow();
    if (c) fn({ type: 'message', msg: c });
  }

  let told = null;
  /** The holder, or whether it is there, may have changed. */
  function changed() {
    const said = `${holder()} ${live()}`;
    if (said === told) return;
    told = said;
    for (const fn of devices.keys()) catchUp(fn);
  }

  function setClock(m, fromDevice) {
    if (!(typeof m.elapsed === 'number' && Number.isFinite(m.elapsed) && m.elapsed >= 0 && m.elapsed < 1e9) ||
        typeof m.running !== 'boolean') {
      return refuse(400, 'a clock is {elapsed, running, paused}');
    }
    clock = { elapsed: m.elapsed, running: m.running, paused: m.paused === true, at: now() };
    const msg = clockNow();
    toDevices({ type: 'message', msg });
    /* A device's clock reaches the notes on this machine through their
       deck; the notes' own reaches only the devices. */
    if (fromDevice) toHolder(msg);
    return ok();
  }

  /* ---- a deck window on this machine */

  function fromWindow(m) {
    if (!m || typeof m !== 'object') return refuse(400, 'not a message');
    if (typeof m.window !== 'string' || !m.window) return refuse(400, 'a message names its window');
    if (m.type === 'state') {
      if (![m.g, m.s, m.y].every(Number.isInteger)) return refuse(400, 'a state is g, s and y');
      const msg = { from: 'deck', type: 'state', tab: m.window, g: m.g, s: m.s, y: m.y,
                    map: m.map === true, v: typeof m.v === 'string' ? m.v : null };
      const channel = typeof m.channel === 'string' ? m.channel : '';
      states.set(m.window, { channel, msg });
      if (m.window === holder()) toDevices({ type: 'message', channel, msg });
      return ok();
    }
    if (m.type === 'claim') {
      if (holding() !== undefined) return ok({ ignored: 'the room decides' });
      if (!windows.has(m.window)) return refuse(409, 'only a deck window connected here can take it');
      own = m.window;
      everHeld = true;
      changed();
      return ok();
    }
    if (m.type === 'clock') {
      if (m.window !== holder()) return ok({ ignored: 'another window holds the room' });
      return setClock(m, false);
    }
    return refuse(400, `no window message "${m.type}"`);
  }

  function onWindow(id, fn) {
    if (!windows.has(id)) windows.set(id, new Set());
    windows.get(id).add(fn);
    if (!everHeld) { own = id; everHeld = true; }
    const c = clockNow();
    if (c) fn({ type: 'message', msg: c });
    changed();
    return () => {
      const set = windows.get(id);
      set.delete(fn);
      if (!set.size) { windows.delete(id); states.delete(id); }
      changed();
    };
  }

  /* ---- a device, holding the key */

  function fromDevice(m) {
    if (!m || typeof m !== 'object') return refuse(400, 'not a message');
    const t = now();
    recent = recent.filter((x) => t - x < LIMIT.per);
    if (recent.length >= LIMIT.count) return refuse(429, 'one moment');
    recent.push(t);
    if (m.type === 'hello') { for (const fn of devices.keys()) catchUp(fn); return ok(); }
    if (m.type === 'clock') return setClock(m, true);
    if (!COMMANDS.has(m.type)) return refuse(400, `no remote command "${m.type}"`);
    if (m.type === 'go' && !DIRS.has(m.dir)) return refuse(400, 'go is up, down, left or right');
    if (!live()) return refuse(409, 'no deck window holds the room');
    toHolder(m.type === 'go' ? { type: 'go', dir: m.dir } : { type: m.type });
    return ok();
  }

  function onDevice(fn, end) {
    devices.set(fn, end);
    catchUp(fn);
    return () => devices.delete(fn);
  }

  /** A new key. Every device connected with the old one is told, and cut
      off at once, and nothing it asks for is answered again. */
  function rotate() {
    key = newKey();
    for (const [fn, end] of devices) { fn({ type: 'cut' }); end(); }
    devices.clear();
    return key;
  }

  const routes = {
    windowPost: (req, res) => post(req, res, fromWindow),
    devicePost: (req, res) => post(req, res, fromDevice),
  };

  return { key: () => key, allows, rotate, holder, live, changed, fromWindow, fromDevice,
           onWindow, onDevice, routes, devices: () => devices.size };
}

module.exports = { createRemote, LIMIT };
