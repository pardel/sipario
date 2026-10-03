'use strict';

/* The recorder, in the notes window.
 *
 * A take is the speaker's voice and the steps the deck showed while it
 * was said: what `sipario export video` turns into the talk as a video.
 * It is recorded here, in the notes' own window, and nowhere else. The
 * docked notes are the deck window's iframe and go whenever the deck
 * reloads, which every save does; the notes on another device are served
 * over plain http, where a browser gives a page no microphone. A window
 * of its own survives a save in place (js/presenter.js), so a rehearsal
 * can be edited mid-take.
 *
 * The marks are the deck's. Every position it sends carries the id of
 * the step it shows and the moment that step arrived (js/deck.js), and a
 * take marks each change of step from those, against the moment the
 * recording began. Nothing is debounced or merged: a step shown for 10 ms
 * was shown to the room, and the video keeps a frame of it
 * (lib/video.js). The one thing not marked twice is the same step said
 * again, which is a repeat, not a press.
 *
 * Everything reaches the server as it happens: a slice of audio every
 * five seconds, in order, and each mark as it is made. A window the deck
 * closes, a crash, a laptop lid: what is lost is the slice in hand, never
 * the marks, and the take is there to finish by hand (lib/record.js).
 */
(function () {
  "use strict";

  var deckEl = document.getElementById("deck");
  /* Never loaded on a device (lib/pages.js), and not run there if it is. */
  if (!deckEl || deckEl.getAttribute("data-remote") === "device") return;

  var inFrame = window.parent !== window;
  var OWNER = (function () {
    var m = /[?&]tab=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  var side = document.getElementById("side");
  var note = document.getElementById("timer-note");
  if (!side) return;

  /* Under the clock, in the side column's first column: the clock's
     neighbours stack there, and the rail above the script has no room
     to give (css/presenter.css). */
  var box = document.createElement("div");
  box.id = "rec";
  var after = note && note.parentNode !== side ? note.parentNode : note;
  side.insertBefore(box, after ? after.nextSibling : null);

  /* A line under the clock, where the timer asks before a reset: for
     what the speaker is asked, and for what is said in passing. */
  var told = null;
  function tell(text, ms, asking) {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle("asking", !!asking);
    clearTimeout(told);
    if (ms) told = setTimeout(function () { if (note.textContent === text) { note.textContent = ""; note.classList.remove("asking"); } }, ms);
  }

  /* Docked, the control is still here, so it can be found, and it says
     where recording happens: pressing it moves the notes to their own
     window, by the path D takes. V says the same. */
  if (inFrame) {
    box.innerHTML = '<button id="rec-btn" type="button" title="Takes are recorded in the notes\' own window: this moves them there (D); then press V">Detach to record</button>';
    box.firstChild.addEventListener("click", function () { if (window.__moveNotes) window.__moveNotes(); });
    document.addEventListener("recordkey", function () {
      tell("Takes are recorded in the notes' own window: press D, then V there.", 4000);
    });
    return;
  }
  /* A window opened by hand follows no particular deck, so a take made in
     it could be marked from whichever deck spoke last. Nothing here. */
  if (!OWNER) { box.remove(); return; }

  box.innerHTML =
    '<button id="rec-btn" type="button" title="Record a take: your voice and every step shown (V)">record</button>' +
    '<span id="rec-time">00:00</span>' +
    '<span id="rec-level" aria-hidden="true"><span id="rec-level-bar"></span></span>';
  var btn = document.getElementById("rec-btn");
  var elTime = document.getElementById("rec-time");
  var elLevel = document.getElementById("rec-level-bar");

  /* In the bar, where the eyes are: that a take is running, and anything
     wrong with it, loudly. */
  var bar = document.getElementById("notes-bar");
  var elOn = document.createElement("span");
  elOn.className = "bar-room bar-rec";
  elOn.id = "rec-on";
  elOn.setAttribute("role", "status");
  var elAlert = document.createElement("span");
  elAlert.className = "bar-room bar-alert";
  elAlert.id = "rec-alert";
  elAlert.setAttribute("role", "alert");
  if (bar) {
    var before = document.getElementById("attach-note");
    bar.insertBefore(elOn, before && before.parentNode === bar ? before : null);
    bar.insertBefore(elAlert, before && before.parentNode === bar ? before : null);
  }

  var trouble = "", level = "";
  function paintAlert() {
    var text = trouble || level;
    elAlert.textContent = text;
    elAlert.title = text;
  }
  function alarm(text) { trouble = text; paintAlert(); }

  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function now() { return performance.timeOrigin + performance.now(); }

  /* idle, starting, recording, stopping. No pause: a take is one stretch
     of recording, and a break is two takes. */
  var state = "idle";

  function paint() {
    btn.textContent = { idle: "record", starting: "starting", recording: "stop", stopping: "finishing" }[state];
    btn.title = state === "recording" ? "Stop and keep the take (V)" : "Record a take: your voice and every step shown (V)";
    box.classList.toggle("recording", state === "recording");
    document.body.classList.toggle("recording", state === "recording" || state === "stopping");
    elOn.textContent = state === "recording" ? "REC " + elTime.textContent : state === "stopping" ? "saving the take" : "";
  }
  paint();

  // ------------------------------------------------------------ the marks

  var last = null;                     // the deck's position, as this window took it
  var anchor = 0;                      // when the recording began, on the deck's clock
  var marks = [];

  /* Every position this window accepted, from its own deck only
     (js/presenter.js filters the rest out before saying so). */
  document.addEventListener("deckstate", function (ev) {
    last = ev.detail || {};
    if (state === "recording") mark(last);
  });

  /* A change of step is a mark, at the moment the deck showed it, to the
     millisecond. The same step again is not: the deck says its position
     again when asked, and after a save, and that is no press. */
  function mark(m) {
    if (typeof m.id !== "string" || !m.id || typeof m.at !== "number") return;
    if (marks.length && marks[marks.length - 1].id === m.id) return;
    marks.push({ id: m.id, t: Math.round(Math.max(0, m.at - anchor)) / 1000, v: typeof m.v === "string" ? m.v : null });
    sendMarks();
  }

  // ------------------------------------------------------- to the server

  var take = null;
  var seq = 0, queue = [], sending = false;    // the slices, in order
  var sent = 0, marking = false;               // the marks the server has
  var failed = null, waiting = [];

  /* Any answer but a good one is final: the server refuses a slice out of
     order, too large or of the wrong kind, and sending it again changes
     none of that. Only no answer at all is worth a second try. */
  function post(url, body, type) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": type || "application/json" },
      body: type ? body : JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = JSON.parse(t); } catch (e) { b = null; }
        if (!r.ok || !b || !b.ok) {
          var err = new Error((b && b.error) || ("the server answered " + r.status));
          err.answered = true;
          throw err;
        }
        return b;
      });
    });
  }

  function retrying(job, done) {
    var tries = 0;
    (function attempt() {
      job().then(done, function (err) {
        if (!err.answered && ++tries < 5) { setTimeout(attempt, 600 * tries); return; }
        lost(err);
      });
    })();
  }

  function settled() { return !!failed || (!sending && !queue.length && !marking && sent >= marks.length); }
  function idle() {
    if (!settled()) return;
    var w = waiting; waiting = [];
    w.forEach(function (fn) { fn(); });
  }
  function whenSettled() { return new Promise(function (ok) { waiting.push(ok); idle(); }); }

  function push(blob) { queue.push(blob); pump(); }
  function pump() {
    if (sending || failed || !queue.length || !take) return idle();
    sending = true;
    retrying(function () {
      return post("/record/chunk?take=" + encodeURIComponent(take) + "&seq=" + seq, queue[0], "application/octet-stream");
    }, function () {
      queue.shift();
      seq += 1;
      sending = false;
      pump();
    });
  }

  /* Sent from the index of the first the server lacks, a batch at a time
     well under the server's limit on a message. */
  function sendMarks() {
    if (marking || failed || !take || sent >= marks.length) return idle();
    marking = true;
    var from = sent;
    retrying(function () {
      return post("/record/marks", { take: take, from: from, marks: marks.slice(from, from + 100) });
    }, function (r) {
      sent = r.have;
      marking = false;
      sendMarks();
    });
  }

  /* A slice or a mark that will not arrive ends the take: what follows
     would be audio with a hole in it, or steps out of step. What arrived
     is on disk. */
  function lost(err) {
    failed = err;
    sending = marking = false;
    alarm("The take is not reaching sipario (" + err.message + "). What arrived is kept: `sipario takes` lists it.");
    idle();
    if (state === "recording") stop().catch(function () { /* said above */ });
  }

  // ---------------------------------------------------------- the audio

  var ctx = null, stream = null, track = null, rec = null, source = null, meter = null;
  var stopped = null, stopping = null;

  /* Off, all three: a take is also the sample a voice is cloned from, and
     a voice cleaned up by the browser is a voice with its artefacts. The
     size and rate are asked for, not demanded; what the microphone gave is
     read back and kept with the take. */
  var WANT = {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 },
  };

  function refusal(err) {
    var n = err && err.name;
    if (n === "NotAllowedError" || n === "SecurityError") {
      return "The microphone was refused. Allow it for this address in the browser's site settings " +
        "(on a Mac, for the browser too: System Settings, Privacy & Security, Microphone), then press V.";
    }
    if (n === "NotFoundError" || n === "OverconstrainedError") return "No microphone was found. Connect one, then press V.";
    if (n === "NotReadableError" || n === "AbortError") {
      return "The microphone would not open: another app may be using it. Close that, then press V.";
    }
    return "The take did not start: " + ((err && err.message) || err);
  }

  function release() {
    clearInterval(meter);
    meter = null;
    if (source) { try { source.disconnect(); } catch (e) { /* gone */ } }
    source = null;
    if (track) track.onended = track.onmute = track.onunmute = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = track = null;
    elLevel.style.width = "0";
  }

  /* The level, read off the input every 150 ms. A dead input is silence
     to the recorder, and a track goes on saying it is live while it
     delivers nothing, so only the samples can tell. With the browser's
     processing off a silent input reads exactly 0. Counted in readings
     as well as in seconds: a window behind others is woken less often,
     and one quiet reading a minute after the last is no evidence. */
  function listenLevel() {
    var an = ctx.createAnalyser();
    an.fftSize = 2048;
    source = ctx.createMediaStreamSource(stream);
    source.connect(an);
    var buf = new Float32Array(an.fftSize);
    var heard = Date.now(), voiced = Date.now(), zeros = 0, quiet = 0;
    meter = setInterval(function () {
      var at = Date.now();
      elTime.textContent = fmt(now() - anchor);
      paint();
      if (ctx.state !== "running") return;
      an.getFloatTimeDomainData(buf);
      var peak = 0;
      for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i]); if (v > peak) peak = v; }
      elLevel.style.width = Math.min(100, Math.round(Math.sqrt(peak) * 100)) + "%";
      if (peak > 0) { heard = at; zeros = 0; } else zeros += 1;
      if (peak >= 0.003) { voiced = at; quiet = 0; } else quiet += 1;
      level = at - heard >= 2000 && zeros >= 8
        ? "No sound is reaching the take. Check the microphone is the one in use, and not muted."
        : at - voiced >= 4000 && quiet >= 16
          ? "The take hears almost nothing. Check the microphone is the one in use, and near enough."
          : "";
      paintAlert();
    }, 150);
  }

  function start(gesture) {
    if (state !== "idle") return;
    trouble = level = "";
    paintAlert();
    if (!document.body.classList.contains("live") || !last) {
      return alarm("The deck window is not answering, so there is nothing to mark the take against. Open the deck, then press V.");
    }
    if (typeof last.id !== "string" || typeof last.at !== "number") {
      return alarm("The deck window was opened by an older sipario and does not mark its steps. Reload it, then press V.");
    }
    /* A browser starts audio for a press in the page's own window, and
       the meter's audio is made on the first one; a key forwarded from
       the deck is not one. After that it is kept, and either will do. */
    if (!ctx && !gesture) {
      return tell("Press V here, in the notes window, for the first take: a browser starts a microphone only " +
        "for a press in its own window. After that, V in the deck starts and stops takes too.", 7000);
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder || !AC) {
      return alarm("This browser cannot record from this page.");
    }
    state = "starting";
    paint();
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    navigator.mediaDevices.getUserMedia({ audio: WANT }).then(function (s) {
      stream = s;
      track = s.getAudioTracks()[0] || null;
      var settings = track && track.getSettings ? track.getSettings() : null;
      var mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/mp4";
      return post("/record/start", { mime: mime, settings: settings, v: typeof last.v === "string" ? last.v : null })
        .then(function (r) {
          take = r.take;
          seq = 0; queue = []; sending = false;
          sent = 0; marking = false; failed = null;
          rec = new MediaRecorder(stream, { mimeType: mime });
          rec.ondataavailable = function (e) { if (e.data && e.data.size) push(e.data); };
          rec.onerror = function (e) {
            alarm("The recorder failed (" + ((e && e.error && e.error.name) || "an error") + "); the take is kept as far as it got.");
            stop().catch(function () { /* said */ });
          };
          /* Stopped by the browser rather than by a press: the track went. */
          rec.onstop = function () {
            if (stopped) { stopped(); return; }
            if (state === "recording") stop().catch(function () { /* said */ });
          };
          if (track) {
            track.onended = function () {
              alarm("The microphone went away, unplugged or taken by the system. The take is kept as far as it got.");
              stop().catch(function () { /* said */ });
            };
            track.onmute = function () { alarm("The system has muted the microphone; the take is recording silence."); };
            track.onunmute = function () { if (/muted the microphone/.test(trouble)) alarm(""); };
          }
          /* The step on screen as the take opens, at its first moment, and
             the moment itself taken just before the recorder starts: the
             audio begins within a few milliseconds of the call, and the
             recorder's own start event comes some 50 ms after it. */
          marks = [{ id: last.id, t: 0, v: typeof last.v === "string" ? last.v : null }];
          anchor = now();
          rec.start(5000);
          state = "recording";
          elTime.textContent = "00:00";
          listenLevel();
          paint();
          sendMarks();
          if (r.setAside) {
            tell("The take before this one went quiet and was left unfinished: sipario takes recover " + r.setAside +
              " finishes it.", 9000);
          }
        });
    }).catch(function (err) {
      release();
      take = null;
      state = "idle";
      paint();
      alarm(err && err.answered ? "The take did not start: " + err.message : refusal(err));
    });
  }

  /* The recorder hands over its last slice and stops; once every slice
     and every mark has arrived, the take is finished, and the server
     writes its take.json last. */
  function stop() {
    if (state === "stopping") return stopping;
    if (state !== "recording") return Promise.resolve(null);
    state = "stopping";
    paint();
    var length = (now() - anchor) / 1000;
    stopping = new Promise(function (ok) {
      if (!rec || rec.state === "inactive") return ok();
      stopped = ok;
      try { rec.stop(); } catch (e) { ok(); }
    }).then(function () {
      stopped = null;
      release();
      return whenSettled();
    }).then(function () {
      if (failed) throw failed;
      return post("/record/finish", { take: take, length: length });
    }).then(function (r) {
      take = null;
      state = "idle";
      paint();
      tell("Take " + r.take + " kept: " + r.marks + " steps. `npx sipario export video` makes the video.", 9000);
      return r;
    }, function (err) {
      take = null;
      state = "idle";
      paint();
      if (!trouble) alarm("The take did not finish (" + err.message + "). What arrived is kept: `sipario takes` lists it.");
      throw err;
    });
    return stopping;
  }

  function toggle(gesture) {
    if (state === "idle") start(gesture);
    else if (state === "recording") stop().catch(function () { /* said in the bar */ });
  }

  btn.addEventListener("click", function () { toggle(true); });
  document.addEventListener("recordkey", function (ev) { toggle(!!(ev.detail && ev.detail.gesture)); });

  // --------------------------------------------- leaving while recording

  /* Closing the window, or the notes' own attach, close, D or N, would end
     the take mid-sentence. The browser asks before the window goes; the
     notes' controls ask here, like the timer before a reset: the first
     press asks, the second finishes the take and then does what was
     asked (js/presenter.js calls this). The deck's own N and D close this
     window from the deck, without asking it: that loses the slice in
     hand, and the take is left to finish by hand. */
  var asking = false, askTimer = null;
  function unask() { asking = false; clearTimeout(askTimer); tell(""); }

  window.__take = {
    running: function () { return state === "recording" || state === "stopping"; },
    hold: function (go) {
      if (state === "stopping") { tell("Saving the take; a moment.", 3000); return true; }
      if (state !== "recording") return false;
      if (asking) {
        unask();
        stop().then(function () { go(); }, function () { /* the bar says why; the window stays */ });
        return true;
      }
      asking = true;
      tell("A take is recording. Press again to finish it and go on.", 0, true);
      askTimer = setTimeout(unask, 5000);
      return true;
    },
  };

  window.addEventListener("beforeunload", function (ev) {
    if (state !== "recording" && state !== "stopping") return undefined;
    ev.preventDefault();
    ev.returnValue = "";
    return "";
  });
})();
