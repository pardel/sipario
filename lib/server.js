'use strict';

/* A talk's server. Renders deck.md on every request and reloads the
 * browser when anything it depends on changes.
 *
 * Rendering per request rather than once at boot is deliberate: it costs
 * about a millisecond, and it means the page can never be a stale copy of
 * a file that has since been edited. There is no build artefact to be out
 * of date because there is no build artefact.
 *
 * Node's own http module and nothing else. The server answers seven
 * routes, all GET, and a framework would spend more lines being generic
 * than these spend being specific.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { talk } = require('./talk.js');
const { deckPage, presenterPage, errorPage } = require('./pages.js');

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

/** Stream one file, or 404 if it is not a regular file that exists. */
function sendFile(res, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
  });
  /* A file that vanishes between the stat and the read would otherwise
     leave the browser waiting on a response that never ends. */
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** A file under `root` named by the rest of the URL, and never one above
 *  it. The URL parser has already collapsed a literal `..`; this catches
 *  the encoded one, which it leaves alone. */
function sendUnder(res, root, rest) {
  let rel;
  try {
    rel = decodeURIComponent(rest);
  } catch {
    return notFound(res);
  }
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return notFound(res);
  return sendFile(res, file);
}

/** Serve one talk folder. Returns the http server, already listening. */
function serve(dir, { port = Number(process.env.PORT) || 9999, log = console } = {}) {
  const TALK = talk(dir);
  const { deck: DECK, deckCss: DECK_CSS, fontRoot: FONTS, imageRoot: IMAGES,
          templateRoot: TEMPLATES } = TALK;

  if (!fs.existsSync(DECK)) throw new Error(`no deck.md in ${TALK.dir}`);

  let { render } = require('./render.js');
  let version = Date.now();        // bumped on every change; the reload token

  const rendered = () => render(fs.readFileSync(DECK, 'utf8'), TALK);

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
    ({ render } = require('./render.js'));
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
  function note(what) {
    due.add(what);
    clearTimeout(pending);
    pending = setTimeout(() => { const labels = [...due]; due.clear(); changed(labels); }, 60);
  }

  function watch(target, label) {
    try {
      fs.watch(target, { recursive: true }, (event, file) => {
        /* Inside the talk the first path segment is the thing that changed:
           deck.md, deck.css, or the folder a file sits in. A dotfile is an
           editor's temp file or the Finder's, never the talk, and the save
           it belongs to fires for the real name too. */
        const what = label || (file ? String(file).split(path.sep)[0] : 'the talk');
        if (!what.startsWith('.')) note(what);
      });
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
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/') {
      return page(res, () => deckPage(rendered()),
        (err) => send(res, 500, 'text/html; charset=utf-8', errorPage(err)));
    }
    if (pathname === '/presenter') {
      return page(res, () => presenterPage(rendered(), port),
        (err) => send(res, 500, 'text/plain; charset=utf-8', String(err.stack || err.message)));
    }
    if (pathname === '/reload') return stream(req, res);
    if (pathname === '/deck.css') return sendFile(res, DECK_CSS);

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

  // --------------------------------------------------------------- serve

  const server = http.createServer(handle).listen(port, () => {
    const r = rendered();
    log.log(`[deck] ${r.deck.name}: ${r.slides} slides, ${r.steps} steps  ->  ` +
      `http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[deck] port ${port} is busy. PORT=${port - 1} npm start`);
      process.exit(1);
    }
    throw err;
  });

  return server;
}

module.exports = { serve };
