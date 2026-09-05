/* The deck runtime. No dependencies, no build, runs from a file:// URL.
 *
 * Everything it knows comes from the document: slide order is document
 * order, and each slide's spoken script is the <aside class="notes"> inside
 * it. Add a <section class="slide"> and it is in the deck.
 */
(function () {
  "use strict";

  var deck = document.getElementById("deck");

  /* The talk's name, carried from its `name:` line through the page.
   * Everything this window remembers, and the channel it talks to its
   * presenter window over, hangs off it, so two decks served from one
   * origin share neither. A page that did not come from sipario has no
   * name, and every nameless deck is treated as the same one. */
  var ID = deck.getAttribute("data-deck") || "";

  /* The deck has three axes, and each has its own control.
   *
   *   groups   the talk's movements       left and right
   *   slides   the slides in a movement    down and up
   *   steps    a slide that animates       down, within the slide
   *
   * Left and right therefore move through the talk's shape rather than
   * through a run of undifferentiated slides, and the vertical arrows
   * have a real job: reading a movement top to bottom.
   *
   * `groups[g]` is an array of stacks; a stack is an array of steps, and
   * a stack is one slide.
   */
  var groups = Array.prototype.slice.call(deck.querySelectorAll(".group"))
    .map(function (gEl) {
      return Array.prototype.slice.call(gEl.querySelectorAll(".stack"))
        .map(function (st) {
          return Array.prototype.slice.call(st.querySelectorAll(".slide"));
        });
    });
  var stacks = groups.reduce(function (a, g) { return a.concat(g); }, []);
  var slides = stacks.reduce(function (a, st) { return a.concat(st); }, []);
  var bar = document.getElementById("progress-bar");

  var g = 0, s = 0, y = 0;          // group, slide in group, step in slide

  /* Where each movement was left. Going left or right returns to the
   * slide and step you were last on there, rather than to the top: coming
   * back to a movement mid-talk to answer a question should put you where
   * you were, not make you walk down to it again.
   *
   * A movement never visited has no mark and opens at its first slide.
   * `R` forgets them all, which is what you want before a rehearsal or a
   * second delivery. */
  var marks = {};

  function stack() { return groups[g][s]; }
  function at() { return stack()[y]; }
  function index() { return slides.indexOf(at()); }

  /* ---- chrome, built here so the markup stays content ---------------- */

  /* The compass says which way there is something to go, which is the
   * question a build raises and a flat deck never does. */
  var ARROWS = { up: "M12 5 L5 12 M12 5 L19 12 M12 5 V19",
                 down: "M12 19 L5 12 M12 19 L19 12 M12 19 V5",
                 left: "M5 12 L12 5 M5 12 L12 19 M5 12 H19",
                 right: "M19 12 L12 5 M19 12 L12 19 M19 12 H5" };

  var compass = document.createElement("nav");
  compass.id = "compass";
  compass.setAttribute("aria-label", "Slide navigation");
  Object.keys(ARROWS).forEach(function (dir) {
    var b = document.createElement("button");
    b.className = "cdir cdir-" + dir;
    b.type = "button";
    b.dataset.dir = dir;
    b.title = dir;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
      ARROWS[dir] + '"/></svg>';
    b.addEventListener("click", function () { go(dir); });
    compass.appendChild(b);
  });
  /* The slide's number sits in the middle of the four arrows: it is the
   * one piece of chrome that belongs with them, and the centre cell was
   * empty. It used to be printed on the slide itself, at seven pixels. */
  var cnum = document.createElement("span");
  cnum.className = "cnum";
  compass.appendChild(cnum);
  document.body.appendChild(compass);

  /* The step indicator lives at the bottom of the screen rather than in
   * the slide, so it is chrome and is built here. It shows only on a
   * slide that animates, which makes its absence the signal that a slide
   * is whole. */
  var steps = document.createElement("div");
  steps.id = "steps";
  document.body.appendChild(steps);

  function paintSteps() {
    var st = stack();
    if (st.length < 2) {
      steps.innerHTML = "";
      steps.removeAttribute("aria-label");
      return;
    }
    steps.setAttribute("aria-label", "Step " + (y + 1) + " of " + st.length);
    steps.innerHTML = st.map(function (el, k) {
      return '<span class="' + (k <= y ? "on" : "") + '"></span>';
    }).join("");
  }

  /* Resetting is not undoable, so it asks.
   * A second press confirms and anything else cancels: a browser dialog
   * would steal focus from the deck mid-talk, which is worse than the
   * thing it is guarding. */
  var ask = document.createElement("div");
  ask.id = "ask";
  document.body.appendChild(ask);
  var asking = false;

  function confirmReset() {
    if (asking) return;
    asking = true;
    ask.textContent = "Back to the start, forgetting where each movement was left?  R to confirm, any other key to cancel.";
    document.body.classList.add("asking");
  }

  /* Reset means ready to run the talk again: the bookmarks go, and so
     does where you are standing, because starting the next run-through
     from wherever the last one stopped is the half of a reset you would
     have to undo by hand anyway. */
  function forget() {
    marks = {};
    g = s = y = 0;
    show();                                   // re-marks the movement it lands in
  }

  function resolveReset(yes) {
    asking = false;
    document.body.classList.remove("asking");
    if (!yes) return;
    forget();
    ask.textContent = "Back to the start.";
    document.body.classList.add("asking", "asked");
    setTimeout(function () {
      document.body.classList.remove("asking", "asked");
    }, 1400);
  }

  var help = document.createElement("div");
  help.id = "help";
  help.innerHTML =
    "<dl>" +
    "<dt>&larr; &rarr;</dt><dd>Previous and next part of the talk</dd>" +
    "<dt>&darr; &uarr;</dt><dd>Next and previous step, then slide, within a part</dd>" +
    "<dt>Home / End</dt><dd>First and last slide</dd>" +
    "<dt>P</dt><dd>Show or hide the notes beside the deck</dd>" +
    "<dt>D</dt><dd>Move the notes to their own window, or bring them back</dd>" +
    "<dt>A</dt><dd>In that window, put them back beside the deck</dd>" +
    "<dt>O</dt><dd>Overview of every slide; the arrows move the selection</dd>" +
    "<dt>Enter</dt><dd>In the overview, show the selected slide</dd>" +
    "<dt>F</dt><dd>Full screen</dd>" +
    "<dt>C</dt><dd>Check every slide for content running off the stage</dd>" +
    "<dt>R</dt><dd>Back to the start, forgetting where each movement was left</dd>" +
    "<dt>?</dt><dd>This help</dd>" +
    "</dl><p id='watch-note'></p>";
  document.body.appendChild(help);

  /* ---- scaling
   *
   * Slides are authored at a fixed 1280x720 and scaled to fit, so a slide
   * cannot reflow between this machine and the projector. That property is
   * the only reason the old deck was given from a PDF, and it is kept here
   * without giving up live text.
   */

  function css(name) {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  }

  /* fit() owns every inline style it sets, and clears the ones the other
   * modes use. Anything half-set here is what put the slide off-centre
   * the first time: the stacks were laying themselves out underneath. */
  function clear(el) {
    el.style.left = el.style.top = el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.marginRight = el.style.marginBottom = "";
  }

  function fit() {
    var w = css("--w"), h = css("--h");
    var body = document.body;

    if (body.classList.contains("overview")) {
      /* Columns read left to right and builds read down, so the map is
       * the deck's actual shape rather than a flat grid of 48. The scale
       * lives in CSS as --ov so the outline compensation stays in step
       * with it; the negative margins collapse each scaled box back to
       * the size it actually occupies, because a transform does not. */
      var k = css("--ov");
      slides.forEach(function (el) {
        clear(el);
        el.style.transform = "scale(" + k + ")";
        el.style.marginRight = -(w * (1 - k)) + "px";
        el.style.marginBottom = -(h * (1 - k)) + 8 + "px";
      });
      return;
    }


    /* Docked notes take a slice of the width, so the deck is centred in
       what is left rather than under the panel. */
    var avail = docked() ? window.innerWidth * (1 - DOCK) : window.innerWidth;
    var scale = Math.min(avail / w, window.innerHeight / h);
    slides.forEach(function (el) {
      clear(el);
      el.style.left = docked() ? (avail / 2) + "px" : "50%";
      el.style.transformOrigin = "center center";
      el.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
    });
    place(scale, avail);
  }

  /* The compass sits by the slide's bottom-right corner, not in a corner
   * of the window: pinned to the window it straddled the letterbox edge
   * wherever that fell. It goes outside the slide, on the surround, when
   * the letterbox has room for it, and inside the corner when the screen
   * is a true 16:9 and there is nowhere else. Bottom-right is the corner
   * every template leaves empty, since the slide number lives there, and
   * the number falls in the compass's own empty cell. */
  function place(scale, avail) {
    var W = css("--w") * scale, H = css("--h") * scale;
    var right = avail / 2 + W / 2, bottom = window.innerHeight / 2 + H / 2;
    var size = compass.offsetWidth || 84, gap = 12;
    var bandX = (avail - W) / 2, bandY = (window.innerHeight - H) / 2;
    var left, top, outside = true;
    if (bandX >= size + gap) {
      left = right + (bandX - size) / 2;
      top = bottom - size;
    } else if (bandY >= size + gap) {
      left = right - size;
      top = bottom + (bandY - size) / 2;
    } else {
      left = right - size - gap;
      top = bottom - size - gap;
      outside = false;
    }
    compass.style.left = left + "px";
    compass.style.top = top + "px";
    compass.classList.toggle("outside", outside);
  }

  /* ---- navigation */

  /* Down and up are the animation control, and go on to read the rest of
   * the movement once a slide has no steps left: next step, then next
   * slide. Left and right jump between movements.
   *
   * The arrows were once taken off animations entirely in favour of
   * space. They are back, without losing the movement axis, because down
   * still reaches every slide, by way of its steps.
   */
  function can(dir) {
    if (dir === "down") return y < stack().length - 1 || s < groups[g].length - 1;
    if (dir === "up") return y > 0 || s > 0;
    if (dir === "left") return g > 0;
    if (dir === "right") return g < groups.length - 1;
    return false;
  }

  function go(dir) {
    if (!can(dir)) return;
    if (dir === "down") {
      if (y < stack().length - 1) y += 1;
      else { s += 1; y = 0; }
    } else if (dir === "up") {
      /* Going back lands on the finished slide rather than its first
         step: reversing into a half-built slide shows the room less than
         it has already seen. */
      if (y > 0) y -= 1;
      else { s -= 1; y = stack().length - 1; }
    } else if (dir === "left" || dir === "right") {
      crossTo(g + (dir === "right" ? 1 : -1), "mark");
      return;
    }
    show();
  }

  /* html carries the class too: body alone cannot scroll while the root
   * is still overflow:hidden, which is what a 43-column map needs. */
  function overview(on) {
    var want = on === undefined
      ? !document.body.classList.contains("overview")
      : !!on;
    document.body.classList.toggle("overview", want);
    document.documentElement.classList.toggle("overview", want);
    fit();
    save();
    if (want) {
      var el = at();
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "center" });
    }
  }

  /* Crossing into another movement. `mark` returns to where that movement
   * was left; `top` and `end` ignore the mark.
   *
   * Which one is right depends on why you are crossing. Left and right
   * are deliberate jumps, so they use the mark. Reading forward or back
   * must not: a bookmark ahead of you would skip everything before it,
   * silently, and the first version of this did exactly that — PageDown
   * reached eleven steps of forty-eight. */
  function crossTo(to, how) {
    if (to < 0 || to >= groups.length) return;
    g = to;
    var mark = how === "mark" && marks[g];
    if (mark && groups[g][mark.s]) {
      s = mark.s;
      y = Math.min(mark.y, groups[g][mark.s].length - 1);
    } else if (how === "end") {
      s = groups[g].length - 1;
      y = stack().length - 1;
    } else {
      s = 0;
      y = 0;
    }
    show();
  }

  function next() {
    if (can("down")) return go("down");
    crossTo(g + 1, "top");
  }

  function back() {
    if (can("up")) return go("up");
    crossTo(g - 1, "end");
  }

  function locate(el) {
    for (var i = 0; i < groups.length; i++) {
      for (var j = 0; j < groups[i].length; j++) {
        var k = groups[i][j].indexOf(el);
        if (k > -1) return { g: i, s: j, y: k };
      }
    }
    return null;
  }

  function jump(n) {
    var at = locate(slides[Math.max(0, Math.min(slides.length - 1, n))]);
    if (at) { g = at.g; s = at.s; y = at.y; }
    show();
  }

  /* Leaving the map for one slide. The map shows a build at its last
   * step, because that is the only frame that shows the whole slide, but
   * choosing it should play the build rather than drop you at its end. */
  function openSlide(el) {
    overview(false);
    var to = locate(el);
    if (to) { g = to.g; s = to.s; y = 0; show(); } else { jump(slides.indexOf(el)); }
  }

  /* Where the deck was at the last show, so the next one knows which way
   * it moved: a different movement is left or right, a different slide
   * within one is down or up, and the same slide is a step, which must
   * not move because a build's whole point is that nothing shifts. The
   * arriving slide carries the direction and the stylesheet does the
   * rest. */
  var shown = null;

  function show() {
    marks[g] = { s: s, y: y };
    var here = at();
    var from = shown;
    shown = { g: g, s: s };
    var enter = "";
    if (from && (from.g !== g || from.s !== s)) {
      enter = from.g !== g ? (g > from.g ? "right" : "left") : (s > from.s ? "down" : "up");
    }
    if (enter) here.setAttribute("data-enter", enter);
    else here.removeAttribute("data-enter");
    slides.forEach(function (el) { el.classList.toggle("current", el === here); });
    /* Progress runs over steps, so every press of space moves it. */
    bar.style.width = ((index() + 1) / slides.length * 100) + "%";
    ["up", "down", "left", "right"].forEach(function (dir) {
      compass.querySelector(".cdir-" + dir).classList.toggle("live", can(dir));
    });
    cnum.textContent = here.dataset.n;
    /* The map marks the slide you are on by its number as well as its
       outline, since the outline is easy to lose among 43 thumbnails. */
    deck.querySelectorAll(".stack.current-stack")
      .forEach(function (el) { el.classList.remove("current-stack"); });
    here.parentNode.classList.add("current-stack");
    /* The arrows move the selection around the map as well as the deck,
       and a 43-column map is wider and taller than the window, so the
       selection has to be brought along or it is chosen unseen. */
    if (document.body.classList.contains("overview") && here.scrollIntoView) {
      here.scrollIntoView({ block: "center", inline: "center" });
    }
    paintSteps();
    save();
    if (location.hash.slice(1) !== here.id) {
      history.replaceState(null, "", "#" + here.id);
    }
    fit();
    publish();
  }


  /* ---- the overflow check
   *
   * The .pptx this deck replaced was bitten twice by content running out
   * through the bottom of the slide, and both times it was found by
   * rendering every page to an image and looking. A fixed 1280x720 stage
   * makes that measurable instead: anything taller than the stage is
   * off the slide in the room, and the browser already knows by how much.
   *
   * Press C. It reports every slide, so a clean run says so rather than
   * saying nothing.
   */

  function audit() {
    var W = css("--w"), H = css("--h");
    var was = document.body.className;
    document.body.className = "";
    var bad = [];
    slides.forEach(function (el, k) {
      var prevT = el.style.transform, prevD = el.style.display;
      el.style.transform = "none";
      el.style.display = "block";
      var stage = el.querySelector(".stage");
      var pad = parseFloat(getComputedStyle(el).paddingTop)
              + parseFloat(getComputedStyle(el).paddingBottom);
      var over = Math.round(stage.scrollHeight - (H - pad));
      var wide = Math.round(stage.scrollWidth - stage.clientWidth);
      if (over > 1 || wide > 1) {
        bad.push({ n: el.dataset.n, id: el.id, over: over, wide: wide });
      }
      el.style.transform = prevT;
      el.style.display = prevD;
    });
    document.body.className = was;

    var out = document.getElementById("audit") || document.createElement("div");
    out.id = "audit";
    out.innerHTML = bad.length
      ? "<h4>" + bad.length + " of " + slides.length + " steps overflow</h4><ul>" +
        bad.map(function (b) {
          return "<li><b>" + b.n + "</b> " + b.id +
            (b.over > 1 ? " &mdash; " + b.over + "px below the fold" : "") +
            (b.wide > 1 ? " &mdash; " + b.wide + "px past the right edge" : "") +
            "</li>";
        }).join("") + "</ul><p>Press C to dismiss.</p>"
      : "<h4>All " + slides.length + " steps across " + stacks.length +
        " slides fit</h4><p>Nothing runs past " +
        W + "&times;" + H + ". Press C to dismiss.</p>";
    if (!out.parentNode) document.body.appendChild(out);
    document.body.classList.toggle("audit");
    return bad;
  }

  window.auditDeck = audit;   // so it can be run from the console too


  /* ---- state that survives a reload
   *
   * The slide is already in the URL, so a reload lands where you were
   * without help. This carries the rest: the mode you were in and what
   * the timer said, so editing a slide mid-rehearsal costs nothing.
   * sessionStorage throws in some contexts, so every touch is guarded.
   */

  var KEY = ID;

  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        g: g, s: s, y: y, marks: marks,
        overview: document.body.classList.contains("overview"),
        docked: docked(), detached: detached()
      }));
    } catch (e) { /* private window, or storage refused: nothing to say */ }
  }

  function restore() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || null; }
    catch (e) { return null; }
  }

  /* ---- the presenter window
   *
   * The script lives in a second window so the deck window can be shared
   * or mirrored on its own. They talk over a BroadcastChannel, which is
   * same-origin and needs no server round trip; that only became possible
   * when the deck started being served, because every file:// page is its
   * own origin and could never have reached the other.
   *
   * Either window can drive. The deck is the source of truth for where we
   * are, and says so whenever it moves or is asked.
   */

  var CHANNEL = ID;
  /* Read from CSS rather than repeated here: `--dock` sizes the panel and
     this scales the deck to what is left, and two copies of one number
     drift the first time either is touched. */
  var DOCK = css("--dock") / 100;
  var bus = window.BroadcastChannel ? new BroadcastChannel(CHANNEL) : null;
  var win = null;

  function publish() {
    if (bus) bus.postMessage({ from: "deck", type: "state", g: g, s: s, y: y });
  }

  /* The notes show either docked beside the deck or in a window of their
   * own, and both are the same page: the dock is an iframe on /presenter.
   * One implementation, shown two ways, so a fix to the presenter view
   * cannot reach one of them and miss the other.
   *
   * They are off until asked for. That is deliberate rather than shy: a
   * panel that opened by itself would put the script on whatever screen
   * the deck is being shared to, which is the whole reason it moved out
   * to a window in the first place. */
  var dock = null;

  function docked() { return document.body.classList.contains("docked"); }
  function detached() { return !!(win && !win.closed); }
  window.__detached = detached;      // the suite asserts the two states never overlap

  function makeDock() {
    if (dock) return;
    dock = document.createElement("aside");
    dock.id = "dock";
    dock.innerHTML =
      '<div id="dock-bar">' +
      '<span>Notes</span>' +
      '<button type="button" id="dock-detach" title="Open in its own window (D)">detach</button>' +
      '<button type="button" id="dock-close" title="Hide the notes (P)">close</button>' +
      '</div><iframe id="dock-frame" src="/presenter" title="Presenter notes"></iframe>';
    document.body.appendChild(dock);
    document.getElementById("dock-detach").addEventListener("click", function () { setNotes("detached"); });
    document.getElementById("dock-close").addEventListener("click", function () { setNotes("hidden"); });
  }

  /* The notes are in one of three states and never two, which is enforced
   * here rather than by each control remembering to undo the other. They
   * were separate flags first, and pressing P after detaching docked a
   * second copy beside the deck: the script back on the shared screen,
   * which is the one thing this is all arranged to prevent.
   *
   *   hidden     nothing showing
   *   docked     an iframe on /presenter, beside the deck
   *   detached   the same page in a window of its own
   */
  function setNotes(mode) {
    if (mode !== "detached" && detached()) {
      win.close();
      win = null;
    }

    if (mode === "detached" && !detached()) {
      win = window.open("/presenter", CHANNEL,
        "width=980,height=760,menubar=no,toolbar=no,location=no");
      if (!win) {
        /* Popup blocked. Dock them instead of silently doing nothing, and
           say why, so the notes are never simply lost. */
        var el = document.getElementById("watch-note");
        if (el) el.textContent = "The window was blocked. Allow popups, or keep the notes docked.";
        document.body.classList.add("help");
        mode = "docked";
      }
    }

    if (mode === "docked") makeDock();
    document.body.classList.toggle("docked", mode === "docked");
    fit();
    save();
    if (mode === "detached") publish();     // the window asks, but say it anyway
  }

  function notesShowing() { return docked() || detached(); }

  /* P shows the notes, or hides whichever way they are showing. */
  function toggleNotes() { setNotes(notesShowing() ? "hidden" : "docked"); }

  /* D moves them between beside the deck and a window of their own. */
  function toggleDetached() { setNotes(detached() ? "docked" : "detached"); }

  if (bus) {
    bus.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.from !== "presenter") return;
      if (m.type === "hello") { publish(); return; }
      if (m.type === "attach") { setNotes("docked"); return; }
      /* The notes ask before sending this, in their own window, so it
         arrives already confirmed. It forgets silently: the deck window
         is the one on the projector, and a reset between run-throughs is
         not news the room needs. */
      if (m.type === "reset") { forget(); return; }
      if (m.type === "go") { go(m.dir); return; }
      if (m.type === "next") { next(); return; }
      if (m.type === "back") { back(); return; }
      if (m.type === "jump" && groups[m.g] && groups[m.g][m.s] && groups[m.g][m.s][m.y]) {
        g = m.g; s = m.s; y = m.y; show();
      }
    };
  }

  /* ---- reload when deck.md changes
   *
   * The server holds a Server-Sent Events stream open and pushes a token
   * whenever deck.md, the stylesheet, the script or an asset changes.
   * One-way is all this needs, and EventSource reconnects by itself, so
   * restarting the server reloads the page rather than stranding it.
   *
   * The polling this replaced could not work at all from a file:// URL,
   * where the browser treats every local file as its own origin and
   * refuses to let the page read itself. The deck is served now, so the
   * question no longer arises.
   */

  var watching = "starting", token = null;

  function watchNote() {
    var el = document.getElementById("watch-note");
    if (!el) return;
    el.textContent = watching === "watching"
      ? "Reloads itself when deck.md changes, keeping your place."
      : watching === "blocked"
        ? "Live reload is not connected. Is the server still running?"
        : "Live reload: connecting.";
  }

  if (window.EventSource) {
    var stream = new EventSource("/reload");
    stream.onmessage = function (ev) {
      watching = "watching";
      watchNote();
      if (token === null) { token = ev.data; return; }
      if (ev.data === token) return;
      token = ev.data;
      /* Never yank the deck out from under a talk. */
      if (document.fullscreenElement) return;
      save();
      location.reload();
    };
    stream.onerror = function () { watching = "blocked"; watchNote(); };
  } else {
    watching = "blocked";
  }

  window.addEventListener("beforeunload", save);

  /* ---- keys */

  document.addEventListener("keydown", function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key;

    if (asking) {
      resolveReset(k === "r" || k === "R");
      ev.preventDefault();
      return;
    }
    /* Space is deliberately unbound: the arrows are the
       navigation, and a key that quietly did the same thing was a second
       answer to a question that should have one. PageDown and `n` remain,
       being what a clicker sends. */
    if (k === "PageDown" || k === "n") next();
    else if (k === "PageUp" || k === "Backspace") back();
    else if (k === "ArrowRight") go("right");
    else if (k === "ArrowLeft") go("left");
    else if (k === "ArrowDown") go("down");
    else if (k === "ArrowUp") go("up");
    else if (k === "Home") jump(0);
    else if (k === "End") jump(slides.length - 1);
    else if (k === "p" || k === "P") toggleNotes();
    else if (k === "d" || k === "D") toggleDetached();
    else if (k === "c" || k === "C") audit();
    else if (k === "r" || k === "R") confirmReset();
    else if (k === "o" || k === "O") { overview(); }
    else if (k === "Enter") {
      if (!document.body.classList.contains("overview")) return;
      openSlide(at());
    }
    else if (k === "f" || k === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
    else if (k === "?") document.body.classList.toggle("help");
    else if (k === "Escape") { document.body.classList.remove("help", "audit"); overview(false); }
    else return;
    ev.preventDefault();
  });

  deck.addEventListener("click", function (ev) {
    if (!document.body.classList.contains("overview")) return;
    var el = ev.target.closest(".slide");
    if (!el) return;
    openSlide(el);
  });

  window.addEventListener("resize", fit);

  var saved = restore();
  if (saved) {
    if (saved.marks && typeof saved.marks === "object") marks = saved.marks;
    if (saved.docked) setNotes("docked");
    if (saved.overview) {
      document.body.classList.add("overview");
      document.documentElement.classList.add("overview");
    }
  }

  /* The hash is explicit and wins; the saved position is the fallback. */
  var start = slides.findIndex(function (el) { return el.id === location.hash.slice(1); });
  if (start > -1) {
    jump(start);
  } else if (saved && groups[saved.g] && groups[saved.g][saved.s] &&
             groups[saved.g][saved.s][saved.y]) {
    g = saved.g; s = saved.s; y = saved.y; show();
  } else {
    jump(0);
  }

  watchNote();
})();
