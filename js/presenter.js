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

  /* The same three axes the deck uses: groups across, slides down, steps
     inside a slide. This window mirrors the deck's position rather than
     keeping one of its own. */
  var groups = Array.prototype.slice.call(document.querySelectorAll("#deck .group"))
    .map(function (gEl) {
      return Array.prototype.slice.call(gEl.querySelectorAll(".stack"))
        .map(function (st) { return Array.prototype.slice.call(st.querySelectorAll(".slide")); });
    });
  var stacks = groups.reduce(function (a, gr) { return a.concat(gr); }, []);
  var slides = stacks.reduce(function (a, st) { return a.concat(st); }, []);

  var g = 0, s = 0, y = 0;

  var elNow = document.getElementById("now");
  var elNext = document.getElementById("next");
  var elNotes = document.getElementById("notes");
  var elWhere = document.getElementById("where");
  var elDots = document.getElementById("dots");
  var elClock = document.getElementById("clock");

  function heading(el) {
    /* A heading, or whatever a template marked as one. Naming templates
       here would put a talk's design in the shared runtime, and the next
       talk's headings would be the ones this list happens to know. */
    var h = el && el.querySelector("h1, h2, [data-heading]");
    return h ? h.textContent.trim() : (el ? el.id : "");
  }

  /* The preview is the real slide, cloned and scaled, so it cannot show
     something the room is not seeing. */
  function preview(box, el) {
    box.innerHTML = "";
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
    var group = here.closest(".group");
    document.getElementById("group").textContent = group
      ? group.dataset.section + "  " + group.dataset.group : "";
    /* A slide's number already says which movement it is in, so the total
       would only repeat what the group line above says. */
    elWhere.textContent = "Slide " + here.dataset.n +
      (st.length > 1 ? "  ·  step " + (y + 1) + " of " + st.length : "");

    elDots.innerHTML = st.length < 2 ? "" : st.map(function (s, k) {
      return '<span class="' + (k <= y ? "on" : "") + '"></span>';
    }).join("");

    preview(elNow, here);
    preview(elNext, slides[flat + 1]);
    document.getElementById("next-label").textContent =
      slides[flat + 1] ? heading(slides[flat + 1]) : "End of the talk";
  }

  // ------------------------------------------------------------- the bus

  function send(msg) {
    msg.from = "presenter";
    if (bus) bus.postMessage(msg);
  }

  if (bus) {
    bus.onmessage = function (ev) {
      /* A window that has gone away can still be holding this channel:
         `beforeunload` does not always run, and a torn-down document has
         no body to paint into. Stand down rather than throwing into a
         page nobody is looking at. */
      if (!document || !document.body) { bus.close(); return; }
      var m = ev.data || {};
      if (m.from !== "deck" || m.type !== "state") return;
      g = m.g; s = m.s; y = m.y;
      document.body.classList.remove("orphan");
      paint();
    };
    send({ type: "hello" });
    /* If the deck window is gone, say so rather than showing a script for
       a slide nobody is looking at. */
    setTimeout(function () {
      if (!document.body.classList.contains("live")) document.body.classList.add("orphan");
    }, 1200);
    bus.onmessageerror = function () { document.body.classList.add("orphan"); };
  } else {
    document.body.classList.add("orphan");
  }

  var wasPainted = false;
  var origPaint = paint;
  paint = function () { wasPainted = true; document.body.classList.add("live"); origPaint(); };

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
  var inFrame = window.parent !== window;
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
    else if (k === "ArrowUp") send({ type: "go", dir: "up" });
    else if (k === "t" || k === "T") timer();
    else if (k === "a" || k === "A") attach();
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
