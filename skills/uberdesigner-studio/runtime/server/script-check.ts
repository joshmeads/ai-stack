// Which scripts a file holds, and whether each one is a module, so they can be parsed after a change (part.ts) and
// by verify.mjs with the same answer. Plain text work, no imports.
//
// An HTML file: its inline <script> blocks, leaving out data blocks (type="application/json", a shader's
// type="x-shader/…"). A .js or .mjs file: itself. A script is a module when it says so (type="module", .mjs) or when
// it has an import or export statement: a .js file with "export default" (a Cloudflare worker, say) is a module, and
// parsing it as a classic script would report an error that isn't one.

export type FoundScript = { code: string; module: boolean; name: string };

const usesModules = (code: string) => /^\s*(import|export)\s/m.test(code);

export function scriptsIn(file: string, text: string): FoundScript[] {
  if (/\.html?$/.test(file))
    return [...text.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((m) => !/type=["']?(?!module|text\/javascript)[\w/+-]+/i.test(m[1]))
      .map((m, i) => ({ code: m[2], module: /type=["']?module/i.test(m[1]), name: `${file} script ${i + 1}` }));
  if (/\.m?js$/.test(file)) return [{ code: text, module: file.endsWith(".mjs") || usesModules(text), name: file }];
  return [];
}
