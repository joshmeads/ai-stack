# Quality governance — budget, telemetry, scorecard

Quality is not declared, it is measured. Every 3D experience declares its budgets before writing code and verifies them in audit. Numbers verified against public R3F/Three.js best-practice references and award-winning studio scorecards (see CREDITS.md).

## GPU budget per use case

| Use case | Draw calls | Triangles | Max DPR | Shadows |
|---|---|---|---|---|
| Hero / landing | < 100 | < 100k | 1.5 | 1 directional |
| Product configurator | < 250 | < 300k | 2 | 2 |
| 3D dashboard | < 150 | < 150k | 1.5 | 0-1 |
| Mobile (any) | halve all | halve all | 1.5 | never PointLight |

## Alarm thresholds (renderer.info)

| Metric | Target | Warning | Critical |
|---|---|---|---|
| Draw calls | < 100 | 100-500 | > 500 |
| Triangles | < 1M | 1-3M | > 3M |
| Loaded textures | < 50 | 50-200 | > 200 |
| Shader programs | < 20 | 20-50 | > 50 |
| Frame time | < 16.6ms | 16.6-33ms | > 33ms |

`programs.length` is the count of unique material combinations: if it explodes you have a shader-variant explosion (too many materials with different defines). If `memory.geometries` or `memory.textures` **grow continuously** in use, it is a leak (missing dispose). Leak thresholds: textures > 100, geometries > 500 without reason.

## Core Web Vitals (production budget)

JS bundle per 3D chunk < 150KB gzip; hero model < 500KB (never > 2MB on mobile); textures < 1MB each in KTX2; FCP < 1.8s, LCP < 2.5s, TTI < 3s; Lighthouse Performance >= 85 desktop, >= 70 mobile. Lazy-mount the Canvas with IntersectionObserver (never mount WebGL off-viewport), progressive low-res -> high-res loading with low-res disposed.

## Quality profiles (device detection)

Detection: `navigator.hardwareConcurrency <= 4`, `navigator.deviceMemory < 4`, and real GPU via `WEBGL_debug_renderer_info` (`UNMASKED_RENDERER_WEBGL` — also useful in telemetry). Map to the QUALITY tiers from canvas-architecture.md:

| Profile | pixelRatio | Max texture | Shadows | Post |
|---|---|---|---|---|
| high | 2 | 2048 | on (2048) | full |
| medium | 1.5 | 1024 | on (1024) | reduced (2-3 passes) |
| low | 1 | 512 | off | off |

In R3F do not reinvent the wheel: `PerformanceMonitor` (regress/onDecline/onIncline -> drop DPR / pass tier) and drei `AdaptiveDpr`/`AdaptiveEvents` already do adaptive scaling with hysteresis. Our `QualityGovernor` (see state-management.md) orchestrates them and persists the chosen tier.

## Production telemetry

`renderer.info` is the first tool: `render.calls`, `render.triangles`, `memory.geometries/textures`, `programs.length`. Dev: stats-gl (not stats.js), Spector.js for frame capture. Prod: sample frame time and draw calls once per session (after idle) and send a metrics payload to an endpoint together with GPU vendor/renderer and the active quality tier. Local GPU-loss debug: `WEBGL_lose_context` extension.

## Context loss (mandatory on mobile)

```ts
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); /* pause loop, UI fallback */ })
canvas.addEventListener('webglcontextrestored', () => { /* recreate GPU resources, invalidate */ })
```

Without `preventDefault()` the restore never arrives. Degradation chain: WebGPU -> WebGL2 -> static fallback (image/DOM). The static fallback must **always** exist; it is not a nice-to-have.

## Audit scorecard (threshold 88/100, one line of evidence per entry)

A 3D adaptation of the UI-Max scorecard. Before returning "done" code, fill each entry with one line of evidence:

| Entry | Points | Criterion |
|---|---|---|
| A11Y-01 | 14 | `prefers-reduced-motion` gated, DOM equivalent for critical functions, AA contrast |
| MOTION-01 | 12 | coherent easing/offset/delay (stagger 40-140ms, never opacity-only) |
| MOTION-02 | 10 | three motion layers (primary, follow-through, ambient) |
| LAYOUT-01 | 12 | intentional first-viewport composition, no absolute text in fixed-height |
| DEPTH-01 | 12 | >= 2 depth techniques tied to scroll/pointer (hierarchical parallax) |
| PERF-01 | 12 | budgets above respected, DPR capped, zero allocations in useFrame |
| 3D-01 | 10 | full dispose (12-slot texture), no growing leak counter |
| 3D-02 | 8 | ordered post chain (GTAO -> Bloom -> grading -> ToneMapping), HalfFloat |
| RESP-01 | 10 | tested at 375 / 768 / 1440px |
| BRAND-01 | 8 | domain-fit: no generic "dark neon" off-brand |

Below 88 you do not ship. Above 88 without per-entry evidence is just as invalid.
