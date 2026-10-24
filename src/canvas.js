/*
 * Chord Display page. The DSP publishes the held chord as MIDI notes
 * ("chord_notes") and Move's root note and scale ("key"); everything else is
 * here: naming the chord, the roman numeral, and drawing both.
 *
 *   channel       small, top left         CH 3  (CH * for all)
 *   key and scale small, top right        F# Phrygian
 *   chord         large, centred          Am7 (vi7)
 *
 * The text shrinks for long names. Inversions show only as a slash in the
 * name; the numeral ignores the bass. A single note or a plain interval is
 * not a chord and clears the display (shown as "-").
 */

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/* [suffix, intervals from the root, tier, minor numeral, numeral suffix].
 * Tier decides between readings of the same notes: triads beat 7ths and
 * sixths, which beat the bare fifth. Ties go to the reading rooted on the bass;
 * when neither root is the bass, PREFERRED breaks the tie (m7 over 6, sus4 over
 * sus2) so a shape gets the same name in every key. A bare fifth only counts
 * with its root in the bass, so a fourth is not a power chord. */
const PREFERRED = new Set(["m7", "m7b5", "sus4"]);

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
    ["7b5", [0, 4, 6, 10], 2, false, "7b5"],
    ["7#5", [0, 4, 8, 10], 2, false, "7#5"],
    ["add9", [0, 2, 4, 7], 2, false, "add9"],
    ["madd9", [0, 2, 3, 7], 2, true, "add9"],
    ["maj9", [0, 2, 4, 7, 11], 2, false, "M9"],
    ["9", [0, 2, 4, 7, 10], 2, false, "9"],
    ["7b9", [0, 1, 4, 7, 10], 2, false, "7b9"],
    ["7#9", [0, 3, 4, 7, 10], 2, false, "7#9"],
    ["69", [0, 2, 4, 7, 9], 2, false, "69"],
    ["m9", [0, 2, 3, 7, 10], 2, true, "9"],
].map(([suffix, ivs, tier, minor, numeral]) => ({
    suffix, ivs, tier, minor, numeral,
    pref: PREFERRED.has(suffix) ? 1 : 0,
    mask: ivs.reduce((m, i) => m | (1 << i), 0),
}));

function rotate(mask, by) {
    return ((mask >> by) | (mask << (12 - by))) & 0xFFF;
}

/* notes: MIDI note numbers. Returns null when there is no chord: no notes, a
 * single note, or two notes that are not a power chord. Otherwise
 * { name, root, bass, tpl, count }; root and tpl are null when nothing fits. */
function detectChord(notes) {
    if (!notes || !notes.length) return null;
    const bassNote = Math.min(...notes);
    const bass = bassNote % 12;
    let mask = 0;
    for (const n of notes) mask |= 1 << (n % 12);
    const pcs = [];
    for (let pc = 0; pc < 12; pc++) if (mask & (1 << pc)) pcs.push(pc);

    if (pcs.length === 1) return null;

    let best = null;
    for (const root of pcs) {
        const rel = rotate(mask, root);
        for (const tpl of TEMPLATES) {
            if (tpl.mask !== rel) continue;
            if (tpl.suffix === "5" && root !== bass) continue;
            const score = tpl.tier * 100 + (root === bass ? 10 : 0) + tpl.ivs.length + tpl.pref;
            if (!best || score > best.score) best = { score, root, tpl };
        }
    }
    if (best) {
        let name = NOTE_NAMES[best.root] + best.tpl.suffix;
        if (best.root !== bass) name += "/" + NOTE_NAMES[bass];
        return { name, root: best.root, bass, tpl: best.tpl, count: pcs.length };
    }

    if (pcs.length === 2) return null;
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
        "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
        ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
    };
    const out = {};
    for (const ch of Object.keys(src)) out[ch] = src[ch].split("|");
    return out;
})();

const SPACE = 3;   /* a space is narrower than a letter */

function bigWidth(text, scale) {
    let w = 0;
    for (const ch of text) w += (ch === " " ? SPACE : 6) * scale;
    return Math.max(0, w - scale);
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
        x += (ch === " " ? SPACE : 6) * scale;
    }
}

/* Top line: the channel being read on the left, the Set's key on the right.
 * The key is cut to what is left of the width. widthOf measures a string. */
function header(values, w, widthOf) {
    const listen = Number(values && values.listen);
    const left = values && values.listen === undefined ? "" : listen >= 1 ? "CH " + listen : "CH *";
    const { root, scale } = parseKey(values && values.key);
    let right = root >= 0 ? NOTE_NAMES[root] + (scale ? " " + scale : "") : "no key";
    const room = w - widthOf(left) - 6;
    while (right.length > 1 && widthOf(right) > room) right = right.slice(0, -1);
    return { left, right };
}

const KEY_LINE = 9;   /* height taken by the key line and one gap */

const SCALE = 2;   /* one text size for every chord; only the line count changes */

/* Lines to draw, each { text, scale }: "Am7 (vi7)" on one line when it fits,
 * else the name with "(numeral)" below it. Only a band too short for two lines
 * at SCALE, or a line wider than the screen, drops everything to scale 1. */
function layout(w, h, name, numeral) {
    const avail = h - KEY_LINE;
    const wrapped = numeral ? "(" + numeral + ")" : null;
    const one = numeral ? name + " " + wrapped : name;
    const attempts = [SCALE, 1];
    for (const s of attempts) {
        if (7 * s <= avail && bigWidth(one, s) <= w) return [{ text: one, scale: s }];
        if (wrapped && 14 * s + 3 <= avail && bigWidth(name, s) <= w && bigWidth(wrapped, s) <= w) {
            return [{ text: name, scale: s }, { text: wrapped, scale: s }];
        }
    }
    return [{ text: one, scale: 1 }];
}

function drawPage(ctx, { values }) {
    const w = ctx.width, h = ctx.height;
    const { root, scale } = parseKey(values && values.key);
    const chord = detectChord(parseNotes(values && values.chord_notes));
    const numeral = chord ? romanNumeral(chord, root, scale) : null;

    const widthOf = (t) => (typeof ctx.textWidth === "function" ? ctx.textWidth(t) : 6 * t.length);
    const head = header(values, w, widthOf);
    ctx.print(0, 0, head.left, 1);
    ctx.print(w - widthOf(head.right), 0, head.right, 1);

    const lines = layout(w, h, chord ? chord.name : "-", numeral);
    const used = lines.reduce((n, l) => n + 7 * l.scale, 0) + 3 * (lines.length - 1);
    let y = KEY_LINE + Math.max(0, Math.floor((h - KEY_LINE - used) / 2));
    for (const l of lines) {
        drawBig(ctx, l.text, l.scale, w / 2, y);
        y += 7 * l.scale + 3;
    }
}

globalThis.canvas_overlay = { drawPage };

if (typeof module !== "undefined") {
    module.exports = { detectChord, romanNumeral, scaleIntervals, parseNotes, parseKey, bigWidth, layout, header, drawPage };
}
