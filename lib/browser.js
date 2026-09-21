'use strict';

/* A browser already on the machine, driven over its DevTools protocol.
 *
 * The export needs a layout engine, and the one the deck was written
 * against is the one the talk is rehearsed in. Chrome, Chromium, Brave
 * and Edge carry the same one and speak the same protocol, so the export
 * borrows whichever is installed rather than shipping one: sipario has
 * no dependencies, and a browser downloaded into node_modules would be a
 * large first. `SIPARIO_BROWSER` names a binary when the search below
 * would miss it, or pick the wrong one.
 *
 * The protocol is JSON over a WebSocket, and Node 22 has a WebSocket of
 * its own, so this is a page of code rather than a package: launch, find
 * the page, send a command and wait for its answer. Only the four
 * commands the export uses are wrapped.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Where each platform keeps a browser. A bare name is looked up on PATH;
   an absolute path is tried as it is. The order is preference: Chrome
   first, because it is the one the deck is most often rehearsed in. */
const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  linux: [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    'brave-browser', 'microsoft-edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
};

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

function onPath(name, env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (dir && isFile(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

const resolve = (c, env) => (path.isAbsolute(c) ? (isFile(c) ? c : null) : onPath(c, env));

/** The browser binary to export with. Named by SIPARIO_BROWSER, or the
 *  first of the platform's usual places that holds one. Neither is an
 *  error that names what was looked for and how to point at one. */
function findBrowser(env = process.env, platform = process.platform) {
  if (env.SIPARIO_BROWSER) {
    const found = resolve(env.SIPARIO_BROWSER, env);
    if (found) return found;
    throw new Error(`SIPARIO_BROWSER is ${env.SIPARIO_BROWSER}, which is not a file here`);
  }
  const list = (CANDIDATES[platform] || []).slice();
  if (platform === 'darwin') {
    /* A browser installed for one user sits under ~/Applications. */
    list.push(...CANDIDATES.darwin.map((c) => path.join(os.homedir(), c.slice(1))));
  }
  for (const c of list) {
    const found = resolve(c, env);
    if (found) return found;
  }
  throw new Error('no browser to export with. Looked for Chrome, Chromium, Brave and Edge ' +
    `in their usual places on ${platform}; install one, or set SIPARIO_BROWSER to the ` +
    'binary of one that is.');
}

// ------------------------------------------------------------ the session

/* One WebSocket to one page. Commands are numbered and answered by
   number; events arrive unnumbered and are kept for whoever is waiting
   on one. */
class Session {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.waiting = [];
    this.events = [];
    ws.onmessage = (e) => this.receive(JSON.parse(e.data));
    ws.onclose = () => this.fail(new Error('the browser closed the connection'));
  }

  receive(m) {
    if (m.id) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (!p) return;
      if (m.error) p.no(new Error(`${p.method}: ${m.error.message}`));
      else p.ok(m.result);
      return;
    }
    const i = this.waiting.findIndex((w) => w.method === m.method);
    if (i >= 0) this.waiting.splice(i, 1)[0].ok(m);
    else this.events.push(m);
  }

  /* Everything still waiting is told, commands and events alike. An
     event waiter used to be left out, and a browser that went away after
     answering the navigation but before the load event left `open()`
     waiting for a message that could no longer arrive: no error, no
     timeout, an export that never returned and never said why. A promise
     nothing can settle is worse than a failure. */
  fail(err) {
    for (const p of this.pending.values()) p.no(err);
    this.pending.clear();
    const waiting = this.waiting.splice(0);
    for (const w of waiting) w.no(err);
  }

  send(method, params = {}) {
    return new Promise((ok, no) => {
      this.pending.set(++this.seq, { ok, no, method });
      this.ws.send(JSON.stringify({ id: this.seq, method, params }));
    });
  }

  /** The next event of this name, or one that already arrived. It
   *  rejects if the connection fails before the event arrives. */
  once(method) {
    const i = this.events.findIndex((m) => m.method === method);
    if (i >= 0) return Promise.resolve(this.events.splice(i, 1)[0]);
    return new Promise((ok, no) => this.waiting.push({ method, ok, no }));
  }
}

// ---------------------------------------------------------------- the page

class Page {
  constructor(session) { this.s = session; }

  /** Load a URL and wait for its load event. */
  async open(url, { width = 1280, height = 720, scale = 2 } = {}) {
    await this.s.send('Page.enable');
    /* The device scale is what makes a screenshot sharp: at 2 the
       picture of a 1280-wide stage is 2560 across, which is what a
       projector or a Retina screen would ask of it. */
    await this.s.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: scale, mobile: false });
    /* The wait is set up before the navigation is sent, so a load event
       arriving between the two cannot be missed.
       That also leaves it waiting with nothing attached to it while the
       navigation is in flight, and a browser going away in that gap
       fails both at once. A rejection nobody is holding yet ends the
       process, however carefully the caller wrapped this call, so the
       wait is handed a handler the moment it exists: `settled` takes the
       failure as a value rather than a throw, and which of the two lands
       first stops mattering. */
    const loaded = this.s.once('Page.loadEventFired');
    const settled = loaded.then(() => null, (err) => err);
    const nav = await this.s.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
    const failed = await settled;
    if (failed) throw failed;
  }

  /** Run an expression in the page and return its value; a promise is
   *  awaited. An exception in the page is an exception here, with the
   *  page's own message. */
  async evaluate(expression) {
    const r = await this.s.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`in the page: ${(d.exception && d.exception.description) || d.text}`);
    }
    return r.result.value;
  }

  /** A PNG of one region of the page, in page coordinates. */
  async screenshot({ x, y, width, height }) {
    const r = await this.s.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x, y, width, height, scale: 1 },
      captureBeyondViewport: true,
    });
    return Buffer.from(r.data, 'base64');
  }

  /** The page as a PDF, on paper of the given size in inches, edge to
   *  edge, with the page's own backgrounds and no header or footer. */
  async pdf({ width, height }) {
    const r = await this.s.send('Page.printToPDF', {
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: false,
      paperWidth: width,
      paperHeight: height,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale: 1,
    });
    return Buffer.from(r.data, 'base64');
  }
}

// -------------------------------------------------------------- the launch

/** Start a headless browser and connect to its one page. Returns
 *  `{ page, close }`; `close` ends the browser and removes the profile it
 *  was given. The `bin` defaults to `findBrowser()`. */
async function launch({ bin = findBrowser(), timeout = 20000 } = {}) {
  /* A profile of its own, in the temp folder, so the export never opens
     the reader's own browser with its own windows, and leaves nothing
     behind but what it removes on close. */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sipario-browser-'));
  const child = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const cleanup = () => fs.rmSync(profile, { recursive: true, force: true });

  /* The browser announces its endpoint on stderr, on a port it chose,
     which is the one thing on stderr this reads. */
  let banner = '';
  const endpoint = await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error(
      `${bin} did not start in ${timeout / 1000}s: ${banner.trim().split('\n').pop() || 'no output'}`)), timeout);
    child.stderr.on('data', (c) => {
      banner += c;
      const m = banner.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      no(new Error(`${bin} exited with ${code} before it was ready: ${banner.trim()}`));
    });
    child.on('error', (err) => { clearTimeout(timer); no(err); });
  }).catch((err) => { child.kill(); cleanup(); throw err; });

  const http = endpoint.replace(/^ws:\/\/([^/]+).*$/, 'http://$1');
  const targets = await (await fetch(`${http}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) { child.kill(); cleanup(); throw new Error('the browser opened no page'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('could not connect to the browser')); });
  const session = new Session(ws);

  const close = () => new Promise((done) => {
    session.ws.onclose = null;
    try { ws.close(); } catch { /* already gone */ }
    if (child.exitCode !== null) { cleanup(); return done(); }
    const hard = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(hard); cleanup(); done(); });
    child.kill();
  });

  return { page: new Page(session), close, bin };
}

/* `Session` is exported for the suite, which drives it over a socket of
   its own: what it does when the browser goes away is the half that
   cannot be tested by exporting a deck successfully. */
module.exports = { findBrowser, launch, CANDIDATES, Session, Page };
