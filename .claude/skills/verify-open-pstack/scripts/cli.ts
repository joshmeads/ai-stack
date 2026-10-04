import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRegistry } from './core.ts';
import { doctor } from './doctor.ts';
import { Publisher } from './github.ts';
import { MacDriver } from './harness.ts';
import { command, freshRoot, interruption, interruptCommands, save } from './io.ts';
import { verify } from './verify.ts';
type Options = { mode: 'doctor'; output: string; pr: number; selfTest: boolean; candidate: boolean; claudeConfig?: string; codexHome?: string }
  | { mode: 'run'; output: string; pr: number; selfTest: boolean; claudeConfig: string; codexHome: string };
export function parse(args: string[]): Options {
  const mode = args[0];
  if (mode !== 'doctor' && mode !== 'run') throw new Error('Usage: verify.sh doctor (--candidate | --claude-config DIR --codex-home DIR) --output /fresh/path | run --pr NUMBER --claude-config DIR --codex-home DIR [--self-test] --output /fresh/path');
  let output = '', pr = 0, selfTest = false, candidate = false, claudeConfig = '', codexHome = '';
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`); seen.add(arg);
    if (arg === '--self-test' && mode === 'run') selfTest = true;
    else if (arg === '--candidate' && mode === 'doctor') candidate = true;
    else if (['--output', '--claude-config', '--codex-home'].includes(arg) || mode === 'run' && arg === '--pr') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      if (arg === '--output') output = value;
      else if (arg === '--pr') { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('PR must be a positive integer'); pr = Number(value); }
      else {
        if (value.includes('\0')) throw new Error(`Invalid credential directory: ${arg}`);
        if (arg === '--claude-config') claudeConfig = value; else codexHome = value;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!output || mode === 'run' && !pr) throw new Error('Output and (for run) PR are required');
  if (mode === 'run') {
    if (!claudeConfig || !codexHome) throw new Error('Run requires --claude-config and --codex-home');
    return { mode, output, pr, selfTest, claudeConfig, codexHome };
  }
  if (candidate && (claudeConfig || codexHome)) throw new Error('Candidate doctor cannot inspect source credentials');
  if (!candidate && (!claudeConfig || !codexHome)) throw new Error('Doctor requires both --claude-config and --codex-home');
  return { mode, output, pr, selfTest, candidate, ...(claudeConfig ? { claudeConfig, codexHome } : {}) };
}
async function main(): Promise<void> {
  let root: string | undefined, interrupted: 'SIGINT' | 'SIGTERM' | undefined;
  const onInterrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interrupted ??= signal;
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
    void interruptCommands(signal).catch(() => {
      console.error('Failed to stop active verifier commands; inspect retained evidence.'); process.exitCode = 1;
    });
  };
  const onInt = (): void => onInterrupt('SIGINT'), onTerm = (): void => onInterrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const options = parse(process.argv.slice(2)), repository = resolve(import.meta.dir, '../../../..');
    root = await freshRoot(options.output, repository);
    if (options.mode === 'doctor') await doctor(root, undefined, undefined, options.candidate, options.claudeConfig && options.codexHome ? { claude: options.claudeConfig, codex: options.codexHome } : undefined);
    else {
      const publisherRevision = (await command(['git', 'rev-parse', 'HEAD'], { cwd: repository })).trim();
      const registry = validateRegistry(JSON.parse(await readFile(join(import.meta.dir, '../features/registry.json'), 'utf8')));
      const receipt = await verify({ pr: options.pr, selfTest: options.selfTest, root, registry, github: new Publisher(), driver: new MacDriver(undefined, undefined, { claude: options.claudeConfig, codex: options.codexHome }), persist: r => save(join(root!, 'receipt.json'), r), publisherRevision });
      console.log(`Pinned ${receipt.sha}: live-gate=${receipt.status}; evidence ${receipt.commentUrl}`);
    }
    interruption.signal.throwIfAborted();
    console.log(`Retained evidence: ${root}`);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (root) await save(join(root, 'failure.json'), { result: 'failed', reason: failure });
    console.error(root ? 'Verification failed; inspect retained failure.json.' : 'Verification failed before evidence could be retained.');
    process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  } finally {
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
}
if (import.meta.main) await main();
