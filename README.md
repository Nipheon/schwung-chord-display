# Chord Display

A [Schwung](https://github.com/charlesvestal/schwung) MIDI FX for the Ableton Move that shows the chord you are playing, or the one a clip is playing, with its roman numeral in the Set's key.

```
C Major
  Am7
  vi7
```

One setting: **Hold** (0–5000 ms), how long the chord stays after the last note is released. A new chord replaces it at once.

## Setup

1. Load **Chord Display** as a MIDI FX on a Schwung slot. Leave the slot's MIDI FX output on **Schw**.
2. On the Move track, set **MIDI Out** to the slot's receive channel (Shift + Track). The track keeps playing its own sound.
3. Open the slot in Schwung: the chord is on the first page.

It passes every MIDI message through unchanged and makes no sound. It does not draw over Move's own screen; you see the chord on its page in the Schwung editor.

## How it reads

- The name comes from the notes held. Inversions show a slash (`C/E`); the numeral ignores the bass note.
- The numeral uses the Set's root note and scale, read from Move. Notes outside the scale get `b` or `#`. Unknown scales use chromatic numerals; with no key, only the name is shown.

## Build and test

```
node --test test/chords.test.mjs                                 # naming and numerals
cc -Isrc/dsp -o /tmp/dsp_test test/dsp_test.c -ldl && /tmp/dsp_test   # latch and Hold timing
./scripts/build.sh                                               # Docker, writes dist/chord-display-module.tar.gz
```

Needs Schwung 1.7.3 or newer (`move_info.h` for the key). The build scripts are adapted from [schwung-ducker](https://github.com/charlesvestal/schwung-ducker) (MIT).
