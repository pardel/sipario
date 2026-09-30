'use strict';

/* The room's pace, read from what the phones have said.
 *
 * `paceReading(signals, now, opts)` is the whole of the policy, kept apart
 * from the relay so it can be reshaped without touching anything that
 * moves messages. It is a pure function of its arguments: no clock of its
 * own, and nothing carried from one call to the next.
 *
 * A signal is `{ token, value, at }`: a phone, what it asks for (-1
 * slower, 0 as it is, +1 faster) and when, in milliseconds. It returns
 * `{ reading, slower, ok, faster, n }`, where `n` is how many phones the
 * reading stands on and `reading` runs from -1, every one of them asking
 * for slower, to +1, every one asking for faster; `null` when too few
 * have spoken for it to mean anything.
 *
 * Three choices make the default, and each is a trade:
 *
 *   A hard window of 60 seconds. A signal inside it counts in full and
 *   one older counts for nothing. A weight that decays with age would
 *   fade an old signal rather than drop it, which moves the needle more
 *   smoothly, but it is two numbers to reason about instead of one, and
 *   "what the room said in the last minute" is a sentence a speaker can
 *   hold in their head mid-talk. Shorter reacts sooner and swings more.
 *
 *   One phone, one voice. Only a phone's latest signal in the window
 *   counts, so pressing "slower" ten times is still one person asking,
 *   and changing your mind replaces what you said rather than adding to it.
 *
 *   A floor before any reading. Under three phones there is none: one
 *   person's view is not the room's, and a needle that swings to the stop
 *   on a single press teaches the speaker to ignore it. The counts are
 *   still returned, so a panel can say how many have spoken.
 *
 * The reading is (faster - slower) / n. "As it is" adds to n and to
 * neither side, so it pulls the needle towards the middle, which is the
 * reason it is offered at all: without it, the only people who could
 * speak would be the ones who wanted a change.
 */

const DEFAULTS = { window: 60 * 1000, minimum: 3 };

function paceReading(signals, now, opts = {}) {
  const { window, minimum } = { ...DEFAULTS, ...opts };

  const latest = new Map();
  for (const s of signals || []) {
    if (!s || (s.value !== -1 && s.value !== 0 && s.value !== 1)) continue;
    if (s.at > now || now - s.at > window) continue;           // not yet, or gone
    const had = latest.get(s.token);
    if (!had || s.at >= had.at) latest.set(s.token, s);
  }

  let slower = 0, ok = 0, faster = 0;
  for (const { value } of latest.values()) {
    if (value < 0) slower++;
    else if (value > 0) faster++;
    else ok++;
  }
  const n = slower + ok + faster;
  return { reading: n > 0 && n >= minimum ? (faster - slower) / n : null, slower, ok, faster, n };
}

module.exports = { paceReading, DEFAULTS };
