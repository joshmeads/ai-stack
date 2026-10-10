---
name: games:tools:audio
description: >
  Implement game audio for browser games with the Web Audio API: bus/mixer
  layout, volume sliders in decibels, ducking, SFX variation, beat-synced
  events and adaptive music, plus how to plug that graph into three.js audio
  and Phaser's sound manager. Use when the user mentions audio mixing, buses,
  volume settings, ducking, adaptive or dynamic music, SFX variation, or
  syncing gameplay to the beat.
---

# Audio design

Game audio is a **mixing graph plus a music system**. Route every sound through a
small set of buses so you can balance and process groups; make music *react* to
play through layering and re-sequencing rather than looping one track. In the
browser the graph is built from Web Audio nodes; three.js and Phaser both sit on
top of one `AudioContext`.

## When to use

- Use to design a bus/mixer layout, wire settings sliders, and apply effects
  (compression, EQ, reverb) to groups of sounds.
- Use to duck music/ambience under dialogue or big impacts.
- Use to build adaptive music that responds to combat/exploration intensity.
- Use to add SFX variation (pitch/sample randomization) and sync events to a beat.

**When *not* to use:** loading and decoding files are covered by the engine
(`this.load.audio` in Phaser, `THREE.AudioLoader` in three.js).

## Core workflow

1. **Lay out buses, not per-sound volume.** A typical tree: `Master ← {Music,
   SFX, Ambience, UI, Voice}`. Every sound plays into a bus; settings sliders map
   to bus volumes.
2. **Work in decibels.** Perceived loudness is logarithmic, so sliders and
   automation should move in dB; convert to gain only at the node.
3. **Leave headroom.** Keep the summed mix below 0 dBFS so it never clips: mix
   buses a few dB down and put a limiter on Master as a safety net. As a loudness
   target, many games sit around -14 to -16 LUFS integrated; check with a
   loudness meter on a recording, not by ear.
4. **Duck competing sources**: when voice or an important SFX plays, the music
   bus dips, then recovers. Web Audio has no keyed sidechain, so automate the
   music bus gain.
5. **Make music adaptive** via *vertical* layering (stems faded in/out) and/or
   *horizontal* re-sequencing (swap segments at bar boundaries). See the
   reference.
6. **Vary repeated SFX** with small random pitch/volume offsets and sample pools
   so footsteps and hits don't sound robotic.
7. **Unlock on the first gesture.** Browsers start an `AudioContext` suspended;
   call `ctx.resume()` from the first `pointerdown`/`keydown`. Phaser does this
   for its own context automatically.
8. **Verify on real output.** Listen on headphones and speakers; check that the
   mix balances, ducking is audible but not pumping, and transitions land on the
   beat.

## Patterns

### 1. Bus graph and dB volume

```js
const ctx = new AudioContext();         // three.js: listener.context; Phaser: this.sound.context
const dbToGain = (db) => (db === -Infinity ? 0 : 10 ** (db / 20));

const limiter = ctx.createDynamicsCompressor();      // safety net, not the mixer
limiter.threshold.value = -1; limiter.ratio.value = 20;
limiter.attack.value = 0.003; limiter.release.value = 0.1;
const master = ctx.createGain();
master.connect(limiter).connect(ctx.destination);

const buses = {};
for (const name of ['music', 'sfx', 'ambience', 'ui', 'voice']) {
  buses[name] = ctx.createGain();
  buses[name].connect(master);
}
// Music gets a second gain stage reserved for ducking, so the settings slider
// and the ducker never overwrite each other.
const musicDuck = ctx.createGain();
buses.music.disconnect(); buses.music.connect(musicDuck).connect(master);

// Slider 0..1 -> -60..0 dB (0 = mute). Linear amplitude (gain = slider) feels
// like nothing happens until the bottom of the slider.
function setBusVolume(name, slider01) {
  const db = slider01 <= 0 ? -Infinity : (slider01 - 1) * 60;
  buses[name].gain.setTargetAtTime(dbToGain(db), ctx.currentTime, 0.02);
}
addEventListener('pointerdown', () => ctx.resume(), { once: true });
addEventListener('keydown', () => ctx.resume(), { once: true });
```

### 2. Ducking (music dips under voice or a big hit)

```js
// Fast attack so the music gets out of the way, slow release so it doesn't pump.
function duck(active, { depthDb = -12, attack = 0.05, release = 0.4 } = {}) {
  const g = musicDuck.gain, now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  // setTargetAtTime reaches ~95% after 3 time constants.
  g.setTargetAtTime(active ? dbToGain(depthDb) : 1, now, (active ? attack : release) / 3);
}
// voiceSource.onended = () => duck(false); duck(true); voiceSource.start();
```

### 3. SFX variation (kill the "machine gun" repeat)

```js
let lastPick = -1;
function playVaried(buffers, bus = 'sfx', { pitch = 0.06, volumeDb = 2 } = {}) {
  let i = Math.floor(Math.random() * buffers.length);
  if (buffers.length > 1 && i === lastPick) i = (i + 1) % buffers.length; // no exact repeat
  lastPick = i;
  const src = ctx.createBufferSource();
  src.buffer = buffers[i];
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch;     // +/- 6% pitch
  const g = ctx.createGain();
  g.gain.value = dbToGain((Math.random() * 2 - 1) * volumeDb);        // +/- 2 dB
  src.connect(g).connect(buses[bus]);
  src.onended = () => g.disconnect();   // ended one-shot nodes are garbage collected
  src.start();
}
```

### 4. Beat-synced events (quantize to the music grid)

```js
// Schedule on the audio clock, not frame time, so events land on the beat.
const BPM = 120, secPerBeat = 60 / BPM;
let musicStart = 0;                    // ctx.currentTime when the loop started
function nextBeatTime() {
  const t = ctx.currentTime - musicStart;
  return musicStart + Math.ceil(t / secPerBeat) * secPerBeat;
}
// stingerSource.start(nextBeatTime());  // sample-accurate
// For visuals, compare ctx.currentTime with nextBeatTime() each frame and
// subtract ctx.outputLatency (where supported) so flashes match what is heard.
```

### 5. Plugging the graph into three.js and Phaser

```js
// three.js: one AudioListener on the camera owns the context.
const listener = new THREE.AudioListener(); camera.add(listener);
// Use listener.context as `ctx` above, and send `master` into listener.getInput()
// instead of ctx.destination so the listener's volume still applies.
const sound = new THREE.Audio(listener);          // or PositionalAudio
sound.gain.disconnect(); sound.gain.connect(buses.sfx);   // route into a bus

// Phaser 4 (WebAudio mode): this.sound.context is the AudioContext and
// this.cache.audio.get(key) is the decoded AudioBuffer from this.load.audio.
// this.sound.volume is a single master volume; for buses and ducking, play
// through your own graph:
//   const buf = this.cache.audio.get('hit'); playVaried([buf], 'sfx');
```

## Pitfalls

- **Treating the slider as amplitude or as dB.** Map `0..1` across a dB range
  (Pattern 1). Raw amplitude feels dead until the bottom; raw dB values barely
  move.
- **Per-clip volume instead of buses** makes a global balance pass impossible.
- **Clipping the master.** Summed sounds exceed 0 dBFS and distort. Leave
  headroom; the limiter is a safety net, not the mixer.
- **Pumping ducking**: too-fast release or too-deep dip makes music breathe.
  Lengthen release; reduce depth.
- **Setting `.value` while automation is scheduled** is ignored or jumps. Use
  `cancelScheduledValues` + `setValueAtTime` before new ramps (Pattern 2).
- **Silent game on first load**: the context is still suspended. Resume it in
  the first input handler and show a "click to start" screen for audio-heavy
  games.
- **Looping a single music track** for the whole game feels flat. Use layers or
  segments that respond to state (see the reference).
- **Beat sync off frame time.** `requestAnimationFrame` deltas drift; use
  `ctx.currentTime`.
- **Many simultaneous voices**: cap concurrent copies of the same SFX (for
  example 4) so a burst of hits doesn't turn into noise.

## References

- `references/adaptive-music.md` — vertical layering vs horizontal re-sequencing,
  transition timing (bars/quantize), stingers, intensity mapping, and crossfades.

## Related skills

- `games:tools:phaser` — Phaser's sound manager and its AudioContext.
- `games:tools:threejs-scene` — where the AudioListener attaches to the camera.
