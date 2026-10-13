# WebGPU and WebGL2 backends

`WebGPURenderer` runs the same TSL on WebGPU or a WebGL2 fallback, with different capabilities. Verified on three r186.

## Compute on WebGL2

- TSL compute on WebGL2 is transform feedback only: no storage buffers, atomics, subgroups, or indirect dispatch (the count falls back to `computeNode.count`). Barriers compile to a comment. Gate those features on `backend.isWebGPUBackend` and give WebGL2 a ping-pong path.
- A WebGL2 compute kernel keyed by `instanceIndex` needs `StorageInstancedBufferAttribute`. With a plain `StorageBufferAttribute`, `gl_InstanceID` is always 0, every result lands in slot 0, and the readback still succeeds.
- `renderer.compileAsync(scene, camera)` does not warm compute. Use `renderer.compileComputeAsync(node)` or one `computeAsync()` at init.

## Limits

| Limit | WebGPU | WebGL2 | Workaround |
| --- | --- | --- | --- |
| Vertex buffers | 8 guaranteed; each separate attribute uses one | n/a | Interleave per-instance fields |
| Vertex attributes | 16 | 16 | Move static parameters into a float data texture read with `textureLoad` |
| Inter-stage varyings | 16 locations | similar | Pack into vec4 varyings |
| Point size | always 1 px; `PointsMaterial.size` ignored | honored | Instanced quads or `SpriteNodeMaterial` |
| Float render targets | yes | needs `EXT_color_buffer_float`, which three requests but does not enforce | Check the extension before HDR |
| GPU timer | `timestamp-query`, unreliable on Apple | no usable timer on ANGLE-Metal | Fenced frame time (`performance.md`) |

Interleaved instance data works on both backends:

```js
const data = new InstancedInterleavedBuffer(new Float32Array(capacity * 16), 16, 1);
geometry.setAttribute('aSpawn', new InterleavedBufferAttribute(data, 4, 0));
geometry.setAttribute('aVel',   new InterleavedBufferAttribute(data, 4, 4));
// TSL: attribute('aSpawn', 'vec4')
```

## Readback

- `readRenderTargetPixelsAsync` returns rows bottom-first on WebGL and top-first on WebGPU, and WebGPU pads each row to 256 bytes. Strip the padding, and flip when `renderer.coordinateSystem === WebGLCoordinateSystem`.
- `getArrayBufferAsync` offsets and counts must be multiples of 4. On WebGL it uses a synchronous `getBufferSubData` that stalls.

## Environment

- `requestAdapter({ powerPreference: 'high-performance' })` can return null on hybrid integrated-plus-NVIDIA Linux machines. Retry with plain `requestAdapter()`.
- After WebGPU context creation fails on a canvas, the WebGL2 fallback on the same canvas can also fail (`getSupportedExtensions` of null). Use a fresh canvas.

## Seen in practice

- Two shadow-casting directional lights plus a reflector produced WebGPU validation errors about destroyed shadow textures. One shadow light avoided it. The shadow-map god-rays addon sampled disposed textures after a quality switch; rebuild it on quality changes.
- `GTAONode` needed a single-sample depth texture.
- WebGL2 warns "Shared depth texture is not supported with MSAA" when passes share a `DepthTexture` with antialiasing. Output still matched WebGPU.
- `LineSegments` overlays drew almost nothing in headless WebGPU on Metal with MSAA (cause not found). Draw debug overlays with the same pipeline as real content.
