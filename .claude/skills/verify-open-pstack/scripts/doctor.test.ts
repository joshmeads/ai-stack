import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import type { Command } from './io.ts';
import type { Harness } from './types.ts';

const roots: string[] = [];
const accounts = { claude: 'claude@example.com', codex: 'codex@example.com' };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pstack-health-')); roots.push(root); return root;
}
function runner(calls: string[][], result: (tool: Harness) => string): Command {
  return async args => {
    calls.push(args);
    if (args.includes('--version')) return 'version';
    if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
    if (args.join(' ') === 'caam ls --json') return JSON.stringify({ profiles: ['claude', 'codex'].map(tool => ({ tool, name: accounts[tool as Harness], identity: { email: accounts[tool as Harness] }, active: true })) });
    if (args[0] === 'caam' && args[1] === 'limits') return result(args[2] as Harness);
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
}
function healthy(tool: Harness): object[] {
  return [{ provider: tool, profile_name: accounts[tool], usage: {} }, { provider: tool, profile_name: 'unselected@example.com', usage: { error: 'Unauthorized' } }];
}

test('doctor allows daily-active accounts and checks only selected provider/profile results', async () => {
  const root = await fixture(), calls: string[][] = [];
  await doctor(root, runner(calls, tool => JSON.stringify(healthy(tool))), 'darwin', false, accounts);
  expect(calls.filter(args => args[0] === 'caam')).toEqual([
    ['caam', 'ls', '--json'], ['caam', 'limits', 'claude', '--format', 'json'], ['caam', 'limits', 'codex', '--format', 'json'],
  ]);
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
});

for (const tool of ['claude', 'codex'] as const) {
  test.each(['HTTP 401', 'Unauthorized', 'OAuth credential expired', 'invalid_grant'])('doctor gives manual %s repair for selected ' + tool + ' result', async error => {
    const root = await fixture(), calls: string[][] = [];
    const run = runner(calls, provider => JSON.stringify(provider === tool ? [{ provider, profile_name: accounts[provider], usage: { error } }] : healthy(provider)));
    const restore = `caam add ${tool} ${accounts[tool]} --no-activate --force`;
    await expect(doctor(root, run, 'darwin', false, accounts)).rejects.toThrow(restore);
    const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
    expect(report.result).toBe('blocked'); expect(report.reason).toContain(restore);
    expect(calls.some(args => ['add', 'activate', 'login'].includes(args[1]!))).toBe(false);
  });
}

test('doctor catches command-level credential failures and expired credential-source state', async () => {
  for (const failCommand of [false, true]) {
    const root = await fixture(), calls: string[][] = [];
    const run = runner(calls, tool => {
      if (failCommand) throw new Error('caam limits: HTTP 401 Unauthorized');
      return JSON.stringify([{ provider: tool, profile_name: accounts[tool], credential_source: { state: 'expired' } }]);
    });
    await expect(doctor(root, run, 'darwin', false, accounts)).rejects.toThrow('caam add claude claude@example.com --no-activate --force');
  }
});

test.each(['not JSON', '{}', '[]', '[{"provider":"codex","profile_name":"claude@example.com","usage":{}}]', '[{"provider":"claude","profile_name":"claude@example.com","usage":null}]', '[{"provider":"claude","profile_name":"claude@example.com","usage":{"error":"Network unavailable"}}]'])('doctor fails closed on unavailable or malformed selected health: %s', async output => {
  const root = await fixture(), calls: string[][] = [];
  await expect(doctor(root, runner(calls, () => output), 'darwin', false, accounts)).rejects.toThrow('health check failed');
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
});
