# Adaptive (dynamic) music

Adaptive music changes with gameplay instead of looping one track. Two techniques
dominate, and they combine:

- **Vertical layering (re-orchestration)** — several stems (drums, bass, melody,
  tension pad) play in sync; you fade layers in/out to change intensity without
  changing the underlying loop. Seamless because all layers share the same
  timeline.
- **Horizontal re-sequencing** — the track is split into segments (intro, loop A,
  loop B, combat, outro); you switch which segment plays next, transitioning at
  musical boundaries (bar/phrase) so the change lands on beat.

## Vertical layering

All layers are the same length and start together; only their volumes change.

```js
// Stems share one start time so they stay sample-aligned; only gains change.
// `ctx`, `buses`, `dbToGain` come from Pattern 1 in SKILL.md; stems are decoded AudioBuffers.
function startLayers(stems /* { base, drums, tension } */) {
  const at = ctx.currentTime + 0.1;               // schedule all to the same instant
  const layers = {};
  for (const [name, buffer] of Object.entries(stems)) {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const g = ctx.createGain();
    g.gain.value = name === 'base' ? 1 : 0;        // only the base layer starts audible
    src.connect(g).connect(buses.music);
    src.start(at);
    layers[name] = g;
  }
  return layers;
}

function setIntensity(layers, level /* 0 calm .. 2 combat */, fade = 0.8) {
  const now = ctx.currentTime;
  const target = { drums: level >= 1 ? 1 : 0, tension: level >= 2 ? 1 : 0 };
  for (const [name, gain] of Object.entries(target)) {
    const g = layers[name].gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(gain, now + fade);
  }
}
```

Tips: author stems at the same BPM/length and bounce them aligned. Fades of
~0.5–1.5 s feel musical; instant cuts feel mechanical. Because layers never
restart, intensity can change any time without losing sync.

## Horizontal re-sequencing

Switch segments at safe musical points so transitions don't sound abrupt.

```js
// Queue a section change and start it exactly on the next bar boundary.
const BPM = 120, BEATS_PER_BAR = 4, secPerBar = (60 / BPM) * BEATS_PER_BAR;
let current = null;                       // { src, gain, startedAt }

function playSection(buffer, at = ctx.currentTime + 0.05, xfade = 0.2) {
  const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(1, at + xfade);
  src.connect(gain).connect(buses.music); src.start(at);
  if (current) {                          // fade the old section out across the seam
    current.gain.gain.setValueAtTime(1, at);
    current.gain.gain.linearRampToValueAtTime(0, at + xfade);
    current.src.stop(at + xfade + 0.05);
  }
  current = { src, gain, startedAt: at };
}

function requestSection(buffer) {
  if (!current) return playSection(buffer);
  const elapsed = ctx.currentTime - current.startedAt;
  const nextBar = current.startedAt + Math.ceil(elapsed / secPerBar) * secPerBar;
  playSection(buffer, nextBar);           // scheduled on the audio clock, not a timer
}
```

Transition strategies, roughly increasing in polish:

- **Immediate crossfade** — quick volume blend; fine for low-stakes changes.
- **Quantized switch** — wait for the next beat/bar/phrase, then switch. The
  default for music that should stay "in time".
- **Transition segments** — short bridge clips written to connect A→B musically.
- **Stingers** — one-shot musical accents layered over the bed for events (boss
  appears, secret found) without altering the loop.

## Mapping gameplay to intensity

Drive the music from a small, smoothed intensity value rather than raw events:

```js
// Combine signals into 0..1, smooth it, then map to levels with hysteresis.
let intensity = 0;
function intensityFromState(enemiesNear, playerHp01) {
  const raw = Math.min(enemiesNear / 5, 1) * (1 - 0.4 * playerHp01);
  intensity += (raw - intensity) * 0.05;   // smooth so it doesn't flicker
  return intensity;
}

// Hysteresis: different thresholds up vs down so the music doesn't oscillate
// when intensity hovers at a boundary.
function levelFromIntensity(i, current) {
  if (current < 1 && i > 0.6) return 1;
  if (current >= 1 && i < 0.4) return 0;
  return current;
}
```

## Practical notes

- **Drive timing from the audio clock**, not frame delta, and account for output
  latency when scheduling.
- **Loop points** must be sample-accurate; gaps or clicks betray the seam. Author
  loops to bar boundaries and test the wrap.
- **Budget**: many simultaneous stems cost voices and memory. Stream long music;
  keep stem counts modest on low-end targets.
