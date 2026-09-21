'use strict';

/* The presenter window.
 *
 * It holds the whole deck in its own DOM, hidden, and reads the current
 * slide out of it: the script, the next slide's heading, a preview of
 * what the room is seeing. Nothing about a slide is duplicated into a
 * second format, so the notes cannot drift from the deck.
 *
 * The deck window is the source of truth for position; this window can
 * drive it, and does so by asking rather than by assuming.
 */
(function () {
  "use strict";

  /* The same name the deck window reads, off the same attribute, so the
     two ends of the channel cannot be named apart. */
  var CHANNEL = document.getElementById("deck").getAttribute("data-deck") || "";
  var bus = window.BroadcastChannel ? new BroadcastChannel(CHANNEL) : null;

  /* Which deck window this panel belongs to, handed over in the URL by the
     window that opened it. The channel is named for the talk, so two
     windows of the same talk share it; without this a panel took its
     position from whichever deck spoke last and showed the script for a
     slide its own deck was not on. A panel opened by hand has no owner and
     listens to every deck, which is the only useful thing it can do. */
  /* Docked, this page is the dock's iframe; in a window of its own it is
     not. Decided here, before the first hello goes out: it used to be
     decided further down, after the hello, so the dock's first word was
     that it was a window, and a deck with popups allowed opened a blank
     one by name and hid the dock. */
  var inFrame = window.parent !== window;

  var OWNER = (function () {
    var m = /[?&]tab=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  /* The same three axes the deck uses: groups across, slides down, steps
     inside a slide. This window mirrors the deck's position rather than
     keeping one of its own. */
  var groups = [], stacks = [], slides = [];

  var g = 0, s = 0, y = 0;

  var elNow = document.getElementById("now");
  var elNext = document.getElementById("next");
  var elNotes = document.getElementById("notes");
  var elClock = document.getElementById("clock");

  /* The map again, at the top of the side column: the deck's own minimap
     is on the screen behind the presenter, and turning round to find
     your place is the one thing a notes panel exists to spare you. The
     same shape as the deck's, built from the same groups, so the two
     cannot disagree. M, on either window, shows or hides both. */
  var elMap = document.createElement("nav");
  elMap.id = "notes-map";
  elMap.setAttribute("aria-label", "Where this slide is in the talk");
  var side = document.getElementById("side");
  side.insertBefore(elMap, side.firstChild);

  /* Read the deck's shape off the hidden copy of it, and draw the map
     from the same reading. Called once now and again whenever that copy
     is replaced, so the two never describe different decks. */
  function index() {
    groups = Array.prototype.slice.call(document.querySelectorAll("#deck .group"))
      .map(function (gEl) {
        return Array.prototype.slice.call(gEl.querySelectorAll(".stack"))
          .map(function (st) { return Array.prototype.slice.call(st.querySelectorAll(".slide")); });
      });
    stacks = groups.reduce(function (a, gr) { return a.concat(gr); }, []);
    slides = stacks.reduce(function (a, st) { return a.concat(st); }, []);

    elMap.innerHTML = "";
    groups.forEach(function (col, gi) {
      var c = document.createElement("div");
      c.className = "mm-col";
      col.forEach(function (st, si) {
        var cell = document.createElement("span");
        cell.className = "mm-cell" + (st.length > 1 ? " build" : "");
        cell.dataset.g = gi;
        cell.dataset.s = si;
        c.appendChild(cell);
      });
      elMap.appendChild(c);
    });
  }
  index();

  /* A save reloads the deck window, and a docked panel with it, being an
     iframe of that window. A detached window is nobody's child: it kept
     the copy of the deck it loaded with and went on reading a script that
     was no longer the one in the file, while every move still landed on
     the right number. So it listens for the same change the deck does,
     fetches its own page again, and swaps in the fresh copy of the deck
     without reloading: the clock keeps running, the window stays where it
     was, and the deck is asked for its position again in case the numbers
     moved under it. */
  function refresh(html, ok) {
    if (ok === false) { fault(html); return false; }
    var doc = new DOMParser().parseFromString(html, "text/html");
    var fresh = doc.getElementById("deck");
    var old = document.getElementById("deck");
    if (!fresh || !old) { fault(html); return false; }
    old.parentNode.replaceChild(document.importNode(fresh, true), old);
    sheets(doc);
    adopt(fresh.getAttribute("data-deck") || "");
    clearFault();
    index();
    if (!groups[g]) g = groups.length - 1;
    if (!groups[g][s]) s = groups[g].length - 1;
    if (!groups[g][s][y]) y = groups[g][s].length - 1;
    paint();
    hello();
    return true;
  }
  window.__refresh = refresh;          // the suite hands it a rendered page

  /* ---- a rename
     The channel is named for the deck, so a deck renamed in its head
     comes back on a channel this window was not on: every move went
     unheard in both directions. The fresh page names the new channel.
     Moving there at once was wrong too: a deck in fullscreen holds the
     save back and is still driving on the old channel. So the new one is
     opened beside the old as a probe, and this window moves to it only
     when a deck there confirms the staged version. The pairing holds
     across the move, because the tab id is the tab's, not the deck's. */
  var probe = null, probeKey = null;

  function probeFor(key) {
    if (!key || key === CHANNEL || key === probeKey) return;
    if (probe) probe.close();
    probeKey = key;
    probe = window.BroadcastChannel ? new BroadcastChannel(key) : null;
    if (probe) { listen(probe, true); hello(probe); }
  }
  function promote() {
    if (!probe) return;
    if (bus) bus.close();
    bus = probe; CHANNEL = probeKey;
    probe = null; probeKey = null;
    listen(bus, false);
  }
  /* The page now on screen names its deck; be on that channel. */
  function adopt(key) {
    if (!key || key === CHANNEL) return;
    if (key === probeKey) { promote(); return; }
    if (bus) bus.close();
    CHANNEL = key;
    bus = window.BroadcastChannel ? new BroadcastChannel(CHANNEL) : null;
    listen(bus, false);
  }

  /* ---- keeping step with the deck, not with the file
     The stream says the file changed; the deck says which version it is
     showing, with every position. A deck in fullscreen holds a save back,
     and the notes that ran ahead of it read the script of a slide the
     room could not see. So a fresh page is fetched on the stream's word
     and staged, and applied only when the deck reports that version. A
     deck that reports a version this window has never fetched is fetched
     for. */
  /* The version is read off the page that was rendered, never assumed
     from what the deck says first: notes opened after a save the deck is
     holding back would otherwise take the file's latest for the room's
     version, and show a slide the room could not see. */
  var have = document.getElementById("deck").getAttribute("data-version") || null;
  var deckV = null;     // the version the deck last reported
  var staged = null;    // { token, html } fetched and waiting for the deck

  function apply(page) {
    if (refresh(page.html, true)) have = page.token;
    staged = null;
  }
  function stage(token, html, ok) {
    if (ok === false) { fault(html); return; }
    var doc = new DOMParser().parseFromString(html, "text/html");
    var fresh = doc.getElementById("deck");
    var v = (fresh && fresh.getAttribute("data-version")) || token;
    staged = { token: v, html: html };
    /* A page that names another deck is a rename: the deck that will
       confirm this version speaks on the new channel. Listen there too;
       the old channel stays, because a deck in fullscreen is still on it. */
    var key = fresh && fresh.getAttribute("data-deck");
    if (key && key !== CHANNEL) probeFor(key);
    if (deckV === v) apply(staged);
  }
  window.__stage = stage;              // the suite stands in for the stream and the fetch

  /* Asked for by version, so a deck holding a save back gets the notes
     of the version it is showing, if the server still has it. */
  function fetchPage(token) {
    if (!window.fetch) return;
    var url = location.pathname + location.search + (location.search ? "&" : "?") + "v=" + encodeURIComponent(token);
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.text().then(function (t) { stage(token, t, r.ok); }); })
      .catch(function (err) { fault("Could not fetch the deck: " + err.message); });
  }

  /* `confirming` is the probe channel when the report came over it. */
  function version(v, confirming) {
    if (typeof v !== "string") return false;
    deckV = v;
    if (staged && staged.token === v) {
      if (confirming) promote();
      apply(staged);
      return true;
    }
    if (confirming) return false;       // the new deck is not on the staged version yet
    if (have === null) { have = v; return true; }
    if (v === have) return true;
    fetchPage(v);
    return true;
  }

  /* A save that does not render comes back as the error, not a page.
     Reloading into it used to strand the window on a page with no
     listener, so the next save, the one that fixed it, never reached it.
     The error is shown here instead and the stream stays connected. */
  function fault(text) {
    var el = document.getElementById("fault");
    el.textContent = "The deck does not render. The notes are the last good copy.\n\n" +
      String(text).replace(/<[^>]*>/g, "").trim();
    document.body.classList.add("fault");
  }
  function clearFault() { document.body.classList.remove("fault"); }

  /* The stylesheets come with the deck: a dress edited mid-rehearsal, or
     a template added with a sheet of its own, would otherwise leave the
     previews in the old look while the deck wore the new one. A sheet the
     fresh page still carries is fetched again under a new query; one it
     has gained is added; one it has dropped goes. */
  function sheets(doc) {
    var base = function (href) { return href.split("?")[0]; };
    var stamp = String(Date.now());
    var have = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    var want = Array.prototype.slice.call(doc.querySelectorAll('link[rel="stylesheet"]'))
      .map(function (l) { return base(l.getAttribute("href")); });
    /* Each sheet is appended in the fresh page's order, a kept one moved
       and an added one made, so the cascade is the deck's: two sheets of
       equal specificity resolve by order, and an added sheet appended
       after the rest gave the previews a different answer from the deck. */
    want.forEach(function (href) {
      var old = have.filter(function (l) { return base(l.getAttribute("href")) === href; })[0];
      var l = old || document.createElement("link");
      l.rel = "stylesheet";
      l.setAttribute("href", href + "?v=" + stamp);
      document.head.appendChild(l);
    });
    have.forEach(function (l) {
      if (want.indexOf(base(l.getAttribute("href"))) === -1) l.remove();
    });
  }

  /* The preview is the real slide, cloned and scaled, so it cannot show
     something the room is not seeing. */
  function preview(box, el) {
    box.innerHTML = "";
    /* A hidden shelf has no width to scale against, and measuring one
       gave a scale of 0 that stayed after it was shown again. */
    if (box.parentNode.classList.contains("hidden")) return;
    if (!el) { box.classList.add("empty"); return; }
    box.classList.remove("empty");
    var clone = el.cloneNode(true);
    var notes = clone.querySelector(".notes");
    if (notes) notes.remove();
    clone.classList.add("shot");
    clone.classList.remove("current");
    box.appendChild(clone);
    var k = box.clientWidth / 1280;
    clone.style.transform = "scale(" + k + ")";
    box.style.height = Math.round(720 * k) + "px";
  }

  function paint() {
    var st = (groups[g] && groups[g][s]) || groups[0][0];
    var here = st[y] || st[0];
    var flat = slides.indexOf(here);

    elNotes.innerHTML = here.querySelector(".notes").innerHTML;

    elMap.querySelectorAll(".mm-cell.on").forEach(function (el) { el.classList.remove("on"); });
    var cell = elMap.querySelector('.mm-cell[data-g="' + g + '"][data-s="' + s + '"]');
    if (cell) cell.classList.add("on");

    /* Where the deck is used to be spelled out here as a movement, a
       slide number and a dot per step. It is gone: the deck's own
       compass and minimap carry the position, on the screen the
       presenter is looking at anyway, and this panel is for the words. */
    preview(elNow, here);
    /* The preview is the whole of what the next slide is. Its heading
       used to be printed under it as well, which said the same thing
       twice in a panel whose other half is the words to be read. The end
       of the talk says itself: the box is empty. */
    preview(elNext, slides[flat + 1]);
  }

  // ------------------------------------------------------------- the bus

  function send(msg, on) {
    msg.from = "presenter";
    /* Addressed, so the deck that owns this panel answers and the others
       leave it alone. */
    if (OWNER) msg.tab = OWNER;
    var ch = on || bus;
    if (ch) ch.postMessage(msg);
  }
  /* A window of its own says so, so a reloaded deck can take it back on
     the hello when its roll-call went unanswered. The dock's frame is
     not a window and claims nothing. */
  function hello(on) { send({ type: "hello", detached: !inFrame && !!OWNER }, on); }

  /* A deck has spoken, and only that makes this window live.
     It used to be the paint that said so, and this page paints itself
     once on load because the script it was rendered with is already in
     it. So a window opened with no deck behind it — a bookmarked
     /presenter, a deck since closed — marked itself live before any
     deck had answered, and the check below, which shows the warning when
     nothing is live after a moment, could never fire. It sat there
     showing the first slide's script as though it were following a
     talk. */
  function connected() {
    document.body.classList.add("live");
    document.body.classList.remove("orphan");
  }

  function listen(ch, probing) {
    if (!ch) return;
    ch.onmessage = function (ev) {
      /* A window that has gone away can still be holding this channel:
         `beforeunload` does not always run, and a torn-down document has
         no body to paint into. Stand down rather than throwing into a
         page nobody is looking at. */
      if (!document || !document.body) { ch.close(); return; }
      var m = ev.data || {};
      if (m.from !== "deck") return;
      /* Another window of the same talk. Not ours to follow. */
      if (OWNER && m.tab && m.tab !== OWNER) return;
      /* A probe answers only the state that confirms the staged version;
         everything else still comes from the deck on the old channel. */
      if (probing) { if (m.type === "state" && version(m.v, true)) { g = m.g; s = m.s; y = m.y; connected(); paint(); } return; }
      if (m.type === "panel") { panelKey(m.key); return; }
      /* A deck window that reloaded asks whether its detached window is
         still open; a window of our own, not the dock's frame, answers.
         A panel opened by hand has no owner and claims nothing: a claim
         makes the deck open a window by name, and a name nobody holds
         opens a blank one. */
      if (m.type === "roll-call") { if (!inFrame && OWNER) send({ type: "here" }); return; }
      if (m.type !== "state") return;
      version(m.v, false);
      g = m.g; s = m.s; y = m.y;
      /* The deck says whether the map is showing; M on either window
         asks the deck, so both maps answer to one setting. */
      if (typeof m.map === "boolean") elMap.classList.toggle("hidden", !m.map);
      connected();
      paint();
    };
    ch.onmessageerror = function () { if (!probing) document.body.classList.add("orphan"); };
  }
  listen(bus, false);
  hello();
  /* If the deck window is gone, say so rather than showing a script for
     a slide nobody is looking at. */
  setTimeout(function () {
    if (!document.body.classList.contains("live")) document.body.classList.add("orphan");
  }, 1200);
  if (!bus) document.body.classList.add("orphan");

  if (window.EventSource && window.fetch) {
    var token = null;
    var stream = new EventSource("/reload");
    stream.onmessage = function (ev) {
      if (token === null) { token = ev.data; return; }
      if (ev.data === token) return;
      token = ev.data;
      fetchPage(token);
    };
  }

  var wasPainted = false;
  var origPaint = paint;
  paint = function () { wasPainted = true; origPaint(); };

  // ------------------------------------------------------------- timer

  /* Three states, and `paused` is held rather than inferred from the
     clock: a pause on the same millisecond as the start reads as zero
     elapsed, and inferring from that put the button back to `start` when
     it should have offered `reset`. */
  var t0 = null, held = 0, tick = null, paused = false;

  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function tickTock() { elClock.textContent = fmt(held + (t0 ? Date.now() - t0 : 0)); }

  /* Reset means "ready for another run-through", so it takes the deck
   * with the clock: back to the first slide, bookmarks forgotten.
   * Starting again at 00:00 from wherever the last run stopped, with
   * every movement still opening where it was left, is half a reset.
   *
   * It asks first, because forgetting is not undoable, and it asks
   * *here* rather than on the deck. The deck's own R draws its question
   * across the slide, which is fine when the deck is the only window and
   * wrong once it is the thing on the projector. */
  var elNote = document.getElementById("timer-note");
  var asking = false;

  function say(text) {
    elNote.textContent = text;
    elNote.classList.toggle("asking", asking);
  }

  function resolveReset(yes) {
    asking = false;
    if (!yes) { say(""); return; }
    held = 0;
    paused = false;
    elClock.classList.remove("running");
    tickTock();
    send({ type: "reset" });
    say("Reset. Back at the first slide.");
    setTimeout(function () { if (!asking) say(""); }, 1800);
  }

  function timer() {
    if (asking) return resolveReset(true);   // a second press is the confirmation
    if (t0) {                              // running -> pause
      held += Date.now() - t0;
      t0 = null;
      paused = true;
      clearInterval(tick);
      elClock.classList.remove("running");
    } else if (paused) {                   // paused -> reset, once confirmed
      asking = true;
      say("Reset the clock, return to the first slide and forget where each movement was left? Press again to confirm.");
      return;
    } else {                               // stopped -> start
      say("");
      paused = false;
      t0 = Date.now();
      tick = setInterval(tickTock, 500);
      elClock.classList.add("running");
    }
    tickTock();
  }

  document.getElementById("timer-btn").addEventListener("click", timer);

  /* ---- going back to the deck
   *
   * The mirror of the dock's detach button. It only means anything in a
   * window of its own: inside the dock's iframe the notes are already
   * beside the deck, and the control there is `detach`.
   */
  if (inFrame) document.getElementById("attach-row").style.display = "none";

  function attach() {
    if (inFrame) return;
    send({ type: "attach" });
    window.close();
    /* A window the deck did not open cannot be closed by script, so say
       so rather than leaving the notes showing in two places. */
    setTimeout(function () {
      document.getElementById("attach-note").textContent =
        "Docked. You can close this window.";
    }, 250);
  }

  document.getElementById("attach-btn").addEventListener("click", attach);

  /* ---- putting a preview away
   *
   * What this panel is for is the script; the two previews are there to
   * be glanced at, and which of them earns its space changes between a
   * rehearsal and a room. The slide on screen is usually behind you on a
   * larger screen than this one, and a talk you know does not need to be
   * told what is coming. So either can be put away, and the rail gives
   * the space back to the words.
   *
   * The label stays whatever is hidden: a control that removes itself
   * leaves the way back nowhere to be found. The choice is kept per deck
   * because it is a habit, not a setting, and one deck's habit should not
   * arrive with another.
   */
  /* The deck's own key, with a suffix, the way the deck stores its
     minimap preference. The name is never spelled here: two talks on one
     origin would share whatever a constant said. */
  var SHELF_KEY = CHANNEL + ":shelves";

  function shelf(name) {
    return {
      box: document.getElementById(name + "-shelf"),
      btn: document.getElementById(name + "-btn"),
    };
  }

  var shelves = { now: shelf("now"), next: shelf("next") };
  var WHAT = {
    now: "the slide the room is seeing (1)",
    next: "what is coming next (2)",
  };

  function shelvesHidden() {
    try {
      return JSON.parse(localStorage.getItem(SHELF_KEY) || "{}") || {};
    } catch (e) {
      /* Private windows and cleared site data both throw here. A
         forgotten preference is not worth a broken panel. */
      return {};
    }
  }

  function showShelves(state) {
    var all = true;
    Object.keys(shelves).forEach(function (name) {
      var s = shelves[name];
      if (!s.box) return;
      s.box.classList.toggle("hidden", !!state[name]);
      if (s.btn) {
        s.btn.setAttribute("aria-expanded", state[name] ? "false" : "true");
        /* The icon says which state it is in; the title says what the
           press will do, and those are opposites. */
        s.btn.title = (state[name] ? "Show " : "Hide ") + WHAT[name];
      }
      if (!state[name]) all = false;
    });
    var wrap = document.getElementById("wrap");
    if (wrap) wrap.classList.toggle("bare", all);
  }

  function toggleShelf(name) {
    var state = shelvesHidden();
    state[name] = !state[name];
    try { localStorage.setItem(SHELF_KEY, JSON.stringify(state)); } catch (e) { /* see above */ }
    showShelves(state);
    /* Showing one again hands it a box with a width, so it has to be
       drawn rather than waited for: nothing moves the deck between a
       click here and the next slide. */
    if (wasPainted) paint();
  }

  Object.keys(shelves).forEach(function (name) {
    var btn = shelves[name].btn;
    if (btn) btn.addEventListener("click", function () { toggleShelf(name); });
  });

  showShelves(shelvesHidden());

  /* ---- the size of the script
   *
   * A lectern is further from the eyes than a desk, and how much further
   * is a property of the room rather than of the talk. So the size is
   * set here rather than guessed at in the stylesheet, in steps a person
   * can walk through while looking at it, and it is remembered per deck
   * the way the previews are.
   *
   * Steps rather than a free number: this is adjusted with two keys in a
   * room with the lights down, and every stop has to be a size worth
   * stopping at.
   */
  var SIZES = [15, 17, 19, 22, 26, 30, 35];
  var DEFAULT_SIZE = SIZES.indexOf(19);
  var SIZE_KEY = CHANNEL + ":script";
  var elScript = document.getElementById("script");
  var elSmaller = document.getElementById("smaller-btn");
  var elBigger = document.getElementById("bigger-btn");

  function sizeStep() {
    var n;
    try { n = parseInt(localStorage.getItem(SIZE_KEY), 10); } catch (e) { n = NaN; }
    if (isNaN(n) || n < 0 || n >= SIZES.length) return DEFAULT_SIZE;
    return n;
  }

  function showSize(n) {
    if (elScript) elScript.style.setProperty("--script", SIZES[n] + "px");
    /* The end of the range is said by the control rather than by a press
       that does nothing: a button that still looks live is how a person
       decides the feature is broken. */
    if (elSmaller) elSmaller.disabled = n === 0;
    if (elBigger) elBigger.disabled = n === SIZES.length - 1;
  }

  function resize(by) {
    var n = Math.min(SIZES.length - 1, Math.max(0, sizeStep() + by));
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch (e) { /* private mode */ }
    showSize(n);
  }

  if (elSmaller) elSmaller.addEventListener("click", function () { resize(-1); });
  if (elBigger) elBigger.addEventListener("click", function () { resize(1); });

  showSize(sizeStep());

  /* The keys that belong to this panel, wherever they were pressed. The
     deck forwards them, because docked the notes are an iframe and the
     hands are on the deck window. */
  function panelKey(k) {
    if (k === "1") toggleShelf("now");
    else if (k === "2") toggleShelf("next");
    else if (k === "+" || k === "=") resize(1);
    else if (k === "-" || k === "_") resize(-1);
    else return false;
    return true;
  }

  // -------------------------------------------------------------- keys

  document.addEventListener("keydown", function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key;
    /* Space is unbound here too, so the two windows answer to the same
       keys and neither surprises the other. */
    if (asking) { resolveReset(k === "t" || k === "T" || k === "Enter"); ev.preventDefault(); return; }
    if (k === "PageDown" || k === "n") send({ type: "next" });
    else if (k === "PageUp" || k === "Backspace") send({ type: "back" });
    else if (k === "ArrowRight") send({ type: "go", dir: "right" });
    else if (k === "ArrowLeft") send({ type: "go", dir: "left" });
    else if (k === "ArrowDown") send({ type: "go", dir: "down" });
    else if (k === "ArrowUp" && ev.shiftKey) send({ type: "top" });
    else if (k === "ArrowUp") send({ type: "go", dir: "up" });
    else if (k === "t" || k === "T") timer();
    else if (k === "m" || k === "M") send({ type: "map" });
    else if (k === "a" || k === "A") attach();
    else if (panelKey(k)) { /* handled */ }
    else return;
    ev.preventDefault();
  });

  window.addEventListener("resize", paint);
  /* Both, because `beforeunload` is skipped when a page is put into the
     back/forward cache and `pagehide` is the one that always fires. */
  window.addEventListener("beforeunload", function () { if (bus) bus.close(); });
  window.addEventListener("pagehide", function () { if (bus) bus.close(); });

  paint();
})();
