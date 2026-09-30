/* One event stream a page. No dependencies, no build.
 *
 * A browser opens six connections at once to one origin and no more, and
 * an event stream holds one for as long as its page is open. A page of a
 * talk listens for several things: a save, the room's counts, the notes
 * on another device. A stream for each ran a speaker with two deck
 * windows out of connections, and the notes, which asked last, heard
 * nothing and said nothing. So a page holds one stream, `/events`, and
 * the server sends everything on it by name; lib/server.js says which.
 *
 * This file owns the stream, and the page's other scripts listen through
 * it. Loaded before them, so it is there for each:
 *
 *   ask(fn)        `fn` returns the part of the address a script needs,
 *                  as `{ name: value }`, and is asked again every time
 *                  the stream is opened
 *   on(name, fn)   `fn` is handed the data of every event of that name.
 *                  `open` and `error` are the stream's own, and `error`
 *                  is handed whether the browser has given up on it
 *   again()        what a script asks for has changed: the stream is
 *                  opened again if its address is not the one open now
 *
 * The stream opens once the page has been parsed, which is after every
 * script on it has run and said what it wants, so a page makes one
 * request for it rather than one per script as each arrives.
 */
(function () {
  "use strict";

  var asks = [];
  var heard = {};                      // name -> the functions listening for it
  var es = null;
  var url = "";
  var parsed = document.readyState !== "loading";

  function address() {
    var q = [];
    asks.forEach(function (fn) {
      var part = fn() || {};
      Object.keys(part).forEach(function (k) {
        if (typeof part[k] === "string") q.push(encodeURIComponent(k) + "=" + encodeURIComponent(part[k]));
      });
    });
    return "/events" + (q.length ? "?" + q.join("&") : "");
  }

  function tell(name, data) {
    (heard[name] || []).slice().forEach(function (fn) { fn(data); });
  }

  /* `open` and `error` are said by the stream itself, never sent by name. */
  function hear(name) {
    if (!es || name === "open" || name === "error") return;
    es.addEventListener(name, function (ev) { tell(name, ev.data); });
  }

  function open() {
    if (!parsed || !window.EventSource) return;
    var next = address();
    if (es && next === url) return;
    if (es) es.close();
    url = next;
    var mine = es = new window.EventSource(url);
    Object.keys(heard).forEach(hear);
    mine.onopen = function () { tell("open"); };
    mine.onerror = function () { tell("error", mine.readyState === 2); };
  }

  window.siparioEvents = {
    ask: function (fn) { asks.push(fn); open(); },
    on: function (name, fn) {
      if (!heard[name]) { heard[name] = []; hear(name); }
      heard[name].push(fn);
      open();
    },
    again: open
  };

  if (!parsed) document.addEventListener("DOMContentLoaded", function () { parsed = true; open(); });

  /* A page put away in the back-forward cache is not there to hear
     anything, though the browser may keep its connection open, and a deck
     window put away would go on holding the room and taking a device's
     commands. It lets go, and opens the stream again if it comes back. */
  window.addEventListener("pagehide", function () { if (es) es.close(); es = null; });
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) open(); });
})();
