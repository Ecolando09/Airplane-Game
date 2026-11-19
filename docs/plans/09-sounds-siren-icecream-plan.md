# 09 · Sounds: a friendlier police siren, and three songs for the ice cream truck

Written 2026-11-19 for the session that builds it. **Built 2026-11-19.** Read `docs/plans/README.md` first for the repo rules (branch, Google key check, deploy command, how to test). The owner is not a programmer: explain results in plain language, say what was and wasn't tested, and end with the deploy command. `CLAUDE.md` asks for small self-contained subtasks to go to a local Qwen model first; that model only exists on the owner's computer, so in a cloud session do those tasks directly.

Pull before starting: other sessions push to this branch.

## What the owner asked for

1. **The police car's siren.** The owner's son says it sounds "creepy". Change it.
2. **Two more songs for the ice cream truck**, to choose from, and make the music sound better.

Build part A, then part B. Part A is a few lines; part B is most of the work. Neither touches anything outside sound, the truck's buttons and one multiplayer field.

## How it works today

All sound is made in `src/sound.js`; there are no audio files. `updateSiren()` in `src/main.js` calls `sound.siren(kind, vol)` every frame with the kind of vehicle whose siren should be heard (yours, or the nearest friend's with theirs switched on), and `siren()` hands the ice cream truck (`'truck'`) on to `chime(vol)`.

- **Police siren:** two oscillators that never stop (a sawtooth and a square) through a 2,600 Hz low-pass filter. The pitch glides smoothly from 750 to 1,350 Hz and back every 2.6 seconds, and the second oscillator is tuned 0.5% sharp.
- **Ice cream music:** one pair of oscillators, retuned every frame to the current note of a 32-note tune. Every note is 0.22 s long, and the fade of each note is also worked out per frame. So there is one thin voice, every note is the same length, and the sound gets rougher as the frame rate drops (the PSG1 runs at about 36 frames a second).
- **Switches:** `toggleSiren()` in `main.js` flips `item.siren` (for the truck that means its music) from the `#emSirenBtn` button, the U key or D-pad right. Friends learn about it from two bits in the state message (`ride.em`: 1 is lights, 2 is siren or music).

## Part A · The police siren

Why it probably sounds creepy (the planner's reading; nobody has measured it): the slow, smooth rise and fall is the shape of an air-raid siren or a film ghost, the two slightly out-of-tune oscillators add a slow wobble, and the sawtooth is harsh. The fix is a quicker, cleaner sound, like a toy police car.

- **Shape:** a quick "wee-woo". Rise from 650 to 1,250 Hz in 0.2 s, fall back in 0.35 s, repeat: 0.55 s a loop in place of 2.6 s. Work it out from the audio clock, as today.
- **Tone:** drop the 0.5% detune. For the police car the second oscillator plays the same note one octave down, which rounds the sound instead of wobbling it. Lower the filter to about 1,800 Hz for the police car (keep a reference to the filter; today it is a local variable). Same loudness as now (0.055).
- **Leave alone:** the ambulance (two notes) and the fire truck (slow low wail with a horn), unless the owner asks. The switch, button, key, dashboard lamp and what friends hear all go through the same function and need no change.

*Check:* Claude cannot hear. Play it in the preview for the owner's son before committing, and offer the second choice from the questions below if he doesn't like it. `tools/tests/emergency.mjs` still passes.

## Part B · Ice cream truck: three songs and a better music box

### The songs

1. **Sprinkles:** the tune that is there now (written for this game), kept as song 1.
2. **Pop Goes the Weasel** (traditional).
3. **The Entertainer** (Scott Joplin, 1902).

Both new ones are old enough to be free for anyone to use, and both are tunes real ice cream trucks play. Do not use a real ice cream company's jingle: those are owned.

### Better sound

Replace the per-frame retuning with notes scheduled on the audio clock.

- **Songs are data:** a note length in seconds and a list of notes with their lengths, so tunes have long and short notes. A small helper turns a note name (`C5`, `F#4`, `-` for a rest) into a frequency. That helper is a good task for the local Qwen model.
- **A scheduler in `chime(vol, song)`:** it keeps the time of the next note. Each frame it schedules every note that starts within the next 0.2 s, at its exact time on the audio clock. The frame rate then no longer affects the timing or the tone.
- **Each note is a small bell:** a sine at the note, a quieter sine an octave up, and a faint, very short one at three times the note. A 5 ms attack and a 0.7 s fade, so notes ring into each other like a real music box. Give every oscillator a stop time at the end of its fade.
- **A soft low note** (two octaves down, triangle wave) on the first beat of each bar, to fill it out.
- **One master volume:** every note goes into the existing `chimeGain`, which the per-frame call sets from `vol` and `muted` as today. That is what makes the distance fade, mute and switching off work, because a scheduled note cannot be taken back.
- **Switching off, or to another song:** fade the master in 0.05 s, stop scheduling, and start from the first note next time.
- **Falling behind** (a hidden tab, a long frame): jump to now. Never play the missed notes in a burst.
- **PSG1 and Low graphics:** two oscillators a note, not three, and no low notes.

### Starting data

A number after the colon is the note's length in steps (1 if left out). The two new tunes were written from memory: check them by ear and against a free score before calling it done (the 1902 sheet music of The Entertainer is on IMSLP).

```js
const SONGS = [
  { name: 'Sprinkles', step: 0.22, // today's tune, unchanged
    notes: 'E5 G5 C6 G5 A5 G5 E5 C5 D5 E5 F5 D5 G5 -:3 E5 G5 C6 G5 A5 C6 B5 A5 G5 E5 D5 E5 C5 -:3' },
  { name: 'Pop Goes the Weasel', step: 0.17, // 6 steps to a bar
    notes: 'C5:2 C5 D5:2 D5 E5 G5 E5 C5:2 G4 ' + 'C5:2 C5 D5:2 D5 E5:3 C5:2 G4 '
         + 'C5:2 C5 D5:2 D5 E5 G5 E5 C5:3 ' + 'A5:3 D5:2 F5 E5:3 C5:3' },
  { name: 'The Entertainer', step: 0.15, // 8 steps to a bar, after a 2-step lead-in
    notes: 'D5 D#5 ' + 'E5 C6:2 E5 C6:2 E5 C6:6 C6 D6 D#6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6 D5 D#5 '
         + 'E5 C6:2 E5 C6:2 E5 C6:7 A5 G5 ' + 'F#5 A5 C6 E6:2 D6 C6 A5 D6:6 D5 D#5 '
         + 'E5 C6:2 E5 C6:2 E5 C6:6 C6 D6 D#6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6 C6 D6 '
         + 'E6 C6 D6 E6:2 C6 D6 C6 ' + 'E6 C6 D6 E6:2 C6 D6 C6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6' },
];
```

### Choosing a song

- **A third button** in `#emBtns` (`index.html`), shown only in the truck: `🎶 Song`, key **J** (free today; add `KeyJ: 'song'` in `src/input.js`). Each press goes to the next song (1 → 2 → 3 → 1), switches the music on if it was off, and shows "🎵 Song 2 of 3: Pop Goes the Weasel".
- **U and the Music button** keep switching the music on and off, so today's tests don't change.
- **Controllers and the PSG1** have no spare D-pad direction while driving (up and down are grow and shrink). So in the truck, D-pad right steps through off → song 1 → song 2 → song 3 → off. In a police car, ambulance or fire truck it stays on and off.
- **Remembering:** the pick is kept on the truck (`item.song`, 0 to 2), and the last pick is saved with the player's settings (`settings` and `saveSettings()` in `main.js`), so a favourite stays the default.
- **Friends hear the same song.** `src/multiplayer.js` keeps only `em & 3` of what a friend sends. Put the song in the next two bits (`emState()` adds `song << 2`), widen the mask to `& 15`, and have `updateSiren()` pass the loudest friend's song on: `sound.siren(kind, vol, song)`. The relay (`server/`) passes `ride` through untouched, so it needs no change. A friend on an older build keeps hearing song 1, which is fine.

*Check:* extend `tools/tests/icecream.mjs`: the Song button shows in the truck and not in a police car; J steps 1 → 2 → 3 → 1 and turns the music on; the message names the song; U still switches the music off and on; `emState()` carries the song, and a second browser in the room receives it. Add a sound check that needs no ears: under `?debug` keep a short log of the note times `chime()` schedules, call it 60 times a second and then 5 times a second against the same clock, and compare the two logs; they must match. Then play all three songs in the preview for the owner and their son before committing. `emergency.mjs`, `gamepad.mjs` and `psg1.mjs` still pass.

## Things that will trip you up

- **`siren()` runs every frame**, mostly with nothing to play. `chime(0)` must stay cheap and must not create audio nodes.
- **Sound only starts after the first tap or key** (`sound.start()`). In tests, check the schedule, not the speakers.
- **Don't let oscillators pile up.** Every note's oscillators need a stop time, and the look-ahead must stay short (0.2 s), or switching the music off will lag and the PSG1 will slow down.
- **Nobody building this can hear it.** Timing and loudness can be tested; "creepy" and "sounds better" can only be judged by the owner and their son, so let them listen before each commit.

## Questions for the owner (defaults given, so the build doesn't wait)

1. Siren: a quick "wee-woo, wee-woo". (Default. Second choice if your son doesn't like it: two short rising "woop, woop" sounds, then a pause.)
2. Songs: Pop Goes the Weasel and The Entertainer. (Default. Other free tunes that would work: Twinkle Twinkle Little Star, Old MacDonald, Row Row Row Your Boat.)
3. Keep today's tune as song 1, with the new bell sound? (Default: yes.)
4. Leave the ambulance and fire truck sirens as they are? (Default: yes.)
5. On a controller, D-pad right in the truck steps through off, song 1, song 2, song 3. (Default: yes.)

## Prompt to start the build session

```txt
Read docs/plans/README.md and docs/plans/09-sounds-siren-icecream-plan.md. Pull first. Build part A, then part B, on branch claude/lego-airplane-game-ttd82x. Use the defaults for the owner questions unless I answer them. Play me the new siren and the three songs in the preview before you commit, tell me what was and wasn't tested, and give me the deploy command.
```
