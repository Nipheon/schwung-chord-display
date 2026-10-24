/*
 * Chord Display page. The DSP publishes the held chord as MIDI notes
 * ("chord_notes") and Move's root note and scale ("key"); everything else is
 * here: naming the chord, the roman numeral, and drawing both.
 *
 *   key           small, top left         C Major
 *   chord name    large, centred          Am7, C/E
 *   numeral       below the name          vi7
 *
 * Inversions show only as a slash in the name; the numeral ignores the bass.
 */

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/* [suffix, intervals from the root, tier, minor numeral, numeral suffix].
 * Tier decides between readings of the same notes: triads beat 7ths and
 * sixths, which beat the bare fifth. Ties go to the reading rooted on the bass. */
const TEMPLATES = [
    ["", [0, 4, 7], 3, false, ""],
    ["m", [0, 3, 7], 3, true, ""],
    ["dim", [0, 3, 6], 3, true, "o"],
    ["aug", [0, 4, 8], 3, false, "+"],
    ["sus2", [0, 2, 7], 3, false, "sus2"],
    ["sus4", [0, 5, 7], 3, false, "sus4"],
    ["5", [0, 7], 1, false, "5"],
    ["maj7", [0, 4, 7, 11], 2, false, "M7"],
    ["7", [0, 4, 7, 10], 2, false, "7"],
    ["m7", [0, 3, 7, 10], 2, true, "7"],
    ["m7b5", [0, 3, 6, 10], 2, true, "7b5"],
    ["dim7", [0, 3, 6, 9], 2, true, "o7"],
    ["mMaj7", [0, 3, 7, 11], 2, true, "M7"],
    ["6", [0, 4, 7, 9], 2, false, "6"],
    ["m6", [0, 3, 7, 9], 2, true, "6"],
    ["7sus4", [0, 5, 7, 10], 2, false, "7sus4"],
    ["add9", [0, 2, 4, 7], 2, false, "add9"],
    ["madd9", [0, 2, 3, 7], 2, true, "add9"],
    ["maj9", [0, 2, 4, 7, 11], 2, false, "M9"],
    ["9", [0, 2, 4, 7, 10], 2, false, "9"],
    ["m9", [0, 2, 3, 7, 10], 2, true, "9"],
].map(([suffix, ivs, tier, minor, numeral]) => ({
    suffix, ivs, tier, minor, numeral,
    mask: ivs.reduce((m, i) => m | (1 << i), 0),
}));

function rotate(mask, by) {
    return ((mask >> by) | (mask << (12 - by))) & 0xFFF;
}

/* notes: MIDI note numbers. Returns null for no notes, else
 * { name, root, bass, tpl, count }; root and tpl are null when nothing fits. */
function detectChord(notes) {
    if (!notes || !notes.length) return null;
    const bassNote = Math.min(...notes);
    const bass = bassNote % 12;
    let mask = 0;
    for (const n of notes) mask |= 1 << (n % 12);
    const pcs = [];
    for (let pc = 0; pc < 12; pc++) if (mask & (1 << pc)) pcs.push(pc);

    if (pcs.length === 1) return { name: NOTE_NAMES[bass], root: null, bass, tpl: null, count: 1 };

    let best = null;
    for (const root of pcs) {
        const rel = rotate(mask, root);
        for (const tpl of TEMPLATES) {
            if (tpl.mask !== rel) continue;
            const score = tpl.tier * 100 + (root === bass ? 10 : 0) + tpl.ivs.length;
            if (!best || score > best.score) best = { score, root, tpl };
        }
    }
    if (best) {
        let name = NOTE_NAMES[best.root] + best.tpl.suffix;
        if (best.root !== bass) name += "/" + NOTE_NAMES[bass];
        return { name, root: best.root, bass, tpl: best.tpl, count: pcs.length };
    }

    if (pcs.length === 2) {
        const hi = notes.filter((n) => n % 12 !== bass).sort((a, b) => a - b)[0];
        return { name: NOTE_NAMES[bass] + "-" + NOTE_NAMES[hi % 12], root: null, bass, tpl: null, count: 2 };
    }
    return { name: NOTE_NAMES[bass] + "?", root: null, bass, tpl: null, count: pcs.length };
}

const MAJOR_ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];
const DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];

/* Move's scale names are matched case-insensitively; anything unknown, or not
 * seven notes, falls back to the chromatic numerals above. */
const SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "natural minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "locrian": [0, 1, 3, 5, 6, 8, 10],
    "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
    "melodic minor": [0, 2, 3, 5, 7, 9, 11],
    "harmonic major": [0, 2, 4, 5, 7, 8, 11],
};

function scaleIntervals(name) {
    const key = String(name || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
    return SCALES[key] || null;
}

/* rootNote: 0-11 or -1 unknown. Returns null when there is nothing to show. */
function romanNumeral(chord, rootNote, scaleName) {
    if (!chord || !chord.tpl || !(rootNote >= 0)) return null;
    const d = (chord.root - rootNote + 12) % 12;
    const scale = scaleIntervals(scaleName);
    let prefix = "", base;
    if (scale) {
        const idx = scale.indexOf(d);
        const above = scale.indexOf(d + 1);
        const below = scale.indexOf(d - 1);
        if (idx >= 0) base = DEGREES[idx];
        else if (above >= 0 && d + 1 < 12) { prefix = "b"; base = DEGREES[above]; }
        else if (below >= 0) { prefix = "#"; base = DEGREES[below]; }
    }
    if (!base) {
        const m = MAJOR_ROMAN[d].match(/^([b#]?)(.+)$/);
        prefix = m[1];
        base = m[2];
    }
    return prefix + (chord.tpl.minor ? base.toLowerCase() : base) + chord.tpl.numeral;
}

function parseNotes(raw) {
    const head = String(raw || "").split("|")[0];
    return head ? head.split(",").map(Number).filter((n) => Number.isFinite(n)) : [];
}

function parseKey(raw) {
    const [r, ...rest] = String(raw || "").split("|");
    const root = r === undefined || r === "" ? NaN : Number(r);
    return { root: Number.isFinite(root) ? root : -1, scale: rest.join("|") };
}

/* 5x7 glyphs for large text; ctx.print only has the one small size. */
const GLYPHS = (() => {
    const src = {
        "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#",
        "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
        "C": ".###.|#...#|#....|#....|#....|#...#|.###.",
        "D": "####.|#...#|#...#|#...#|#...#|#...#|####.",
        "E": "#####|#....|#....|####.|#....|#....|#####",
        "F": "#####|#....|#....|####.|#....|#....|#....",
        "G": ".###.|#...#|#....|#.###|#...#|#...#|.###.",
        "I": ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
        "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
        "V": "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
        "a": ".....|.....|.###.|....#|.####|#...#|.####",
        "b": "#....|#....|####.|#...#|#...#|#...#|####.",
        "d": "....#|....#|.####|#...#|#...#|#...#|.####",
        "g": ".###.|#...#|#...#|.####|....#|#...#|.###.",
        "i": "..#..|.....|.##..|..#..|..#..|..#..|.###.",
        "j": "...#.|.....|..##.|...#.|...#.|#..#.|.##..",
        "m": ".....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#",
        "o": ".##..|#..#.|.##..|.....|.....|.....|.....",
        "s": ".....|.....|.####|#....|.###.|....#|####.",
        "u": ".....|.....|#...#|#...#|#...#|#..##|.##.#",
        "v": ".....|.....|#...#|#...#|#...#|.#.#.|..#..",
        "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
        "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
        "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
        "3": ".###.|#...#|....#|..##.|....#|#...#|.###.",
        "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
        "5": "#####|#....|####.|....#|....#|#...#|.###.",
        "6": ".###.|#....|#....|####.|#...#|#...#|.###.",
        "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
        "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
        "9": ".###.|#...#|#...#|.####|....#|....#|.###.",
        "#": ".#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....",
        "/": "....#|....#|...#.|..#..|.#...|#....|#....",
        "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
        "-": ".....|.....|.....|#####|.....|.....|.....",
        "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
    };
    const out = {};
    for (const ch of Object.keys(src)) out[ch] = src[ch].split("|");
    return out;
})();

function bigWidth(text, scale) {
    return text.length ? text.length * 6 * scale - scale : 0;
}

function drawBig(ctx, text, scale, cx, y) {
    let x = Math.round(cx - bigWidth(text, scale) / 2);
    for (const ch of text) {
        const rows = GLYPHS[ch];
        if (rows) {
            for (let gy = 0; gy < 7; gy++) {
                let gx = 0;
                while (gx < 5) {
                    if (rows[gy][gx] !== "#") { gx++; continue; }
                    let run = gx;
                    while (run < 5 && rows[gy][run] === "#") run++;
                    ctx.fillRect(x + gx * scale, y + gy * scale, (run - gx) * scale, scale, 1);
                    gx = run;
                }
            }
        }
        x += 6 * scale;
    }
}

/* Largest scales that fit the band, name first, numeral second. */
function pickScales(w, h, name, numeral) {
    const top = 9;                                  /* the key line, one gap */
    const options = numeral ? [[3, 2], [2, 2], [2, 1], [1, 1]] : [[3, 0], [2, 0], [1, 0]];
    for (const [sn, sr] of options) {
        const needH = top + 7 * sn + (sr ? 3 + 7 * sr : 0);
        if (needH <= h && bigWidth(name, sn) <= w && (!sr || bigWidth(numeral, sr) <= w)) return [sn, sr];
    }
    return [1, numeral ? 1 : 0];
}

function drawPage(ctx, { values }) {
    const w = ctx.width, h = ctx.height;
    const { root, scale } = parseKey(values && values.key);
    const notes = parseNotes(values && values.chord_notes);
    const chord = detectChord(notes);
    const numeral = chord ? romanNumeral(chord, root, scale) : null;

    const keyText = root >= 0 ? NOTE_NAMES[root] + (scale ? " " + scale : "") : "no key";
    ctx.print(0, 0, keyText, 1);

    const name = chord ? chord.name : "-";
    const [sn, sr] = pickScales(w, h, name, numeral);
    const used = 7 * sn + (numeral ? 3 + 7 * sr : 0);
    const y0 = 9 + Math.max(0, Math.floor((h - 9 - used) / 2));
    drawBig(ctx, name, sn, w / 2, y0);
    if (numeral) drawBig(ctx, numeral, sr, w / 2, y0 + 7 * sn + 3);
}

globalThis.canvas_overlay = { drawPage };

if (typeof module !== "undefined") {
    module.exports = { detectChord, romanNumeral, scaleIntervals, parseNotes, parseKey, bigWidth, drawPage };
}
