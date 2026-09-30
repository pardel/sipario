'use strict';

/* A talk's server. Renders deck.md on every request and reloads the
 * browser when anything it depends on changes.
 *
 * Rendering per request rather than once at boot is deliberate: it costs
 * about a millisecond, and it means the page can never be a stale copy of
 * a file that has since been edited. There is no build artefact to be out
 * of date because there is no build artefact.
 *
 * Node's own http module and nothing else. The server answers a handful
 * of routes, and a framework would spend more lines being generic than
 * these spend being specific. A talk that opens the room answers a few
 * more, on a second listener; see `openRoom` below. The notes on another
 * device have a listener of their own; see `openRemote`.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { talk } = require('./talk.js');
/* Held as the module, not as its functions: a save under lib/ drops it from
   the require cache and reloadRenderer takes the new one, so the pages the
   server writes change with it, as the renderer does. */
let pages = require('./pages.js');
const { createRelay, routes: relayRoutes } = require('./relay.js');
const { createRemote } = require('./remote.js');
const { saveSession, sessionsDir } = require('./results.js');

const LIB = __dirname;
const ROOT = path.join(LIB, '..');            // the library, not the talk

/* What a talk's folders can hold. Anything else is sent as bytes, which
   a browser will save rather than show — the wrong outcome for a typo in
   an extension, and loud enough to be noticed. */
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const notFound = (res) => send(res, 404, 'text/plain; charset=utf-8', 'not found');

/** Stream one file, or 404 if it is not a regular file that exists.
 *  Given the request, it may answer 304: a phone in the room loads a
 *  slide into a fresh frame each time the talk moves, and without this
 *  would fetch the talk's fonts again every time. `no-cache` still asks
 *  each time, so a sheet edited mid-rehearsal reaches the phones. */
function sendFile(res, file, req) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
  };
  if (req) {
    const modified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
    headers['Last-Modified'] = modified.toUTCString();
    headers['Cache-Control'] = 'no-cache';
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (since >= modified.getTime()) {
      res.writeHead(304, { 'Last-Modified': headers['Last-Modified'], 'Cache-Control': 'no-cache' });
      return res.end();
    }
  }
  res.writeHead(200, headers);
  /* A file that vanishes between the stat and the read would otherwise
     leave the browser waiting on a response that never ends. */
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** A file under `root` named by the rest of the URL, and never one above
 *  it. The URL parser has already collapsed a literal `..`; this catches
 *  the encoded one, which it leaves alone. */
function sendUnder(res, root, rest, req) {
  let rel;
  try {
    rel = decodeURIComponent(rest);
  } catch {
    return notFound(res);
  }
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return notFound(res);
  return sendFile(res, file, req);
}

/* The address a phone in the room opens.
 *
 * A laptop has several: Wi-Fi, Ethernet, a VPN, a mesh network, a Docker
 * bridge. The phones are on the room's network, so the one wanted is this
 * machine's address there. The order it is chosen in:
 *
 *   1. SIPARIO_JOIN_HOST, or `joinHost` given to serve(), as it is
 *   2. the address the default route leaves from, unless that is a
 *      tunnel or a virtual bridge: a VPN that carries all traffic owns the
 *      default route, and its address is one no phone in the room can reach
 *   3. otherwise the first private address (10/8, 172.16/12, 192.168/16)
 *      on an interface that is neither, then any address on one
 *   4. and only then a tunnel's address, as a last resort
 *
 * Never loopback, never link-local (169.254/16), and IPv4 alone, because
 * an IPv6 address is not a thing anyone types. `route` is found by asking
 * the OS which address a UDP socket would send from towards a reserved
 * documentation address; connecting a UDP socket sends nothing. */
const TUNNEL = /^(utun|tun|tap|wg|ppp|ipsec|zt|tailscale|nordlynx|gpd)/i;
const VIRTUAL = /^(docker|br-|veth|vmnet|vboxnet|virbr|bridge|awdl|llw|anpi)/i;
const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;           // a mesh VPN's range
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function joinHost({ env = process.env, nets = os.networkInterfaces(), route = null, given = null } = {}) {
  if (given) return { host: given, via: 'joinHost' };
  if (env.SIPARIO_JOIN_HOST) return { host: env.SIPARIO_JOIN_HOST, via: 'SIPARIO_JOIN_HOST' };
  const found = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const n of list || []) {
      if (!(n.family === 'IPv4' || n.family === 4) || n.internal) continue;
      if (/^(127\.|169\.254\.)/.test(n.address)) continue;
      found.push({ host: n.address, via: name,
                   aside: TUNNEL.test(name) || VIRTUAL.test(name) || CGNAT.test(n.address) });
    }
  }
  const onRoute = found.find((f) => f.host === route);
  const pick = (onRoute && !onRoute.aside && onRoute) ||
    found.find((f) => !f.aside && PRIVATE.test(f.host)) || found.find((f) => !f.aside) ||
    onRoute || found[0];
  return pick ? { host: pick.host, via: pick.via } : { host: null, via: null };
}

/* Which address the default route leaves from, or null. */
function defaultRoute(done) {
  const dgram = require('dgram');
  const s = dgram.createSocket('udp4');
  const finish = (a) => { try { s.close(); } catch { /* closed */ } done(a); };
  s.on('error', () => finish(null));
  s.connect(9, '192.0.2.1', (err) => {
    let a = null;
    if (!err) { try { a = s.address().address; } catch { /* none */ } }
    finish(a);
  });
}

/* Who may see the script.
 *
 * The deck may be opened from anywhere the server can be reached, since
 * a second machine mirroring the room's screen is ordinary. The script
 * is another matter: the presenter window, the print page and the notes
 * the deck page carries are for the machine the talk is given from, and
 * nobody else on the network. So they are served to a request from this
 * machine's loopback, and to nothing else.
 *
 * By the socket's own address, never a header a client writes. A request
 * that carries a proxy's forwarding header is someone else's however it
 * arrived: a tunnel or reverse proxy on this machine connects over
 * loopback, and would otherwise hand the script to whoever is on the far
 * end of it. */
function fromThisMachine(req) {
  const h = req.headers || {};
  if (h.forwarded || h['x-forwarded-for'] || h['x-real-ip'] || h['cf-connecting-ip']) return false;
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '::1' || /^127\./.test(a) || /^::ffff:127\./i.test(a);
}

/** Serve one talk folder. Returns the http server, which is listening once
 *  it has said so with its 'listening' event: a deck that opens the room
 *  binds to 127.0.0.1, and Node resolves a named host before it listens,
 *  so `address()` is null until then.
 *
 *  A deck that says `audience: local` also opens the room: a relay, and a
 *  second listener for the phones. `audience: false` never opens it,
 *  which is how the export serves a talk; `audiencePort` moves the
 *  phones' listener, one above the deck's by default.
 *
 *  Every run also opens the notes to another device, behind a secret
 *  link, unless `remote: false`, which is how the export serves a talk
 *  too. */
function serve(dir, { port = Number(process.env.PORT) || 9999, log = console,
                      audience = true, audiencePort, joinHost: given = null, remote: wantsRemote = true } = {}) {
  const TALK = talk(dir);
  const { deck: DECK, deckCss: DECK_CSS, fontRoot: FONTS, imageRoot: IMAGES,
          templateRoot: TEMPLATES } = TALK;

  if (!fs.existsSync(DECK)) throw new Error(`no deck.md in ${TALK.dir}`);

  let { render, identity } = require('./render.js');
  let version = Date.now();        // bumped on every change; the reload token

  /* Whether this run opens the room is decided once, from the head of the
     file as it is now, because it decides where the deck itself listens.
     A deck that cannot say yet is served without one. */
  let head = null;
  try { head = identity(fs.readFileSync(DECK, 'utf8')); } catch { /* the render says why */ }
  const wantsRoom = audience !== false && !!head && head.audience === 'local';

  let asked = false;               // the room was asked for after the start
  const rendered = () => {
    const r = render(fs.readFileSync(DECK, 'utf8'), TALK);
    if (r.deck.audience === 'local' && !room && !asked && audience !== false) {
      asked = true;
      log.warn('[audience] deck.md asks for the room now; restart `sipario serve` to open it. ' +
        'The deck runs without it until then.');
    }
    return r;
  };

  /* The last few renders, by version. A deck in fullscreen holds a save
     back, and its notes have to show the version the room is seeing, not
     the file's latest; a window opened then asks for the version the deck
     names, and gets it if it has been rendered. A version never rendered
     falls through to the current one, which the page says it is. */
  const renders = new Map();
  function renderedAt(v) {
    if (v && renders.has(v)) return { r: renders.get(v), version: v };
    const cur = String(version);          // the query is a string; key alike
    if (!renders.has(cur)) {
      renders.set(cur, rendered());
      while (renders.size > 5) renders.delete(renders.keys().next().value);
    }
    return { r: renders.get(cur), version: cur };
  }

  // -------------------------------------------------------------- reload

  const clients = new Set();

  function stream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${version}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  /* The renderer is code, and code was the one thing that could go stale
   * here: deck.md is read on every request, but `require` caches the
   * module that reads it, so editing the renderer changed nothing until a
   * restart while the page went on claiming to be current. A talk's
   * templates are modules too, and lib/ caches the compiled markup, so a
   * template edited mid-rehearsal would otherwise change nothing at all.
   * The talk's own folder and the library's lib/ both go. */
  function reloadRenderer() {
    for (const id of Object.keys(require.cache)) {
      if (id.startsWith(TEMPLATES + path.sep) || id.startsWith(LIB + path.sep)) {
        delete require.cache[id];
      }
    }
    /* Both taken before either is used, so a syntax error in one keeps
       the last good pair rather than a new renderer with old pages. */
    const next = { render: require('./render.js').render, pages: require('./pages.js') };
    ({ render, pages } = next);
  }

  function changed(labels) {
    const code = labels.filter((l) => l === 'the engine' || l === 'templates');
    if (code.length) {
      try {
        reloadRenderer();
      } catch (err) {
        log.error(`[deck] ${code[0]} has a syntax error, keeping the last good one: ${err.message}`);
        return;
      }
    }
    version = Date.now();
    log.log(`[deck] ${labels.join(', ')} changed, reloading ${clients.size} client(s)`);
    for (const res of clients) res.write(`data: ${version}\n\n`);
  }

  /* The talk is watched as one folder, never file by file. A watcher on a
   * file follows its inode, and most editors save by writing a new file
   * and renaming it over the old one, so the first such save was the last
   * the server ever noticed: it went on watching a file that no longer
   * existed while the page claimed to be current. A folder watch is by
   * path, and the event names what changed under it.
   *
   * One save fires several events, and a save that renames fires for the
   * temp file too, so everything due is gathered for 60ms and flushed
   * once. Server-Sent Events rather than a WebSocket: one-way is all this
   * needs, it is a dozen lines with no dependency, and it reconnects by
   * itself when the server restarts. */
  const due = new Set();
  let pending = null;
  const watchers = [];
  function note(what) {
    due.add(what);
    clearTimeout(pending);
    pending = setTimeout(() => { const labels = [...due]; due.clear(); changed(labels); }, 60);
  }

  function watch(target, label) {
    try {
      watchers.push(fs.watch(target, { recursive: true }, (event, file) => {
        /* Inside the talk the first path segment is the thing that changed:
           deck.md, deck.css, or the folder a file sits in. A dotfile is an
           editor's temp file or the Finder's, never the talk, and the save
           it belongs to fires for the real name too. */
        const what = label || (file ? String(file).split(path.sep)[0] : 'the talk');
        if (!what.startsWith('.')) note(what);
      }));
    } catch (err) {
      /* A watcher that quietly watches nothing is worse than one that
         fails, so this warns rather than swallowing. */
      log.warn(`[deck] not watching ${label || 'the talk'}: ${err.message}`);
    }
  }

  watch(TALK.dir, null);
  watch(LIB, 'the engine');
  watch(path.join(ROOT, 'css'), 'css');
  watch(path.join(ROOT, 'js'), 'js');

  // --------------------------------------------------------------- routes

  /* `/css` and `/js` are the frame's alone. The talk's sheets answer to
     `/deck.css` and `/templates/<name>.css`, so no file a talk carries can
     shadow one the frame serves. `/images` and `/fonts` are each at the
     URL of its own name, which is what lets a check test a `src` the
     markup wrote by looking for it on disk. */
  const mounts = [
    ['/css', path.join(ROOT, 'css')],
    ['/js', path.join(ROOT, 'js')],
    ['/images', IMAGES],
    ['/fonts', FONTS],
  ];

  /* The deck's page fails as a page, so the room sees what broke. The
     presenter's fails as text: it is a popup the presenter opened, and a
     stack there is more use than a styled one. */
  function page(res, build, failed) {
    try {
      send(res, 200, 'text/html; charset=utf-8', build());
    } catch (err) {
      log.error(`[deck] ${err.message}`);
      failed(err);
    }
  }

  function handle(req, res) {
    /* A request line the URL parser refuses: `//[/` names an invalid
       host and throws rather than returning. Thrown here it reaches
       nobody, and an uncaught throw in a request handler takes the
       process with it — a stranger on the network could end a talk
       between two slides. A request that is not a URL is answered as
       one that is not, and the server stays up. */
    let asked;
    try {
      asked = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', 'bad request');
    }
    const { pathname, searchParams } = asked;
    const local = fromThisMachine(req);

    if (pathname === '/') {
      /* Served through the cache, so the version the room is seeing can
         be asked for by the notes later, however they were opened.
         Another machine gets the deck without its notes, and a deck that
         does not render without the reason, which can quote the deck. */
      return page(res, () => pages.deckPage(renderedAt().r, { notes: local, remote: !!remote }),
        (err) => send(res, 500, 'text/html; charset=utf-8', pages.errorPage(local ? err
          : { message: 'The deck does not render at the moment. This page reloads itself when it does.' })));
    }
    /* The script's own pages are this machine's alone, and anyone else is
       told they do not exist: a refusal would say that they do. */
    if ((pathname === '/presenter' || pathname === '/print') && !local) return notFound(res);
    if (pathname === '/presenter') {
      return page(res, () => { const at = renderedAt(searchParams.get('v')); return pages.presenterPage(at.r, port, at.version, remote ? 'notes' : null); },
        (err) => send(res, 500, 'text/plain; charset=utf-8', String(err.stack || err.message)));
    }
    if (pathname === '/print') {
      return page(res, () => pages.printPage(renderedAt().r),
        (err) => send(res, 500, 'text/html; charset=utf-8', pages.errorPage(err)));
    }
    if (pathname === '/reload') return stream(req, res);
    if (pathname === '/deck.css') return sendFile(res, DECK_CSS);

    /* The deck's half of the room, on the deck's own listener, so only
       this machine can move the phones. With no room open it says so,
       and the presenter window reports it; the deck carries on. */
    if (pathname === '/audience/stream' || pathname === '/audience/deck') {
      if (!room) return send(res, 503, 'text/plain; charset=utf-8', 'no room is open');
      if (pathname === '/audience/stream' && req.method === 'GET') return room.routes.deckStream(req, res);
      if (pathname === '/audience/deck' && req.method === 'POST') return room.routes.deckPost(req, res);
      return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
    }

    /* The deck windows' half of the notes on another device, and the
       link itself: this machine's alone, and asked for by name, so a page
       on some other site that has found its way to loopback (a DNS name
       rebound to 127.0.0.1) is not answered either. */
    if (pathname.startsWith('/remote/')) {
      if (!local || !remote || !LOOPBACK_HOST.test(req.headers.host || '')) return notFound(res);
      if (pathname === '/remote/window' && req.method === 'GET') return remote.hub.routes.windowStream(req, res);
      if (pathname === '/remote/window' && req.method === 'POST') return remote.hub.routes.windowPost(req, res);
      if (pathname === '/remote/link' && req.method === 'GET') return remote.link(res);
      if (pathname === '/remote/rotate' && req.method === 'POST') return remote.rotate(req, res);
      return notFound(res);
    }

    return files(pathname, res);
  }

  /* The talk's and the frame's files, by URL: the deck's listener serves
     them to anyone, the remote's to whoever holds the key. */
  function files(pathname, res) {
    for (const [prefix, root] of mounts) {
      if (pathname.startsWith(prefix + '/')) {
        return sendUnder(res, root, pathname.slice(prefix.length + 1));
      }
    }

    /* Only the stylesheets. `templates/` also holds the markup and the
       data functions, which are read here and never served: a talk's
       templates are not a public directory. */
    const sheet = pathname.match(/^\/templates\/([a-z0-9-]+\.css)$/);
    if (sheet) return sendFile(res, path.join(TEMPLATES, sheet[1]));

    return notFound(res);
  }

  // ---------------------------------------------------------------- room

  /* The phones' listener, and why it is a second one.
   *
   * A phone has to reach this machine over the room's network, and the
   * deck's listener serves the presenter window, the print page and every
   * file of the talk: the script, which the whole arrangement of this
   * library keeps off shared screens, and the templates' stylesheets and
   * figures, which are nobody's business before the talk. Filtering one
   * listener by route would make every route added later a question of
   * whether it had remembered to refuse a phone. Two listeners make it a
   * question of which one a route was written on.
   *
   * So with the room open the deck listens on this machine alone, and
   * the phones get a listener of their own on every interface, answering
   * the join page, its script and its sheet, the stage stream and the
   * phone's POST, and nothing else: not `/presenter`, not `/print`, not
   * a file of the talk.
   *
   * A room that cannot open, because its port is taken, is said once and
   * the deck serves without it. A talk never fails because the engagement
   * did. */
  let room = null;

  function openRoom() {
    const r = { server: null, port: null, route: null };
    r.host = () => joinHost({ route: r.route, given });
    r.join = () => (r.port === null ? '' : `http://${r.host().host || 'localhost'}:${r.port}/`);
    /* The session goes to disk outside the talk as the room speaks
       (lib/results.js says where). A disk that refuses is said once and
       the room carries on: the answers are still on the screen. */
    let refused = false;
    const save = (record) => {
      try { saveSession(head.key, record); } catch (err) {
        if (!refused) log.error(`[audience] the session could not be written: ${err.message}`);
        refused = true;
      }
    };
    const relay = r.relay = createRelay({ deck: head.name, join: r.join, save,
      held: () => { if (remote) remote.hub.changed(); } });
    r.routes = relayRoutes(relay);

    /* Which of the talk's images a phone may be sent.
     *
     * Those the room has already been shown, and those the talk's look is
     * made of. The first are the images the visible part of every step
     * shown so far refers to, read off the phone's own copy of each step,
     * so one held by a step for later does not count until it is on the
     * stage. The second are the images deck.css and the templates' sheets
     * name, which are the design rather than content, and are on every
     * slide there is. Anything else under images/ is a 404, like a slide
     * not yet reached: a figure's file name is not a way to see it early.
     *
     * Compared as files, not as strings: every address is resolved,
     * decoded, and taken to its real path on disk, and so is what a phone
     * asks for, so `..`, an encoded slash, a query, or a different case on
     * a disk that ignores case can neither slip past the list nor
     * collide with it. */
    const realImage = (rel) => {
      const file = path.resolve(IMAGES, rel);
      if (!file.startsWith(IMAGES + path.sep)) return null;
      try { return fs.realpathSync.native(file); } catch { return null; }
    };
    const imageOf = (ref, base) => {
      let u;
      try { u = new URL(ref, `http://phone${base}`); } catch { return null; }
      if (u.origin !== 'http://phone' || !u.pathname.startsWith('/images/')) return null;
      let rel;
      try { rel = decodeURIComponent(u.pathname.slice('/images/'.length)); } catch { return null; }
      return realImage(rel);
    };
    let allowed = { key: null, files: new Set() };
    function allowedImages() {
      const at = renderedAt();
      const key = at.version + ' ' + JSON.stringify(relay.shownSlides());
      if (allowed.key === key) return allowed.files;
      const files = new Set();
      const add = (f) => { if (f) files.add(f); };
      const sheets = [['/deck.css', DECK_CSS]].concat(fs.existsSync(TEMPLATES)
        ? fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.css')).map((f) => [`/templates/${f}`, path.join(TEMPLATES, f)])
        : []);
      for (const [url, file] of sheets) {
        let css = '';
        try { css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { continue; }
        for (const ref of pages.references(css)) add(imageOf(ref, url));
      }
      for (const [id, furthest] of relay.shownSlides()) {
        for (let k = 0; k <= furthest; k++) {
          const section = at.r.stepHtml && at.r.stepHtml.get(`${id}/${k}`);
          if (section) for (const ref of pages.references(pages.withoutUnreached(pages.withoutNotes(section)))) add(imageOf(ref, '/'));
        }
      }
      allowed = { key, files };
      return files;
    }

    function sendImage(req, res, pathname) {
      let rel;
      try { rel = decodeURIComponent(pathname.slice('/images/'.length)); } catch { return notFound(res); }
      const file = realImage(rel);
      let ok = false;
      try { ok = !!file && allowedImages().has(file); } catch { ok = false; }
      return ok ? sendFile(res, file, req) : notFound(res);
    }

    function handlePhone(req, res) {
      let pathname;
      try { ({ pathname } = new URL(req.url, 'http://phone')); } catch {
        return send(res, 400, 'text/plain; charset=utf-8', 'bad request');
      }
      if (req.method === 'GET' && pathname === '/') {
        return send(res, 200, 'text/html; charset=utf-8', pages.phonePage(relay.state.title));
      }
      if (req.method === 'GET' && pathname === '/phone.js') return sendFile(res, path.join(ROOT, 'js', 'phone.js'));
      if (req.method === 'GET' && pathname === '/phone.css') return sendFile(res, path.join(ROOT, 'css', 'phone.css'));
      if (req.method === 'GET' && pathname === '/stream') return r.routes.phoneStream(req, res);
      if (req.method === 'POST' && pathname === '/phone') return r.routes.phonePost(req, res);

      /* The slide on stage, one step at a time, and only one the room has
         already been shown: anything further on is a 404, the same as a
         slide that does not exist, so a phone cannot page ahead of the
         talk or learn that there is an ahead. */
      const one = pathname.match(/^\/slide\/([^/]+)\/(\d+)$/);
      if (req.method === 'GET' && one) {
        let id;
        try { id = decodeURIComponent(one[1]); } catch { return notFound(res); }
        const step = Number(one[2]);
        if (!relay.reached(id, step)) return notFound(res);
        let html = null;
        try { html = pages.slidePage(renderedAt().r, id, step, relay.holds(id, step)); } catch { html = null; }
        return html ? send(res, 200, 'text/html; charset=utf-8', html) : notFound(res);
      }

      /* What a slide is drawn with, and nothing else of the talk: the
         frame's stylesheet, the talk's, its templates' sheets, its fonts
         and its images. Never a template's markup or data function, never
         deck.md, and none of the deck's pages. */
      if (req.method === 'GET') {
        if (pathname === '/css/theme.css') return sendFile(res, path.join(ROOT, 'css', 'theme.css'), req);
        if (pathname === '/deck.css') return sendFile(res, DECK_CSS, req);
        if (pathname.startsWith('/images/')) return sendImage(req, res, pathname);
        if (pathname.startsWith('/fonts/')) return sendUnder(res, FONTS, pathname.slice('/fonts/'.length), req);
        const sheet = pathname.match(/^\/templates\/([a-z0-9-]+\.css)$/);
        if (sheet) return sendFile(res, path.join(TEMPLATES, sheet[1]), req);
      }
      return notFound(res);
    }

    const want = audiencePort !== undefined ? audiencePort : (port === 0 ? 0 : port + 1);
    r.server = http.createServer(handlePhone);
    r.server.on('error', (err) => {
      log.error(`[audience] the room could not open on port ${want}: ${err.code || err.message}. ` +
        'The deck runs without it.');
      relay.close();
      room = null;
    });
    r.server.listen(want, '0.0.0.0', () => {
      r.port = r.server.address().port;
      /* The route is asked again now and then, so a laptop that moves
         networks mid-talk hands out its new address. */
      const again = setInterval(() => defaultRoute((a) => { r.route = a; }), 30000);
      again.unref();
      r.server.on('close', () => clearInterval(again));
      defaultRoute((a) => {
        r.route = a;
        const { host, via } = r.host();
        const why = !host ? 'no network found: only this machine can reach it'
          : via === 'SIPARIO_JOIN_HOST' || via === 'joinHost' ? `from ${via}`
          : `${via}; SIPARIO_JOIN_HOST names another`;
        log.log(`[audience] phones join at ${r.join()}   (${why})`);
        log.log(`[audience] session ${relay.session}, kept in ${sessionsDir(head.key)}`);
      });
    });
    return r;
  }

  // -------------------------------------------------------------- remote

  /* The notes on another device: a phone or a tablet at the lectern, a
   * second laptop. They are the notes page itself, served to whoever
   * holds the link, and the link is a secret made for this run.
   *
   * On a listener of their own, and why. The deck's listener serves the
   * deck to anyone who can reach it, and with the room open it reaches
   * this machine alone, so a device could not reach it at all; the
   * phones' listener is the room's, and everything on it is for anyone in
   * the room. The notes are for nobody but the speaker. So they get a
   * third listener, on every interface, that answers nothing, not even
   * its front page, to a request without the key: the same 404 as a
   * page that does not exist. With the key it answers what the notes
   * page needs and no more: the page, its script and sheets, the talk's
   * look and images, the reload stream, the room's counts for its
   * header, and the stream and the commands that carry the channel to the
   * deck. Never the deck page, never `/print`, never a deck window's
   * half of the channel. Nothing an attendee can reach is any different
   * for it being there, in a room or without one.
   *
   * The key arrives in the link's query. The page's own requests for its
   * sheets and images cannot carry it, so the page is answered with it as
   * a cookie as well, for this port alone, `HttpOnly` and `SameSite=Strict`:
   * no script reads it, and no other site's page can send it. A new key
   * makes the cookie as dead as the link. */
  let remote = null;
  const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

  function openRemote() {
    const hub = createRemote({ holding: () => (room ? room.relay.holding() : undefined) });
    const r = { hub, server: null, port: null };
    const cookie = () => `sipario-remote-${r.port}`;
    r.url = (route) => `http://${joinHost({ route, given }).host || 'localhost'}:${r.port}/presenter?key=${hub.key()}`;

    function keyOf(req, searchParams) {
      if (searchParams.has('key')) return searchParams.get('key');
      const jar = String(req.headers.cookie || '').split(/;\s*/);
      const c = jar.find((x) => x.startsWith(cookie() + '='));
      return c ? c.slice(cookie().length + 1) : '';
    }

    function handleRemote(req, res) {
      let asked;
      try { asked = new URL(req.url, 'http://remote'); } catch {
        return send(res, 400, 'text/plain; charset=utf-8', 'bad request');
      }
      const { pathname, searchParams } = asked;
      const key = keyOf(req, searchParams);
      if (!hub.allows(key)) return notFound(res);
      /* A slide can link to another site; the link is not sent with it. */
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (pathname === '/remote/command' && req.method === 'POST') return hub.routes.devicePost(req, res);
      if (req.method !== 'GET') return notFound(res);
      if (pathname === '/presenter') {
        res.setHeader('Set-Cookie', `${cookie()}=${key}; Path=/; HttpOnly; SameSite=Strict`);
        res.setHeader('Cache-Control', 'no-store');
        return page(res, () => { const at = renderedAt(searchParams.get('v')); return pages.presenterPage(at.r, port, at.version, 'device'); },
          (err) => send(res, 500, 'text/plain; charset=utf-8', String(err.stack || err.message)));
      }
      if (pathname === '/remote/stream') return hub.routes.deviceStream(req, res);
      if (pathname === '/reload') return stream(req, res);
      if (pathname === '/deck.css') return sendFile(res, DECK_CSS);
      /* The room's counts, for the header: listened to as a notes window
         belonging to no deck, whatever the query says, so it can never
         pass for a deck window and hold the room. */
      if (pathname === '/audience/stream' && room) {
        req.url = '/audience/stream';
        return room.routes.deckStream(req, res);
      }
      return files(pathname, res);
    }

    /* The link, asked for by the notes on this machine: the route is
       asked again each time, so a laptop that has moved networks shows
       its new address. */
    r.link = (res) => defaultRoute((a) => send(res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ url: r.url(a) })));
    r.rotate = (req, res) => {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, 'text/plain; charset=utf-8', 'send application/json');
      }
      hub.rotate();
      log.log('[remote] a new link was made; the old one no longer works');
      return r.link(res);
    };

    r.server = http.createServer(handleRemote);
    r.server.on('error', (err) => {
      log.error(`[remote] the notes could not be opened to another device: ${err.code || err.message}`);
      remote = null;
    });
    r.server.listen(0, '0.0.0.0', () => {
      r.port = r.server.address().port;
      defaultRoute((a) => {
        log.log(`[remote] the notes on another device: ${r.url(a)}`);
        log.log('[remote] that link reads the script and moves the deck: treat it as a password');
      });
    });
    return r;
  }

  // --------------------------------------------------------------- serve

  if (wantsRoom) room = openRoom();
  if (wantsRemote) remote = openRemote();

  /* With the room open, the deck is this machine's alone; see above.
     Without one it listens as it always has. */
  const host = wantsRoom ? '127.0.0.1' : undefined;
  const server = http.createServer(handle).listen(port, host, () => {
    /* Asked for port 0, the OS chose one; the banner and the notes page
       name the port that is actually listening. */
    port = server.address().port;
    /* The first render is for the banner. A deck that does not render
       yet is the ordinary state of a deck being written, and the page
       already knows how to show the error and reload on the next save;
       the server has to be there for either to happen, so a failure here
       is reported and served, never thrown out of the process. */
    try {
      const r = rendered();
      log.log(`[deck] ${r.deck.name}: ${r.slides} slides, ${r.steps} steps  ->  ` +
        `http://localhost:${port}`);
    } catch (err) {
      log.error(`[deck] does not render yet: ${err.message.split('\n')[0]}`);
      log.log(`[deck] serving the error at http://localhost:${port}; it reloads on the next save`);
    }
  });

  /* A watcher outlives a closed server otherwise, and a process that
     exported a deck would sit there watching the talk it was done with. */
  server.on('close', () => {
    clearTimeout(pending);
    for (const w of watchers) w.close();
    if (room) {
      room.relay.close();
      room.server.close();
      if (room.server.closeAllConnections) room.server.closeAllConnections();
      room = null;
    }
    if (remote) {
      remote.server.close();
      if (remote.server.closeAllConnections) remote.server.closeAllConnections();
      remote = null;
    }
  });

  /* The room, for a caller that wants its address: `{ relay, server,
     port, join() }`, or null when none is open. */
  Object.defineProperty(server, 'room', { get: () => room });
  /* The notes on another device, for a caller that wants the link:
     `{ hub, server, port, url(route) }`, or null with `remote: false`. */
  Object.defineProperty(server, 'remote', { get: () => remote });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[deck] port ${port} is busy. PORT=${port - 1} npm start`);
      process.exit(1);
    }
    throw err;
  });

  return server;
}

module.exports = { serve, fromThisMachine, joinHost };
