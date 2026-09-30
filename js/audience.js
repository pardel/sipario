/* The room, from the deck's side. No dependencies, no build.
 *
 * Loaded only on a page whose deck names an audience, so a deck that
 * does not make no audience request of any kind: this file is not on its
 * page. The relay is `/audience` on the deck's own origin for
 * `audience: local`, or the address the deck gives; the messages are the
 * same either way, and lib/relay.js is where they are written down.
 *
 * The same file runs in two windows and does a different job in each.
 * In the deck it says where the talk is, so the phones can follow the
 * slide, and draws what the room has said onto the stage where the talk's
 * templates ask for it. In the presenter window it fills the panel by the
 * clock and says so there when the relay cannot be reached. The deck
 * never says that: the room's screen is not where a failure of the
 * engagement belongs, and a talk never stops because of one.
 */
(function () {
  "use strict";

  var deck = document.getElementById("deck");
  var WHERE = deck && deck.getAttribute("data-audience");
  if (!WHERE) return;
  var BASE = WHERE === "local" ? "/audience" : WHERE.replace(/\/+$/, "");

  /* The notes page wears its own header bar; the deck does not (its dock's
     bar is `dock-bar`). The notes hold a hidden copy of the deck as well,
     which is why the role is read off the bar rather than off the deck. */
  var panel = document.getElementById("notes-bar");

  /* ---- deck -> relay */

  function send(msg) {
    if (!window.fetch) return;
    try {
      window.fetch(BASE + "/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg)
      }).catch(function () { /* the presenter window says so, once */ });
    } catch (e) { /* likewise */ }
  }

  /* Where the talk is: the slide, by the id its first step carries, and
     the step within it. Sent when it changes, not on every show. Two deck
     windows of one talk, a projector and a laptop, both say where they
     are, and the phones follow whichever moved last. */
  var said = "";                       // the position and sizes last sent
  var saidAt = "";                     // and the position alone

  /* A step carrying a poll says so in `data-poll`, the poll whole, so
     this never has to know how a template drew it. */
  function pollOf(el) {
    if (!el || !el.hasAttribute("data-poll")) return null;
    if (el.__poll === undefined) {
      try { el.__poll = JSON.parse(el.getAttribute("data-poll")); } catch (e) { el.__poll = null; }
    }
    return el.__poll;
  }

  /* Where the deck is, as the relay needs it to decide which poll is
     open: the step's place among every step of the deck, and the
     movement it is in, counted from 0 in document order. */
  var every = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  var movements = Array.prototype.slice.call(deck.querySelectorAll(".group"));
  function movementOf(el) { return movements.indexOf(el.closest(".group")); }

  /* Every poll in the deck and where it is put: its slide, its movement,
     and the first step that carries it. Sent once, in the hello, so the
     relay can keep a poll open for the rest of its movement without
     being told what to do by anything but the deck's position. */
  function pollMap() {
    var out = [], seenIds = {};
    every.forEach(function (el, i) {
      var p = pollOf(el);
      if (!p || seenIds[p.id]) return;
      seenIds[p.id] = true;
      out.push({ id: p.id, question: p.question, options: p.options,
                 slide: el.parentNode.querySelector(".slide").id, movement: movementOf(el), at: i });
    });
    return out;
  }

  /* The size of every element this step holds for what it has not shown
     yet, `hidden-step` and `ghost`, measured here where the real layout
     is, so a phone's copy can hold the same room without the words. In
     document order, one per outermost held element; `null` for SVG, whose
     figure's viewBox lays it out. Measured in the stage's own pixels, the
     slide's scale divided out. */
  function holdsOf(here) {
    var out = [];
    var box = here.getBoundingClientRect();
    var k = here.offsetWidth ? box.width / here.offsetWidth : 1;
    here.querySelectorAll(".hidden-step, .ghost").forEach(function (el) {
      if (el.parentElement && el.parentElement.closest(".hidden-step, .ghost")) return;
      if (!(el instanceof window.HTMLElement)) { out.push(null); return; }
      var r = el.getBoundingClientRect();
      var size = [Math.round(r.width / k * 100) / 100, Math.round(r.height / k * 100) / 100];
      if (window.getComputedStyle(el).display === "inline") size.push("inline");
      out.push(size);
    });
    return out;
  }

  /* This window, as the room knows it: the deck's own id for its tab
     (js/deck.js), which survives a reload on save and is not shared with
     another tab. Every position is said as this window's; the relay takes
     position from the window that holds the room and ignores the rest. */
  function windowId() { return deck.getAttribute("data-window") || ""; }

  /* Where the deck is, as a message: the slide, the step, what the step
     holds for later, and its place in the deck and its movement. */
  function where(type) {
    var here = deck.querySelector(".slide.current");
    if (!here) return null;
    var steps = here.parentNode.querySelectorAll(".slide");
    var step = Array.prototype.indexOf.call(steps, here);
    return { type: type, window: windowId(), id: steps[0].id, step: step, holds: holdsOf(here),
             at: every.indexOf(here), movement: movementOf(here), here: here };
  }

  function position() {
    var m = where("slide");
    if (!m) return;
    var here = m.here;
    delete m.here;
    var at = m.id + "/" + m.step;
    var key = at + " " + JSON.stringify(m.holds);
    if (key === said) return;
    var moved = at !== saidAt;
    said = key;
    saidAt = at;
    send(m);
    if (!moved) return;                               // measured again, nothing else changed

    /* The feedback form opens when the deck reaches the step that carries
       it, and the relay keeps it open from then on. */
    if (here.hasAttribute("data-feedback")) {
      try {
        send({ type: "feedback-open", window: windowId(),
               questions: JSON.parse(here.getAttribute("data-feedback")).questions });
      } catch (e) { /* the renderer wrote it; nothing to say to the room */ }
    }
  }

  /* ---- relay -> deck */

  function address(url) { return String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); }

  /* Anything on the stage that asks for the join address gets it, by the
     `data-join` attribute rather than by a template's name, so any
     template may carry one and the library names none. */
  /* The join address, as text into anything marked `data-join` and as a
     QR code into anything marked `data-join-qr`, drawn by js/qr.js in
     `currentColor`. From the relay's tally when it has one; for a relay
     elsewhere, its own address until then, so the code is on the title
     slide before the relay has answered. An element is redrawn only when
     the address changes. */
  function join(here, url) {
    var where = address(url);
    here.querySelectorAll("[data-join]").forEach(function (el) {
      if (el.textContent !== where) el.textContent = where;
    });
    here.querySelectorAll("[data-join-qr]").forEach(function (el) {
      if (el.__join === url) return;
      el.__join = url;
      var art = "";
      if (url && window.siparioQr) {
        try { art = window.siparioQr.svg(url); } catch (e) { art = ""; }   // too long to draw
      }
      el.innerHTML = art;
    });
  }

  function onStage(t) {
    /* Looked up each time: the presenter window swaps its copy of the
       deck for a fresh one on a save, and the old one is nobody's. */
    var here = document.getElementById("deck") || deck;
    join(here, t.join || (WHERE === "local" ? "" : BASE));
    /* The room's answers, on every step that shows the poll: how many
       chose an option as `data-votes`, and its part of all the answers as
       `--share`, from 0 to 1. What those look like is the talk's sheet's
       business: a bar, a dot, a number. */
    var polls = t.polls || {};
    here.querySelectorAll(".slide[data-poll]").forEach(function (el) {
      var poll = pollOf(el);
      var c = poll && polls[poll.id];
      if (!c) return;
      el.setAttribute("data-answers", String(c.total));
      el.querySelectorAll("[data-option]").forEach(function (opt) {
        var n = c.votes[Number(opt.getAttribute("data-option"))] || 0;
        opt.setAttribute("data-votes", String(n));
        opt.style.setProperty("--share", String(c.total ? n / c.total : 0));
      });
    });
  }

  /* Reactions float over the stage only where the deck asked for that,
     with `audience-reactions: stage`; by default they are the presenter's
     alone. What arrives is a count, so what floats is the difference
     since the last one, a few at most however many came in. */
  var ON_STAGE = deck.getAttribute("data-audience-reactions") === "stage";
  var layer = null;
  var had = null;

  function float(t) {
    var now = {};
    (t.reactions || []).forEach(function (r) { now[r.kind] = r; });
    if (had && ON_STAGE) {
      if (!layer) {
        layer = document.createElement("div");
        layer.id = "reactions";
        layer.setAttribute("aria-hidden", "true");
        document.body.appendChild(layer);
      }
      Object.keys(now).forEach(function (kind) {
        var more = Math.min(4, now[kind].count - ((had[kind] && had[kind].count) || 0));
        for (var i = 0; i < more; i++) {
          var r = document.createElement("span");
          r.className = "reaction";
          r.textContent = now[kind].emoji;
          r.style.setProperty("--drift", String(Math.round(Math.random() * 80 - 40)));
          layer.appendChild(r);
          setTimeout(r.remove.bind(r), 2600);
        }
      });
    }
    had = now;
  }

  /* The room at a glance sits in the notes' header bar: how many phones
     are connected, what they react with, and the pace they ask for. The
     bar is the dock's, which the deck page builds, or the one a detached
     notes window wears, and either page paints the bar it holds, so the
     figures are the same wherever the notes are. */
  var bar = { phones: "", reactions: "", pace: "", alert: "" };
  function paintBar() {
    Object.keys(bar).forEach(function (k) {
      document.querySelectorAll("[data-room-" + k + "]").forEach(function (el) {
        el.textContent = bar[k];
      });
    });
  }
  window.__paintRoomBar = paintBar;
  function paceText(p) {
    return p.reading === null
      ? (p.n ? "pace: too few to read (" + p.n + ")" : "pace: nobody has said")
      : "pace: " + p.slower + " slower · " + p.ok + " fine · " + p.faster + " faster";
  }
  /* What needs the speaker's eye, and only then: a poll the phones are
     still showing, the feedback coming in, this deck not being the one the
     room follows, and the relay not answering. In the ordinary case, this
     window holding a room that answers with no poll open, it says nothing. */
  var last = null;
  var down = false;
  function alertText(t) {
    var parts = [];
    var open = t && t.pollOpen;
    var answers = open && open.total + (open.total === 1 ? " answer" : " answers");
    /* Off its own slide, the phones are still showing it, and the
       presenter is the one person who would not otherwise know. */
    if (open) parts.push(open.here ? "poll " + open.id + ": " + answers
                                   : "poll open: " + open.question + " · " + answers);
    else if (t && typeof t.feedback === "number") {
      parts.push("feedback: " + t.feedback + (t.feedback === 1 ? " form" : " forms") + " sent");
    }
    /* Only for notes that belong to a deck: a notes window opened by hand
       has no deck of its own to hold anything. */
    if (t && t.room && t.room !== "yours" && (!panel || ownerOf())) {
      parts.push((t.room === "other" ? "Another window holds the room." : "No window holds the room.") +
        " Press H in this deck, or go full screen, to take it.");
    }
    /* Said once while it lasts, and taken back when the stream returns. */
    if (down) parts.push("The audience relay is not answering. The talk carries on without it.");
    return parts.join(" · ");
  }
  function paintAlert() {
    bar.alert = alertText(last);
    paintBar();
    document.querySelectorAll("[data-room-alert]").forEach(function (el) { el.title = bar.alert; });
  }

  /* EventSource retries by itself, so there is nothing to do but wait. */
  function unreachable(yes) {
    if (down === !!yes) return;
    down = !!yes;
    paintAlert();
  }

  /* Taking the room: this window, where it is now, in one message, so the
     room moves to it at once. Pressing H does it, and so does going full
     screen, which is what a speaker does at the start of a talk; leaving
     full screen keeps the room, so a speaker who steps out to show
     something does not lose the phones. */
  function claim() {
    var m = where("claim");
    if (!m) return;
    delete m.here;
    said = m.id + "/" + m.step + " " + JSON.stringify(m.holds);
    saidAt = m.id + "/" + m.step;
    send(m);
  }

  /* The deck a notes window belongs to, from the address the deck opened
     it at; a notes window opened by hand belongs to none. */
  function ownerOf() {
    var q = /[?&]tab=([^&]+)/.exec(location.search);
    return q ? decodeURIComponent(q[1]) : "";
  }

  var es = null;
  function listen() {
    if (!window.EventSource) { unreachable(true); return; }
    if (es && es.close) es.close();
    es = new window.EventSource(BASE + "/stream" +
      (panel ? (ownerOf() ? "?of=" + encodeURIComponent(ownerOf()) : "")
             : "?deck=" + encodeURIComponent(windowId())));
    es.onopen = function () { unreachable(false); };
    es.onerror = function () { unreachable(true); };
    es.onmessage = function (ev) {
      var t;
      try { t = JSON.parse(ev.data); } catch (e) { return; }
      if (!t || t.type !== "tally") return;
      unreachable(false);
      /* The presenter's previews are its hidden copy of the deck, so the
         answers are written there too, and a preview of a poll shows them. */
      onStage(t);
      bar.phones = t.phones + (t.phones === 1 ? " phone" : " phones");
      bar.reactions = (t.reactions || []).map(function (r) { return r.emoji + " " + r.count; }).join("   ");
      bar.pace = paceText(t.pace || { reading: null, n: 0 });
      last = t;
      paintAlert();
      if (panel) return;
      float(t);
    };
  }

  if (WHERE !== "local") join(deck, BASE);
  if (!panel) {
    deck.addEventListener("claimroom", claim);
    document.addEventListener("fullscreenchange", function () { if (document.fullscreenElement) claim(); });
    /* A duplicated tab found out, and given an id of its own: it is a new
       window to the room, and says so. */
    deck.addEventListener("windowchange", function () { listen(); said = ""; saidAt = ""; position(); });
    send({ type: "hello", deck: deck.getAttribute("data-deck") || "", name: deck.getAttribute("data-name") || "",
           polls: pollMap() });
    position();
    deck.addEventListener("slidechange", position);
    /* Sizes measured before the talk's type or figures arrived are
       measured again once they have. */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(position);
    window.addEventListener("load", position);
  }
  listen();
})();
