import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { detectChord, romanNumeral, parseNotes, parseKey, layout, header } = createRequire(import.meta.url)("../src/canvas.js");

const C = 0, A = 9;
const name = (notes) => detectChord(notes).name;
const roman = (notes, root, scale) => romanNumeral(detectChord(notes), root, scale);

test("names triads and sevenths", () => {
    assert.equal(name([60, 64, 67]), "C");
    assert.equal(name([57, 60, 64]), "Am");
    assert.equal(name([59, 62, 65]), "Bdim");
    assert.equal(name([60, 64, 68]), "Caug");
    assert.equal(name([67, 71, 74, 77]), "G7");
    assert.equal(name([57, 60, 64, 67]), "Am7");
    assert.equal(name([60, 64, 67, 71]), "Cmaj7");
    assert.equal(name([60, 62, 67]), "Csus2");
});

test("same notes read from the bass", () => {
    assert.equal(name([60, 64, 67, 69]), "C6");
    assert.equal(name([57, 60, 64, 67]), "Am7");
});

test("inversions get a slash", () => {
    assert.equal(name([52, 55, 60]), "C/E");
    assert.equal(name([55, 60, 64]), "C/G");
    assert.equal(name([53, 57, 62]), "Dm/F");
    assert.equal(name([53, 55, 59, 62]), "G7/F");
});

test("octave doubling and note order do not matter", () => {
    assert.equal(name([72, 48, 64, 55]), "C");
});

test("a power chord is a chord; single notes and other intervals are not", () => {
    assert.equal(name([60, 67]), "C5");
    assert.equal(roman([60, 67], C, "Major"), "I5");
    assert.equal(detectChord([]), null);
    assert.equal(detectChord([60]), null);
    assert.equal(detectChord([60, 72]), null);
    assert.equal(detectChord([60, 64]), null);
});

test("unknown cluster gets a question mark", () => {
    assert.equal(name([60, 61, 62, 63]), "C?");
    assert.equal(roman([60, 61, 62, 63], C, "Major"), null);
});

test("roman numerals in C Major", () => {
    assert.equal(roman([60, 64, 67], C, "Major"), "I");
    assert.equal(roman([57, 60, 64, 67], C, "Major"), "vi7");
    assert.equal(roman([55, 59, 62, 65], C, "Major"), "V7");
    assert.equal(roman([62, 65, 69], C, "Major"), "ii");
    assert.equal(roman([59, 62, 65], C, "Major"), "viio");
    assert.equal(roman([60, 64, 67, 71], C, "Major"), "IM7");
    assert.equal(roman([58, 62, 65], C, "Major"), "bVII");
    assert.equal(roman([56, 60, 63], C, "Major"), "bVI");
});

test("inversion does not change the numeral", () => {
    assert.equal(roman([52, 55, 60], C, "Major"), "I");
    assert.equal(roman([53, 55, 59, 62], C, "Major"), "V7");
});

test("roman numerals follow the scale", () => {
    assert.equal(roman([60, 64, 67], A, "Minor"), "III");
    assert.equal(roman([57, 60, 64], A, "Minor"), "i");
    assert.equal(roman([62, 65, 69], A, "Minor"), "iv");
    assert.equal(roman([58, 62, 65], A, "Minor"), "bII");
    assert.equal(roman([62, 65, 69], 2, "Dorian"), "i");
});

test("unknown scale falls back to chromatic numerals", () => {
    assert.equal(roman([57, 60, 64], C, "Hirajoshi"), "vi");
    assert.equal(roman([58, 62, 65], C, ""), "bVII");
});

test("no numeral without a key", () => {
    assert.equal(roman([60, 64, 67], -1, ""), null);
});

test("layout keeps one text size and only wraps long chords", () => {
    const text = (l) => l.map((e) => e.text);
    const sizes = (l) => l.map((e) => e.scale);
    assert.deepEqual(layout(128, 40, "Am7", "vi7"), [{ text: "Am7 (vi7)", scale: 2 }]);
    assert.deepEqual(layout(128, 40, "C/E", "I"), [{ text: "C/E (I)", scale: 2 }]);
    assert.deepEqual(layout(128, 40, "Am7", null), [{ text: "Am7", scale: 2 }]);
    const long = layout(128, 40, "Dbm7b5/G", "bii7b5");
    assert.deepEqual(text(long), ["Dbm7b5/G", "(bii7b5)"]);
    assert.deepEqual(sizes(long), [2, 2]);
    assert.deepEqual(sizes(layout(128, 40, "Abmaj9/Eb", "bVIM9")), [2, 2]);
    /* a band too short for two lines at the usual size drops to the small size */
    assert.deepEqual(sizes(layout(128, 30, "Dbm7b5/G", "bii7b5")), [1]);
});

test("header: channel left, key and scale right, cut to fit", () => {
    const six = (t) => 6 * t.length;
    assert.deepEqual(header({ listen: "3", key: "6|Phrygian" }, 128, six), { left: "CH 3", right: "F# Phrygian" });
    assert.deepEqual(header({ listen: "0", key: "0|Major" }, 128, six), { left: "CH *", right: "C Major" });
    assert.deepEqual(header({ listen: "12", key: "-1|" }, 128, six), { left: "CH 12", right: "no key" });
    const cut = header({ listen: "3", key: "6|Whole-half Diminished" }, 128, six);
    assert.ok(six(cut.left) + 6 + six(cut.right) <= 128);
    assert.ok(cut.right.startsWith("F# Whole"));
    assert.equal(header({ key: "0|Major" }, 128, six).left, "");
});

test("parses what the DSP publishes", () => {
    assert.deepEqual(parseNotes("48,52,55|3"), [48, 52, 55]);
    assert.deepEqual(parseNotes("|4"), []);
    assert.deepEqual(parseNotes(undefined), []);
    assert.deepEqual(parseKey("9|Minor"), { root: 9, scale: "Minor" });
    assert.deepEqual(parseKey("-1|"), { root: -1, scale: "" });
    assert.deepEqual(parseKey(undefined), { root: -1, scale: "" });
});
