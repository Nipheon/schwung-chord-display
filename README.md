# Chord Display

A [Schwung](https://github.com/charlesvestal/schwung) audio FX for the Ableton Move that shows the chord being played, by the pads or by a clip, on any track, with its roman numeral in the Set's key.

```
C Major
Am7 (vi7)
```

No settings to tune: one **Channel** setting, and the display keeps the last chord until the next one. A single note, or two notes that are not a power chord, clears it.

## Setup

1. Load **Chord Display** as an **audio FX** on any Schwung slot. It leaves the audio and the slot's MIDI untouched.
2. Set each Move track's **MIDI Out** to a channel (Shift + Track) so Schwung sees its notes.
3. Pick **Channel**:
   - **Auto** (default): the slot's own receive channel. If the slot listens to All, everything is read.
   - **1-16**: that channel only. Put the module on the bass track's slot and pick the chord track's channel to see its chords while you edit the bass.
   - **Omni**: every channel.
4. Open the slot in Schwung: the chord is on the first page.

It does not draw over Move's own screen; you see the chord on its page in the Schwung editor.

## How it reads

- Audio FX receive the notes of every channel with their channel number, which is why this is an audio FX and not a MIDI FX.
- Pad presses on Move's own surface can reach audio FX as pad numbers (68-99) on channel 1. Prefer a channel other than 1 for the chord track.
- Inversions show a slash (`C/E`); the numeral ignores the bass note.
- The numeral uses the Set's root note and scale, read from Move. Notes outside the scale get `b` or `#`. Unknown scales use chromatic numerals; with no key, only the name is shown.
- Long chords wrap to a second line; the text size does not change.

## Build and test

```
node --test test/chords.test.mjs                                          # naming, numerals, layout
cc -Isrc/dsp -o /tmp/dsp_test test/dsp_test.c -ldl && /tmp/dsp_test       # note latching, channels
./scripts/build.sh                                                        # Docker, writes dist/chord-display-module.tar.gz
```

Needs Schwung 1.7.3 or newer (`move_info.h` for the key). The build scripts and the audio FX entry points follow [schwung-ducker](https://github.com/charlesvestal/schwung-ducker) (MIT).
