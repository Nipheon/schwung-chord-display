import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { detectChord, romanNumeral, parseNotes, parseKey, layout, header, bigWidth, scaleIntervals } = createRequire(import.meta.url)("../src/canvas.js");

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

test("7b5 is named from the reading with the third in the bass", () => {
    /* C7b5 and F#7b5 are the same four notes */
    assert.equal(name([60, 64, 66, 70]), "C7b5");        /* root in the bass wins */
    assert.equal(name([54, 60, 64, 70]), "F#7b5");
    assert.equal(name([52, 58, 60, 66]), "C7b5/E");      /* E is the third of C */
    assert.equal(name([58, 60, 64, 66]), "F#7b5/Bb");    /* Bb is the third of F#, not the seventh of C */
    assert.equal(name([46, 48, 52, 54]), "F#7b5/Bb");
    /* the same shape a tritone apart gets the same kind of name */
    assert.equal(name([64, 70, 72, 78]), "C7b5/E");
});

test("altered sevenths and 6/9", () => {
    assert.equal(name([60, 64, 66, 70]), "C7b5");
    assert.equal(name([60, 64, 68, 70]), "C7#5");
    assert.equal(name([60, 61, 64, 67, 70]), "C7b9");
    assert.equal(name([60, 63, 64, 67, 70]), "C7#9");
    assert.equal(name([60, 62, 64, 67, 69]), "C69");
    assert.equal(roman([55, 56, 59, 62, 65], C, "Major"), "V7b9");
    assert.equal(roman([55, 59, 61, 65], C, "Major"), "V7b5");
    assert.equal(name([43, 47, 51, 53]), "G7#5");
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

test("equal readings are named the same in every key", () => {
    assert.equal(name([64, 67, 69, 72]), "Am7/E");
    assert.equal(name([69, 72, 74, 77]), "Dm7/A");
    assert.equal(name([62, 67, 72]), "Gsus4/D");
    assert.equal(name([54, 58, 60, 63]), "Cm7b5/F#");
    /* with a root in the bass, that reading still wins */
    assert.equal(name([60, 64, 67, 69]), "C6");
    assert.equal(name([60, 62, 67]), "Csus2");
    assert.equal(name([51, 55, 58, 60]), "Eb6");
});

test("a power chord is a chord; single notes and other intervals are not", () => {
    assert.equal(name([60, 67]), "C5");
    assert.equal(name([65, 72]), "F5");
    assert.equal(roman([60, 67], C, "Major"), "I5");
    assert.equal(detectChord([60, 65]), null);    /* a fourth is not a power chord */
    assert.equal(detectChord([55, 60]), null);
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

test("inversion adds the bass as a scale degree", () => {
    assert.equal(roman([52, 55, 60], C, "Major"), "I/3");
    assert.equal(roman([53, 55, 59, 62], C, "Major"), "V7/4");
    assert.equal(roman([48, 57, 64], C, "Major"), "vi/1");
    assert.equal(roman([50, 58, 62, 65], C, "Major"), "bVII/2");
    /* a bass outside the scale is named from its place in the chord */
    assert.equal(roman([54, 62, 69], C, "Major"), "II/#4");
    assert.equal(roman([56, 64, 71], C, "Major"), "III/#5");
    assert.equal(roman([52, 55, 60], C, "Minor"), "I/#3");
    assert.equal(roman([52, 55, 60], C, "Phrygian"), "I/#3");
    assert.equal(roman([59, 62, 67], C, "Minor"), "V/#7");
    /* the root keeps its own spelling: F#/Bb in C Major is bV/b7 */
    assert.equal(roman([58, 61, 66], C, "Major"), "bV/b7");
    /* the #9 of 7#9 is a raised 2nd, not a minor 3rd */
    assert.equal(roman([51, 52, 55, 58, 60], C, "Major"), "I7#9/#2");
    /* degrees follow the scale, or fall back to chromatic ones */
    assert.equal(roman([48, 57, 64], 2, "Dorian"), "v/7");
    assert.equal(roman([52, 55, 60], C, "Hirajoshi"), "I/3");
    assert.equal(roman([54, 62, 69], C, ""), "II/#4");
});

test("roman numerals follow the scale", () => {
    assert.equal(roman([60, 64, 67], A, "Minor"), "III");
    assert.equal(roman([57, 60, 64], A, "Minor"), "i");
    assert.equal(roman([62, 65, 69], A, "Minor"), "iv");
    assert.equal(roman([58, 62, 65], A, "Minor"), "bII");
    assert.equal(roman([62, 65, 69], 2, "Dorian"), "i");
});

test("altered scale names keep their alteration", () => {
    assert.deepEqual(scaleIntervals("Dorian #4"), [0, 2, 3, 6, 7, 9, 10]);
    assert.deepEqual(scaleIntervals("dorian"), [0, 2, 3, 5, 7, 9, 10]);
    assert.deepEqual(scaleIntervals("Phrygian Dominant"), [0, 1, 4, 5, 7, 8, 10]);
    assert.equal(scaleIntervals("constructor"), null);
    assert.equal(scaleIntervals("8-Tone Spanish"), null);
    /* F# major in C Dorian #4 is the IV chord; in plain Dorian it is outside the scale */
    assert.equal(roman([54, 58, 61], C, "Dorian #4"), "IV");
    assert.equal(roman([54, 58, 61], C, "Dorian"), "bV");
    /* Phrygian Dominant: G is degree V, Db degree II, E degree III */
    assert.equal(roman([55, 59, 62], C, "Phrygian Dominant"), "V");
    assert.equal(roman([49, 53, 56], C, "Phrygian Dominant"), "II");
    assert.equal(roman([52, 56, 59], C, "Phrygian Dominant"), "III");
});

test("unknown scale falls back to chromatic numerals", () => {
    assert.equal(roman([57, 60, 64], C, "Hirajoshi"), "vi");
    assert.equal(roman([58, 62, 65], C, ""), "bVII");
});

test("no numeral without a key", () => {
    assert.equal(roman([60, 64, 67], -1, ""), null);
});

test("layout: chord row and a smaller numeral row, same sizes for every chord", () => {
    const sizes = (l) => l.map((e) => `${e.size.adv}`);
    const one = layout(128, 40, "Am7", "vi7");
    assert.deepEqual(one.map((e) => e.text), ["Am7", "vi7"]);
    assert.deepEqual(sizes(one), ["12", "9"]);
    assert.ok(one[1].y > one[0].y);
    /* no numeral: just the chord row, same size */
    const bare = layout(128, 40, "Am7", null);
    assert.deepEqual(bare.map((e) => e.text), ["Am7"]);
    assert.deepEqual(sizes(bare), ["12"]);
    /* the longest names and numerals still fit on one row each, at the same sizes */
    for (const [n, r] of [["Abmaj9/Eb", "bVIM9"], ["F#mMaj7/Eb", "bvM7"], ["Dbm7b5/G", "bii7b5"], ["GbmMaj7/Db", "bVII7sus4"], ["Ab7sus4/Db", "bIII7sus4/b6"]]) {
        const l = layout(128, 40, n, r);
        assert.deepEqual(sizes(l), ["12", "9"]);
        for (const e of l) assert.ok(bigWidth(e.text, e.size) <= 128, `${e.text} is ${bigWidth(e.text, e.size)} px`);
    }
    /* both rows sit inside the band under the key line */
    const l = layout(128, 40, "Am7", "vi7");
    assert.ok(l[0].y >= 9);
    assert.ok(l[1].y + 11 <= 40);
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
