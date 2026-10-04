import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { command, isolatedEnv, save, type Command } from './io.ts';
import { credentialSources, loginFix } from './isolation.ts';
import { HARNESSES, type CredentialSources } from './types.ts';

export async function doctor(root: string, run: Command = command, platform = process.platform, candidate = false, sources?: CredentialSources): Promise<void> {
  const report: Record<string, unknown> = { platform, candidate, date: new Date().toISOString(), skill: await realpath(join(import.meta.dir, '..')), checks: {} };
  const checks = report.checks as Record<string, string>;
  try {
    if (platform !== 'darwin') throw new Error('Live gate requires an operator Mac (Darwin)');
    if (candidate && sources) throw new Error('Candidate doctor cannot inspect source credentials');
    if (!candidate && !sources) throw new Error('Doctor requires --claude-config <dir> and --codex-home <dir>');
    const canonical = sources ? await credentialSources(sources) : undefined;
    const home = join(root, 'probe-home');
    for (const dir of ['tmp', '.claude', '.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
    const env = isolatedEnv(home);
    for (const binary of candidate ? ['bun', 'git', 'claude', 'codex'] : ['bun', 'git', 'claude', 'codex', 'gh']) checks[binary] = (await run([binary, '--version'], { env })).trim();
    const claude = await run(['claude', '--help'], { env });
    for (const flag of ['--plugin-dir', '--settings', '--setting-sources']) if (!claude.includes(flag)) throw new Error(`Claude isolation missing ${flag}`);
    checks.claudeHelp = claude;
    for (const args of [['codex', 'plugin', 'marketplace', 'add', '--help'], ['codex', 'plugin', 'add', '--help']]) {
      const help = await run(args, { env });
      if (!help.includes('--json')) throw new Error('Codex local plugin installation interface unavailable');
      if (args.includes('marketplace') && !/local path|local or Git|local marketplace/i.test(help)) throw new Error('Codex local marketplace interface unavailable');
      checks[args.join(' ')] = help;
    }
    if (canonical) {
      const authEnv = { ...env, CLAUDE_CONFIG_DIR: canonical.claude, CODEX_HOME: canonical.codex };
      for (const tool of HARNESSES) {
        const args = tool === 'claude' ? ['claude', 'auth', 'status', '--json'] : ['codex', 'login', 'status'];
        try {
          const output = await run(args, { env: authEnv });
          checks[args.join(' ')] = output;
          if (tool === 'claude' && JSON.parse(output)?.loggedIn !== true) throw new Error('Not logged in');
        } catch {
          throw new Error(`${tool} source authentication status failed; log in once with: ${loginFix(tool, canonical[tool])}`);
        }
      }
    }
    // Status checks report cached login state; authenticated native requests still need live proof.
    report.result = 'pass';
  } catch (error) {
    report.result = 'blocked'; report.reason = String(error);
    throw error;
  } finally { await save(join(root, 'doctor.json'), report); }
}
