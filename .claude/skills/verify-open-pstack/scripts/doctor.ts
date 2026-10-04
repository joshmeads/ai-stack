import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { command, isolatedEnv, save, type Command } from './io.ts';
import { selectedAccounts } from './isolation.ts';
import { HARNESSES, type Accounts } from './types.ts';

export async function doctor(root: string, run: Command = command, platform = process.platform, candidate = false, accounts?: Accounts): Promise<void> {
  const report: Record<string, unknown> = { platform, candidate, date: new Date().toISOString(), skill: await realpath(join(import.meta.dir, '..')), checks: {} };
  const checks = report.checks as Record<string, string>;
  try {
    if (platform !== 'darwin') throw new Error('Live gate requires an operator Mac (Darwin)');
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
    if (accounts) {
      if (candidate) throw new Error('Candidate doctor cannot inspect caam credentials');
      const parentEnv: Record<string, string> = {};
      for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'CAAM_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) if (process.env[key]) parentEnv[key] = process.env[key]!;
      selectedAccounts(await run(['caam', 'ls', '--json'], { env: parentEnv }), accounts);
      for (const tool of HARNESSES) {
        const restore = `caam add ${tool} ${accounts[tool]} --no-activate --force`;
        try {
          const output = await run(['caam', 'limits', tool, '--format', 'json'], { env: parentEnv });
          checks[`caam limits ${tool}`] = output;
          const rows = JSON.parse(output);
          if (!Array.isArray(rows)) throw new Error('Unknown caam limits schema; expected profile rows');
          const selected = rows.filter(row => row?.provider === tool && row?.profile_name === accounts[tool]);
          if (selected.length !== 1) throw new Error(`Missing or ambiguous caam limits result for ${tool}/${accounts[tool]}`);
          if (selected[0].credential_source?.state === 'expired') throw new Error('Credential copy expired');
          if (!selected[0].usage || typeof selected[0].usage !== 'object' || Array.isArray(selected[0].usage)) throw new Error('Missing caam limits usage result');
          const error = selected[0].usage.error;
          if (error !== undefined && typeof error !== 'string') throw new Error('Unknown caam limits error schema');
          if (error) throw new Error(error);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (/unauthori[sz]ed|expired|\b401\b|invalid[_ -](?:token|grant)/i.test(reason)) throw new Error(`caam ${tool}/${accounts[tool]} copy is unauthorized or expired; restore with: ${restore}`);
          throw new Error(`caam ${tool}/${accounts[tool]} copy health check failed: ${reason}`);
        }
      }
    }
    // PR resolution checks publisher authentication; a child surface doctor has no GitHub credentials.
    report.result = 'pass';
  } catch (error) {
    report.result = 'blocked'; report.reason = String(error);
    throw error;
  } finally { await save(join(root, 'doctor.json'), report); }
}
