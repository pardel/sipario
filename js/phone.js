/* What a phone in the room runs. No dependencies, no build, no framework:
 * one page that follows the stage stream and posts what its holder
 * presses.
 *
 * The phone follows the slide. What it shows is whatever the relay says
 * is on the stage, so a phone opened mid-talk lands where the talk is,
 * and the person holding it never has to find their place.
 *
 * It is anonymous. A random token, made here and kept in this phone's
 * storage, is what lets it count once; nothing else about the phone is
 * sent, and a phone that refuses storage gets a token for this page load
 * alone and loses nothing but its memory across a reload.
 */
(function () {
  "use strict";

  var main = document.getElementById("phone");
  var status = document.getElementById("status");

  function token() {
    var bytes = new Uint8Array(12);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var made = "";
    bytes.forEach(function (b) { made += ("0" + b.toString(16)).slice(-2); });
    try {
      var kept = localStorage.getItem("sipario-token");
      if (kept) return kept;
      localStorage.setItem("sipario-token", made);
    } catch (e) { /* storage refused: a token for this page load */ }
    return made;
  }
  var TOKEN = token();

  function send(msg) {
    msg.token = TOKEN;
    return window.fetch("/phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return { ok: false, error: "offline" }; });
  }
  window.__send = send;              // the suite reads what was sent

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* A word under whatever was pressed, and gone again: "sent", or the
     relay's own reason when it said no. */
  function said(where, text) {
    where.textContent = text;
    clearTimeout(where.timer);
    where.timer = setTimeout(function () { where.textContent = ""; }, 1800);
  }

  function button(cls, text, label, onPress) {
    var b = el("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onPress);
    return b;
  }

  /* ---- reactions and pace, which is what shows between polls */

  var PACE = [[-1, "Slower"], [0, "Just right"], [1, "Faster"]];
  var paced = null;

  function reactions(stage) {
    var box = el("section", "react");
    box.appendChild(el("h2", "", "React"));
    var row = el("div", "reactions");
    var note = el("p", "said");
    (stage.reactions || []).forEach(function (r) {
      row.appendChild(button("reaction", r.emoji, r.kind, function () {
        send({ type: "react", kind: r.kind }).then(function (res) {
          said(note, res.ok ? "Sent" : res.error === "one moment" ? "One moment…" : "Not sent");
        });
      }));
    });
    box.appendChild(row);
    box.appendChild(note);

    box.appendChild(el("h2", "", "The pace"));
    var pace = el("div", "pace");
    var paceNote = el("p", "said");
    PACE.forEach(function (p) {
      var b = button("pace-button", p[1], "", function () {
        send({ type: "pace", value: p[0] }).then(function (res) {
          if (res.ok) {
            paced = p[0];
            pace.querySelectorAll("button").forEach(function (x, i) {
              x.setAttribute("aria-pressed", PACE[i][0] === paced ? "true" : "false");
            });
          }
          said(paceNote, res.ok ? "The speaker can see it" : res.error === "one moment" ? "One moment…" : "Not sent");
        });
      });
      b.setAttribute("aria-pressed", p[0] === paced ? "true" : "false");
      pace.appendChild(b);
    });
    box.appendChild(pace);
    box.appendChild(paceNote);
    return box;
  }

  /* ---- a poll, while one is on the stage */

  /* The phone remembers what it chose, per session and poll, so coming
     back to a poll shows the answer already given. The relay knows only
     that this token chose it, and tells nobody. */
  function chosenKey(stage) { return "sipario-vote:" + stage.session + ":" + stage.poll.id; }
  function chosen(stage) {
    try { var v = localStorage.getItem(chosenKey(stage)); return v === null ? null : Number(v); }
    catch (e) { return null; }
  }

  function poll(stage) {
    var box = el("section", "poll");
    box.appendChild(el("h2", "", "A question"));
    box.appendChild(el("p", "question", stage.poll.question));
    var list = el("div", "options");
    var note = el("p", "said");
    var mark = function (i) {
      list.querySelectorAll("button").forEach(function (b, k) {
        b.setAttribute("aria-pressed", k === i ? "true" : "false");
      });
    };
    stage.poll.options.forEach(function (text, i) {
      list.appendChild(button("option", text, "", function () {
        send({ type: "vote", poll: stage.poll.id, option: i }).then(function (res) {
          if (res.ok) {
            mark(i);
            try { localStorage.setItem(chosenKey(stage), String(i)); } catch (e) { /* kept for this page */ }
          }
          said(note, res.ok ? "Counted. You can change it while the question is up."
            : res.error === "one moment" ? "One moment…" : "Not counted: the question has moved on");
        });
      }));
    });
    box.appendChild(list);
    box.appendChild(note);
    mark(chosen(stage));
    return box;
  }

  /* ---- the feedback form, from its step to the end of the talk */

  /* What was sent is kept in the phone, so the form comes back filled in
     after a reload and can be changed and sent again. */
  function formKey(stage) { return "sipario-feedback:" + stage.session; }

  function form(stage) {
    var qs = stage.feedback.questions;
    var answers = qs.map(function () { return null; });
    try {
      var kept = JSON.parse(localStorage.getItem(formKey(stage)) || "null");
      if (kept && kept.length === qs.length) answers = kept;
    } catch (e) { /* nothing kept */ }

    var box = el("form", "feedback");
    box.appendChild(el("h2", "", "Your feedback"));
    qs.forEach(function (q, i) {
      var field = el("div", "field");
      field.appendChild(el("p", "ask", q.text));
      if (q.kind === "rate") {
        var scale = el("div", "scale");
        for (var n = 1; n <= 5; n++) {
          (function (n) {
            var b = button("score", String(n), q.text + ": " + n + " of 5", function () {
              answers[i] = n;
              scale.querySelectorAll("button").forEach(function (x, k) {
                x.setAttribute("aria-pressed", k + 1 === n ? "true" : "false");
              });
            });
            b.setAttribute("aria-pressed", answers[i] === n ? "true" : "false");
            scale.appendChild(b);
          })(n);
        }
        field.appendChild(scale);
      } else {
        var area = el("textarea", "text");
        area.maxLength = 500;
        area.rows = 3;
        area.value = answers[i] || "";
        area.setAttribute("aria-label", q.text);
        area.addEventListener("input", function () { answers[i] = area.value; });
        field.appendChild(area);
      }
      box.appendChild(field);
    });
    var note = el("p", "said");
    var go = el("button", "send", "Send");
    go.type = "submit";
    box.appendChild(go);
    box.appendChild(note);
    box.addEventListener("submit", function (ev) {
      ev.preventDefault();
      send({ type: "feedback", answers: answers }).then(function (res) {
        if (res.ok) {
          try { localStorage.setItem(formKey(stage), JSON.stringify(answers)); } catch (e) { /* kept for this page */ }
        }
        said(note, res.ok ? "Thank you. You can change it and send it again."
          : res.error === "the form is empty" ? "Answer something first" : "Not sent");
      });
    });
    return box;
  }

  /* ---- the slide on stage
   *
   * The real slide, at the step the room is on: `/slide/<id>/<step>`, a
   * page 1280x720 wide holding that step alone, in a frame that is scaled
   * to the phone's width by `--k`, the way the deck scales its stage. The
   * frame is the isolation: the slide wears the talk's stylesheets and
   * the frame's, and none of them reach this page. A new slide is loaded
   * behind the one showing and swapped in once it has arrived, with no
   * movement, and it cannot be touched: the phone follows the talk and
   * never drives it. */
  var screenEl = document.getElementById("screen");
  var onScreen = "";
  var everShown = false;

  function fit() {
    if (screenEl) screenEl.style.setProperty("--k", String(screenEl.clientWidth / 1280));
  }
  window.addEventListener("resize", fit);
  fit();

  function slide(at) {
    if (!screenEl || !at) return;
    /* `v` moves when the deck has measured the step again, and the
       phone fetches it again to take the new sizes. */
    var src = "/slide/" + encodeURIComponent(at.id) + "/" + at.step + (at.v ? "?v=" + at.v : "");
    if (src === onScreen) return;
    onScreen = src;
    var f = document.createElement("iframe");
    f.className = "incoming";
    f.title = "The slide on stage";
    f.setAttribute("tabindex", "-1");
    f.addEventListener("load", function () {
      /* A slide that arrives after a newer one was asked for is dropped:
         the talk has already moved past it. */
      if (f.getAttribute("src") !== onScreen) { f.remove(); return; }
      screenEl.querySelectorAll("iframe").forEach(function (old) { if (old !== f) old.remove(); });
      f.className = "";
    });
    f.setAttribute("src", src);
    screenEl.appendChild(f);
    everShown = true;
  }

  /* The deck window can go: closed, crashed, or the laptop asleep. The
     last slide stays, and the page says it is the last one rather than
     letting it pass for the current one. */
  function presence(stage) {
    status.textContent = stage.live ? "In the room"
      : everShown ? "The speaker's screen has gone quiet; this is the last slide it showed"
      : "In the room, waiting for the speaker's screen";
  }

  /* ---- what is on the stage */

  /* Three places under the slide, in this order, and nothing is ever
   * hidden to make room: the poll while one is on the stage, since it is
   * what the room is being asked; the feedback form once it is open,
   * which it stays to the end; and the reactions and the pace, always.
   * Each is built again only when what it shows changes, so a slide
   * moving, a poll opening over the form, or a press of a reaction never
   * touches the form: what somebody is typing, and where their cursor
   * is, stay theirs. */
  var pollBox = el("div", "asked");
  var formBox = el("div", "asked");
  var reactBox = el("div", "always");
  main.appendChild(pollBox);
  main.appendChild(formBox);
  main.appendChild(reactBox);
  var pollShown = "", formShown = "";

  /* A poll arriving or going changes the height of the page above
     whatever the person is reading. At the top of the page that is the
     point: the question lands under the slide, in view. Scrolled down,
     they would lose their place, so the page is moved by exactly the
     height that arrived or went, and what they were looking at stays
     where it was. Done by hand because not every phone's browser keeps
     its place by itself. */
  function steady(change) {
    var scrolled = (window.scrollY || window.pageYOffset || 0) > 8;
    var before = reactBox.getBoundingClientRect().top;
    change();
    if (!scrolled) return;
    var moved = reactBox.getBoundingClientRect().top - before;
    if (moved && window.scrollBy) window.scrollBy(0, moved);
  }

  function show(stage) {
    var pk = stage.mode === "poll" && stage.poll
      ? stage.poll.id + ":" + stage.poll.question + ":" + stage.poll.options.join("\n") : "";
    var fk = stage.feedback ? JSON.stringify(stage.feedback.questions) : "";
    steady(function () {
      if (pk !== pollShown) {
        pollShown = pk;
        pollBox.textContent = "";
        if (pk) pollBox.appendChild(poll(stage));
      }
      if (fk !== formShown) {
        formShown = fk;
        formBox.textContent = "";
        if (fk) formBox.appendChild(form(stage));
      }
      if (!reactBox.firstChild) reactBox.appendChild(reactions(stage));
    });
  }

  var stream = new window.EventSource("/stream");
  stream.onopen = function () { status.textContent = "In the room"; };
  stream.onerror = function () { status.textContent = "Reconnecting…"; };
  stream.onmessage = function (ev) {
    var stage;
    try { stage = JSON.parse(ev.data); } catch (e) { return; }
    if (!stage || stage.type !== "stage") return;
    slide(stage.slide);
    presence(stage);
    show(stage);
  };
})();
