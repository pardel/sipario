/* The notes on another device. No dependencies, no build.
 *
 * The notes window and its deck talk over a BroadcastChannel, which never
 * leaves one browser. For the notes on a phone or a tablet the server
 * carries the same messages instead (lib/remote.js), and this file is its
 * three ends, one per page, told apart by `data-remote` on the deck:
 *
 *   window   the deck, on the machine giving the talk: says where it is
 *            to the server, and takes the device's commands as if its own
 *            notes had sent them, by sending them on its own channel
 *   notes    the notes on that machine: the control that shows the link,
 *            and its QR code, and makes a new one
 *   device   the notes elsewhere: the channel js/presenter.js speaks over,
 *            the buttons that move the deck by touch, and what to say when
 *            the deck or the link has gone
 *
 * Loaded only where the server put it, so a page that has no part in
 * this makes no request of any kind for it. What the server says to a
 * deck window or a device comes as `remote` events on the page's one
 * stream (js/events.js).
 */
(function () {
  "use strict";

  var deck = document.getElementById("deck");
  var role = deck && deck.getAttribute("data-remote");
  if (!role) return;

  function post(url, msg) {
    return window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg)
    });
  }

  function copy(m, extra) {
    var out = {};
    Object.keys(m).forEach(function (k) { out[k] = m[k]; });
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  if (role === "window") deckWindow();
  else if (role === "notes") notes();
  else if (role === "device") device();

  /* ---- the deck, on this machine
   *
   * Everything here goes through the deck's own channel, as its notes do,
   * so the deck needs to know nothing about devices: where it is, it
   * already says on the channel; a device's "next" is said back on it as
   * the notes would say it, addressed to this window alone. The server
   * decides which window a device drives, and sends this window nothing
   * unless it is that one. */
  function deckWindow() {
    var ID = deck.getAttribute("data-deck") || "";
    var events = window.siparioEvents;
    if (!window.BroadcastChannel || !window.EventSource || !window.fetch || !events) return;
    var bus = new BroadcastChannel(ID);
    function tab() { return deck.getAttribute("data-window") || ""; }
    function say(m) {
      try { post("/remote/window", copy(m, { window: tab() })).catch(function () { /* the server went */ }); }
      catch (e) { /* likewise */ }
    }

    /* The clock as the server last told it, so notes opened later, or
       reloaded with the deck on a save, start from it. */
    var clock = null;
    function clockNow() {
      var m = clock.msg;
      return copy(m, { from: "presenter", tab: tab(),
                       elapsed: m.elapsed + (m.running ? Date.now() - clock.at : 0) });
    }

    bus.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.tab && m.tab !== tab()) return;
      if (m.from === "deck" && m.type === "state") {
        say({ type: "state", channel: ID, g: m.g, s: m.s, y: m.y, v: m.v, map: m.map });
      } else if (m.from === "presenter" && m.type === "clock") {
        say({ type: "clock", elapsed: m.elapsed, running: m.running, paused: m.paused });
      } else if (m.from === "presenter" && m.type === "hello" && clock) {
        bus.postMessage(clockNow());
      }
    };

    /* This window's half of the channel, asked for by its id. */
    events.ask(function () { return { window: tab() }; });
    events.on("remote", function (data) {
      var e;
      try { e = JSON.parse(data); } catch (x) { return; }
      var m = e && e.msg;
      if (!m || typeof m.type !== "string") return;
      if (m.type === "clock") clock = { msg: m, at: Date.now() };
      bus.postMessage(copy(m, { from: "presenter", tab: tab() }));
    });
    /* Asked as its notes ask, so the deck says where it is now. */
    function hello() { bus.postMessage({ from: "presenter", type: "hello", tab: tab() }); }

    hello();
    /* The same two acts that take the room take a device's commands. */
    deck.addEventListener("claimroom", function () { say({ type: "claim" }); });
    document.addEventListener("fullscreenchange", function () {
      if (document.fullscreenElement) say({ type: "claim" });
    });
    /* A duplicated tab given an id of its own is a new window here too. */
    deck.addEventListener("windowchange", function () { events.again(); hello(); });
    /* A page put away in the back-forward cache is not there to be
       driven; its stream lets go (js/events.js), and takes it up again if
       it comes back, when the deck is asked where it is. */
    window.addEventListener("pageshow", function (ev) { if (ev.persisted) hello(); });
  }

  /* ---- the notes, on this machine
   *
   * The link is asked for when the control is opened, never written into
   * the page: this page can be docked beside a deck that is on a shared
   * screen, and a link only appears when the speaker asks to see it. A
   * new link cuts off whatever held the old one, so it asks first. */
  function notes() {
    var btn = document.getElementById("remote-btn");
    var panel = document.getElementById("remote-panel");
    var elUrl = document.getElementById("remote-url");
    var elQr = document.getElementById("remote-qr");
    var again = document.getElementById("remote-rotate");
    if (!btn || !panel || !window.fetch) return;

    function show(url) {
      elUrl.textContent = url;
      var art = "";
      if (window.siparioQr) { try { art = window.siparioQr.svg(url); } catch (e) { art = ""; } }
      elQr.innerHTML = art;
    }
    function failed() {
      elUrl.textContent = "The link could not be read. Is serve still running?";
      elQr.innerHTML = "";
    }
    function load(asked) {
      asked.then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
        .then(function (b) { show(b.url); }, failed);
    }

    btn.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) load(window.fetch("/remote/link", { cache: "no-store" }));
    });

    var sure = false;
    if (again) again.addEventListener("click", function () {
      if (!sure) {
        sure = true;
        again.textContent = "Press again: anything using this link is cut off";
        return;
      }
      sure = false;
      again.textContent = "New link";
      load(post("/remote/rotate", {}));
    });
  }

  /* ---- the notes, elsewhere
   *
   * The page came with the key in its address, and asks the server with
   * it for everything after: the page's stream, which on this listener
   * carries where the deck is, and each command. */
  function device() {
    var q = (/[?&]key=([^&#]*)/.exec(location.search) || [])[1] || "";
    var KEY = "?key=" + q;
    var events = window.siparioEvents;
    var channels = [];
    var elStatus = document.getElementById("remote-status");
    var cut = false;

    function status(text) { if (elStatus) { elStatus.textContent = text; elStatus.title = text; } }

    /* The link was replaced on the laptop, or serve started again with a
       new one: nothing more is shown or sent. The server has ended the
       stream, and refuses it when the browser asks again. */
    function revoked() {
      if (cut) return;
      cut = true;
      document.body.classList.add("cut");
      status("This link no longer works. Open the new one from the notes on the laptop.");
    }

    function send(msg) {
      if (cut || !window.fetch) return;
      post("/remote/command" + KEY, msg)
        .then(function (r) { if (r.status === 404) revoked(); })
        .catch(function () { status("The laptop is not answering."); });
    }

    /* A channel as js/presenter.js expects one, carried by the server. */
    window.__remoteChannel = function (name) {
      var ch = {
        name: name, onmessage: null, onmessageerror: null,
        postMessage: function (msg) { send(msg); },
        close: function () { var i = channels.indexOf(ch); if (i > -1) channels.splice(i, 1); }
      };
      channels.push(ch);
      return ch;
    };

    /* The deck going is said only once it has been gone a moment: its
       window drops for an instant each time a save reloads it. */
    var gone = null, there = true;
    function deckThere(yes) {
      if (yes === there) return;
      there = yes;
      clearTimeout(gone);
      if (yes) { if (!cut) status(""); return; }
      gone = setTimeout(function () {
        if (!cut) status("The deck on the laptop has gone. This is the last slide it showed.");
      }, 3000);
    }

    if (window.EventSource && events) {
      events.ask(function () { return { key: q }; });
      events.on("remote", function (data) {
        var e;
        try { e = JSON.parse(data); } catch (x) { return; }
        if (!e) return;
        if (e.type === "live") { deckThere(!!e.live); return; }
        if (e.type === "cut") { revoked(); return; }
        if (e.type !== "message" || !e.msg) return;
        channels.slice().forEach(function (ch) {
          if (e.channel && ch.name !== e.channel) return;
          if (ch.onmessage) ch.onmessage({ data: e.msg });
        });
      });
      /* A dropped connection is retried by the browser. A refused one is
         not, and a refusal is the link being gone. */
      events.on("error", function (refused) {
        if (refused) revoked();
        else if (!cut) status("Lost the laptop. Trying again…");
      });
    }

    document.querySelectorAll("#remote-controls [data-command]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-command");
        send(c === "left" || c === "right" ? { from: "presenter", type: "go", dir: c } : { from: "presenter", type: c });
      });
    });
  }
})();
