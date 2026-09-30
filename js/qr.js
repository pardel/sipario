/* A QR code, drawn as SVG. No dependencies, no build.
 *
 * It is here, among what runs in the browser, because that is where the
 * join address is known: the relay says it as the room opens and says it
 * again if the laptop's network changes. The same file loads under
 * Node's `require`, which is how the suite reads codes back.
 *
 * Only what a join address needs: byte mode, error correction level M
 * (about 15% of the code can be lost and it still reads), versions 1 to
 * 10, which is 21 to 57 modules a side and up to 213 bytes. A longer text
 * is refused by name rather than drawn as something no phone can read.
 *
 * The steps, in the order they run, each a function below:
 *
 *   bits      the text as UTF-8, behind a 4-bit mode and its length,
 *             closed and padded to the version's data capacity
 *   blocks    the data cut into the version's blocks, each given its
 *             Reed-Solomon error correction, then interleaved
 *   frame     the fixed patterns: three finders and their separators,
 *             the timing lines, the alignment patterns, the dark module,
 *             and room kept for the format and version information
 *   place     the codewords laid in two-column zigzags up and down from
 *             the bottom right, round everything the frame holds
 *   mask      each of the eight masks tried, its format written, and the
 *             one with the lowest penalty kept (the standard four rules:
 *             runs, 2x2 blocks, finder-like patterns, dark balance)
 *   svg       one path of dark modules in `currentColor`, so the talk's
 *             stylesheet decides the ink, on a 4-module quiet zone left
 *             clear, with edges kept crisp
 *
 * The standard is ISO/IEC 18004. The numbers below are its tables for
 * level M, and the suite reads every code back with a decoder it did not
 * write.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ GF(256)

  /* The field Reed-Solomon works in, over x^8 + x^4 + x^3 + x^2 + 1. */
  var EXP = [], LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  /** The `n` error-correction codewords for `data`: the remainder of the
      data, as a polynomial, divided by (x - a^0)(x - a^1)...(x - a^(n-1)). */
  function ecc(data, n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = [];
      for (var k = 0; k <= g.length; k++) next.push(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    var rem = data.concat(new Array(n).fill(0));
    for (var d = 0; d < data.length; d++) {
      var c = rem[d];
      if (c) for (var t = 0; t < g.length; t++) rem[d + t] ^= mul(g[t], c);
    }
    return rem.slice(data.length);
  }

  // ------------------------------------------------------------- tables

  /* Level M, versions 1 to 10: error-correction codewords per block, and
     the blocks as [how many, data codewords in each]. */
  var BLOCKS = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]]];

  /* Where the alignment patterns' centres fall, on both axes. */
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var MAX_VERSION = 10;

  function dataCodewords(v) {
    return BLOCKS[v][1].reduce(function (a, b) { return a + b[0] * b[1]; }, 0);
  }

  // --------------------------------------------------------------- bits

  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  /** The smallest version the bytes fit, and its data codewords. */
  function bits(bytes) {
    var v = 1;
    for (; v <= MAX_VERSION; v++) {
      var count = v < 10 ? 8 : 16;
      if (4 + count + 8 * bytes.length <= dataCodewords(v) * 8) break;
    }
    if (v > MAX_VERSION) {
      throw new Error("a QR code of version " + MAX_VERSION + " holds 213 bytes at level M, and this is " +
        bytes.length);
    }
    var out = [];
    var put = function (value, n) { for (var i = n - 1; i >= 0; i--) out.push(value >>> i & 1); };
    put(4, 4);                                        // byte mode
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var room = dataCodewords(v) * 8;
    put(0, Math.min(4, room - out.length));           // the terminator
    while (out.length % 8) out.push(0);
    var words = [];
    for (var i = 0; i < out.length; i += 8) {
      var w = 0;
      for (var k = 0; k < 8; k++) w = w << 1 | out[i + k];
      words.push(w);
    }
    for (var p = 0; words.length < dataCodewords(v); p++) words.push(p % 2 ? 0x11 : 0xec);
    return { version: v, words: words };
  }

  // ------------------------------------------------------------- blocks

  function blocks(v, words) {
    var n = BLOCKS[v][0], data = [], at = 0;
    BLOCKS[v][1].forEach(function (group) {
      for (var i = 0; i < group[0]; i++) { data.push(words.slice(at, at + group[1])); at += group[1]; }
    });
    var ec = data.map(function (d) { return ecc(d, n); });
    var out = [];
    var longest = Math.max.apply(null, data.map(function (d) { return d.length; }));
    for (var i = 0; i < longest; i++) data.forEach(function (d) { if (i < d.length) out.push(d[i]); });
    for (var j = 0; j < n; j++) ec.forEach(function (e) { out.push(e[j]); });
    return out;
  }

  // -------------------------------------------------------------- frame

  function frame(v) {
    var size = 17 + 4 * v, dark = [], fixed = [];
    for (var y = 0; y < size; y++) { dark.push(new Array(size).fill(false)); fixed.push(new Array(size).fill(false)); }
    var set = function (x, y, on) { dark[y][x] = on; fixed[y][x] = true; };

    /* The finders, each with its light separator where it lies inside
       the symbol. */
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(function (at) {
      for (var dy = -1; dy <= 7; dy++) {
        for (var dx = -1; dx <= 7; dx++) {
          var x = at[0] + dx, y = at[1] + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          var ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          set(x, y, ring !== 2 && ring !== 4);
        }
      }
    });
    for (var i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    /* Every pair of centres but the three under a finder. They may cross
       the timing lines, and are drawn over them. */
    var last = ALIGN[v][ALIGN[v].length - 1];
    ALIGN[v].forEach(function (cy) {
      ALIGN[v].forEach(function (cx) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) return;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    /* Kept for the format information, written once a mask is chosen,
       and the one module that is always dark. */
    for (var f = 0; f < 9; f++) { fixed[8][f] = fixed[f][8] = true; }
    for (var g = 0; g < 8; g++) { fixed[8][size - 1 - g] = fixed[size - 1 - g][8] = true; }
    set(8, size - 8, true);
    if (v >= 7) {
      var vb = versionBits(v);
      for (var b = 0; b < 18; b++) {
        var on = (vb >>> b & 1) === 1, a = size - 11 + b % 3, c = Math.floor(b / 3);
        set(a, c, on);
        set(c, a, on);
      }
    }
    return { size: size, dark: dark, fixed: fixed };
  }

  /** The 18 bits of version information, for version 7 and above. */
  function versionBits(v) {
    var rem = v;
    for (var i = 0; i < 12; i++) rem = rem << 1 ^ (rem >>> 11) * 0x1f25;
    return v << 12 | rem;
  }

  /** The 15 bits of format information for level M and a mask. */
  function formatBits(mask) {
    var data = mask;                                  // level M is 00
    var rem = data;
    for (var i = 0; i < 10; i++) rem = rem << 1 ^ (rem >>> 9) * 0x537;
    return (data << 10 | rem) ^ 0x5412;
  }

  function writeFormat(m, mask) {
    var f = formatBits(mask), size = m.size;
    var bit = function (i) { return (f >>> i & 1) === 1; };
    for (var i = 0; i <= 5; i++) m.dark[i][8] = bit(i);
    m.dark[7][8] = bit(6);
    m.dark[8][8] = bit(7);
    m.dark[8][7] = bit(8);
    for (var j = 9; j < 15; j++) m.dark[8][14 - j] = bit(j);
    for (var k = 0; k < 8; k++) m.dark[8][size - 1 - k] = bit(k);
    for (var l = 8; l < 15; l++) m.dark[size - 15 + l][8] = bit(l);
  }

  // -------------------------------------------------------------- place

  function place(m, codewords) {
    var size = m.size, i = 0, total = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                     // the timing line
      var upward = (right + 1 & 2) === 0;
      for (var n = 0; n < size; n++) {
        var y = upward ? size - 1 - n : n;
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          if (m.fixed[y][x]) continue;
          m.dark[y][x] = i < total && (codewords[i >>> 3] >>> 7 - (i & 7) & 1) === 1;
          i++;
        }
      }
    }
  }

  // --------------------------------------------------------------- mask

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; },
  ];

  function masked(m, mask) {
    var dark = m.dark.map(function (row, y) {
      return row.map(function (on, x) { return m.fixed[y][x] ? on : on !== MASKS[mask](x, y); });
    });
    var out = { size: m.size, dark: dark, fixed: m.fixed };
    writeFormat(out, mask);
    return out;
  }

  /** The standard's penalty: lower reads more reliably. */
  function penalty(dark) {
    var size = dark.length, score = 0, lines = [];
    for (var i = 0; i < size; i++) {
      lines.push(dark[i]);
      lines.push(dark.map(function (row) { return row[i]; }));
    }
    var FINDER = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];
    lines.forEach(function (line) {
      for (var s = 0; s < size;) {                    // 1: runs of five or more
        var e = s;
        while (e < size && line[e] === line[s]) e++;
        if (e - s >= 5) score += 3 + (e - s - 5);
        s = e;
      }
      for (var p = 0; p + 11 <= size; p++) {          // 3: finder-like patterns
        FINDER.forEach(function (f) {
          for (var q = 0; q < 11; q++) if ((line[p + q] ? 1 : 0) !== f[q]) return;
          score += 40;
        });
      }
    });
    for (var y = 0; y + 1 < size; y++) {              // 2: 2x2 blocks of one colour
      for (var x = 0; x + 1 < size; x++) {
        var c = dark[y][x];
        if (dark[y][x + 1] === c && dark[y + 1][x] === c && dark[y + 1][x + 1] === c) score += 3;
      }
    }
    var on = 0;                                       // 4: how far from half dark
    dark.forEach(function (row) { row.forEach(function (d) { if (d) on++; }); });
    score += 10 * Math.floor(Math.abs(on * 100 / (size * size) - 50) / 5);
    return score;
  }

  // ------------------------------------------------------------- matrix

  /** The code for `text`: `{ version, mask, size, dark, score }`, where
      `dark` is rows of booleans, true for a dark module. `only` forces one
      mask rather than choosing, which is how the suite reads all eight. */
  function matrix(text, only) {
    var b = bits(utf8(String(text)));
    var m = frame(b.version);
    place(m, blocks(b.version, b.words));
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      if (only !== undefined && mask !== only) continue;
      var candidate = masked(m, mask);
      var score = penalty(candidate.dark);
      if (!best || score < best.score) best = { mask: mask, score: score, dark: candidate.dark };
    }
    return { version: b.version, mask: best.mask, size: m.size, dark: best.dark, score: best.score };
  }

  // ---------------------------------------------------------------- svg

  var QUIET = 4;
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

  /** The code for `text` as an SVG string: one path, runs of dark modules
      joined, in `currentColor`, the quiet zone left clear around it. */
  function svg(text) {
    var m = matrix(text), w = m.size + 2 * QUIET, d = "";
    m.dark.forEach(function (row, y) {
      for (var x = 0; x < m.size;) {
        if (!row[x]) { x++; continue; }
        var run = 0;
        while (x + run < m.size && row[x + run]) run++;
        d += "M" + (x + QUIET) + " " + (y + QUIET) + "h" + run + "v1h-" + run + "z";
        x += run;
      }
    });
    var label = String(text).replace(/[&<>"]/g, function (c) { return ESC[c]; });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + w +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' + label + '">' +
      '<path fill="currentColor" d="' + d + '"/></svg>';
  }

  /** Which modules of a version are its fixed patterns and information,
      rather than data: for the suite, which reads the data back itself. */
  function reserved(v) { return frame(v).fixed; }

  var api = { svg: svg, matrix: matrix, ecc: ecc, formatBits: formatBits, versionBits: versionBits,
              penalty: penalty, reserved: reserved, MAX_BYTES: 213 };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.siparioQr = api;
})(this);
