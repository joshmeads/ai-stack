import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRegistry } from './core.ts';
import { doctor } from './doctor.ts';
import { Publisher } from './github.ts';
import { MacDriver } from './harness.ts';
import { freshRoot, redact, save } from './io.ts';
import { verify } from './verify.ts';
export function parse(args: string[]): { mode: 'doctor' | 'run'; output: string; pr: number; selfTest: boolean } {
  const mode = args[0];
  if (mode !== 'doctor' && mode !== 'run') throw new Error('Usage: verify.sh doctor --output /fresh/path | run --pr NUMBER [--self-test] --output /fresh/path');
  let output = '', pr = 0, selfTest = false;
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`); seen.add(arg);
    if (arg === '--self-test' && mode === 'run') selfTest = true;
    else if (arg === '--output' || arg === '--pr' && mode === 'run') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      if (arg === '--output') output = value;
      else { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('PR must be a positive integer'); pr = Number(value); }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!output || mode === 'run' && !pr) throw new Error('Output and (for run) PR are required');
  return { mode, output, pr, selfTest };
}
async function main(): Promise<void> {
  let root: string | undefined;
  try {
    const options = parse(process.argv.slice(2)), repository = resolve(import.meta.dir, '../../../..');
    root = await freshRoot(options.output, repository);
    if (options.mode === 'doctor') await doctor(root);
    else {
      const registry = validateRegistry(JSON.parse(await readFile(join(import.meta.dir, '../features/registry.json'), 'utf8')));
      const receipt = await verify({ pr: options.pr, selfTest: options.selfTest, root, registry, github: new Publisher(), driver: new MacDriver(), persist: r => save(join(root!, 'receipt.json'), r) });
      console.log(`Pinned ${receipt.sha}: live-gate=${receipt.status}; evidence ${receipt.commentUrl}`);
    }
    console.log(`Retained evidence: ${root}`);
  } catch (error) {
    const failure = redact(error instanceof Error ? error.message : String(error));
    if (root) await save(join(root, 'failure.json'), { result: 'failed', reason: failure });
    console.error(failure); process.exitCode = 1;
  }
}
if (import.meta.main) await main();
