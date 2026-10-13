# Headless WebGPU testing and capture

## Launching a GPU browser

Bundled Playwright Chromium does not give a WebGPU adapter on macOS; use installed Chrome.

```js
// macOS
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true, // if no adapter appears, retry headed
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ deviceScaleFactor: 1 });
```

- Linux: headless Chrome has no WebGPU canvas. Run headed under `xvfb-run` with `--no-sandbox --enable-unsafe-webgpu --ignore-gpu-blocklist --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan --use-angle=vulkan --disable-frame-rate-limit --disable-gpu-vsync`.
- Agent sandboxes can hide the GPU adapter. Run browser checks outside the sandbox when it is missing.
- Assert `renderer.backend.isWebGPUBackend` in the page; the silent WebGL2 fallback otherwise makes "WebGPU" results meaningless.
- Headless rAF is capped near 30 Hz on macOS; never read fps from it (see `performance.md`).
- Vite fails with EPERM writing `node_modules/.vite-temp` when `node_modules` is a read-only symlink. Use `vite --configLoader runner` or a local `cacheDir`.

## Reading frames

- Scene passes advance once per browser frame (see `post-processing.md`). Put warm-up and captured renders on separate animation frames, or call the private `renderer._nodes.nodeFrame.update()` between them.
- Freshly built materials rendered a different first frame. Render once before capturing.
- On WebGL, copy the canvas synchronously after the last draw, before any `await`. Awaiting GPU timestamps first produced valid videos of black frames. Or create the renderer with `preserveDrawingBuffer: true`.
- WebCodecs: build each `VideoFrame` from CPU pixels (`getImageData`), not from the canvas. Canvas-backed frames stalled Chrome's encoder for 3–5.5 s. Flush when `encoder.encodeQueueSize >= 6`.
- Offline capture loop for deterministic video:
  ```js
  simStep(); renderFrame(1 / 60);
  await renderer.backend.device.queue.onSubmittedWorkDone();
  ```

## Parity

Matching output on WebGPU and WebGL2 does not prove correctness: a wrong chained `mix` argument order matched perfectly on both. Check key values against a CPU calculation. Turn off film grain for parity runs; identical runs differed by 1–2e-3 RMSE with grain and 0 without.
