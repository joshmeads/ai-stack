import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { loginFix } from './isolation.ts';
import type { Command } from './io.ts';
import type { CredentialSources, Harness } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<{ root: string; sources: CredentialSources }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-native-status-'))); roots.push(root);
  const sources = { claude: join(root, 'Claude source config'), codex: join(root, 'Codex source home') };
  for (const tool of ['claude', 'codex'] as const) {
    await mkdir(sources[tool], { mode: 0o700 });
    await writeFile(join(sources[tool], tool === 'claude' ? '.credentials.json' : 'auth.json'), JSON.stringify(
      tool === 'claude' ? { claudeAiOauth: { accessToken: 'doctor-claude-access', refreshToken: 'doctor-claude-refresh' } } : { tokens: { access_token: 'doctor-codex-access', refresh_token: 'doctor-codex-refresh', id_token: 'doctor-codex-id' } },
    ));
  }
  return { root, sources };
}
function runner(calls: string[][], result: (tool: Harness, options: Parameters<Command>[1]) => string = tool => tool === 'claude' ? '{"loggedIn":true}' : ''): Command {
  return async (args, options) => {
    calls.push(args);
    if (args.includes('--version')) return 'version';
    if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
    if (args.join(' ') === 'claude auth status --json' || args.join(' ') === 'codex login status') return result(args[0] as Harness, options);
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
}
function statusCalls(calls: string[][]): string[][] { return calls.filter(args => args.includes('status')); }

test('doctor validates explicit native config directories independently of profile infrastructure', async () => {
  const { root, sources } = await fixture(), calls: string[][] = [];
  const before = await Promise.all([readFile(join(sources.claude, '.credentials.json')), readFile(join(sources.codex, 'auth.json'))]);
  await doctor(root, runner(calls, (tool, options) => {
    expect(options?.env?.CLAUDE_CONFIG_DIR).toBe(sources.claude);
    expect(options?.env?.CODEX_HOME).toBe(sources.codex);
    expect(options?.env?.HOME === process.env.HOME).toBe(true);
    expect(options?.env?.USER === process.env.USER).toBe(true);
    expect(options?.env?.LOGNAME === process.env.LOGNAME).toBe(true);
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) expect(options?.env?.[key]).toBeUndefined();
    return tool === 'claude' ? '{"loggedIn":true}' : '';
  }), 'darwin', false, sources);
  expect(statusCalls(calls)).toEqual([['claude', 'auth', 'status', '--json'], ['codex', 'login', 'status']]);
  expect(calls.some(args => args[0] === 'caam' || args.includes('login') && !args.includes('status'))).toBe(false);
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
  expect(await Promise.all([readFile(join(sources.claude, '.credentials.json')), readFile(join(sources.codex, 'auth.json'))])).toEqual(before);
  expect(await Bun.file(join(root, 'probe-home/.claude/.credentials.json')).exists()).toBe(false);
  expect(await Bun.file(join(root, 'probe-home/.codex/auth.json')).exists()).toBe(false);
});

test.each(['{"loggedIn":false}', '{}', '[]', 'null', 'not JSON', '{"loggedIn":"true"}'])('doctor fails closed for negative or malformed Claude status: %s', async status => {
  const { root, sources } = await fixture(), calls: string[][] = [];
  await expect(doctor(root, runner(calls, () => status), 'darwin', false, sources)).rejects.toThrow(loginFix('claude', sources.claude));
  expect(statusCalls(calls)).toEqual([['claude', 'auth', 'status', '--json']]);
  const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
  expect(report.result).toBe('blocked'); expect(report.reason).toContain(loginFix('claude', sources.claude));
});

for (const tool of ['claude', 'codex'] as const) {
  test.each(['Not logged in', 'Unauthorized', 'Credentials expired', 'Command unavailable'])('doctor gives generic manual login guidance for ' + tool + ': %s', async error => {
    const { root, sources } = await fixture(), calls: string[][] = [];
    const run = runner(calls, provider => {
      if (provider === tool) throw new Error(error);
      return '{"loggedIn":true}';
    });
    await expect(doctor(root, run, 'darwin', false, sources)).rejects.toThrow(loginFix(tool, sources[tool]));
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
    expect(calls.some(args => args[0] === 'caam' || args.includes('login') && !args.includes('status'))).toBe(false);
  });
}

test('Codex login status accepts an empty stdout on successful exit', async () => {
  const { root, sources } = await fixture(), calls: string[][] = [];
  await doctor(root, runner(calls), 'darwin', false, sources);
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).checks['codex login status']).toBe('');
});

test('parent doctor requires sources, and missing directories or files block before native commands', async () => {
  const { root, sources } = await fixture(), calls: string[][] = [];
  await expect(doctor(root, runner(calls), 'darwin')).rejects.toThrow('--claude-config <dir> and --codex-home <dir>');
  const missing = { ...sources, claude: join(root, 'missing source') };
  await expect(doctor(root, runner(calls), 'darwin', false, missing)).rejects.toThrow(loginFix('claude', missing.claude));
  await rm(join(sources.codex, 'auth.json'));
  await expect(doctor(root, runner(calls), 'darwin', false, sources)).rejects.toThrow(loginFix('codex', sources.codex));
  expect(calls).toEqual([]);
});

test('candidate doctor is capabilities-only and refuses credential-source inspection', async () => {
  const { root, sources } = await fixture(), calls: string[][] = [];
  await doctor(root, runner(calls), 'darwin', true);
  expect(statusCalls(calls)).toEqual([]); expect(calls.some(args => args[0] === 'gh')).toBe(false);
  const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
  expect(report.result).toBe('pass'); expect(report.candidate).toBe(true);
  await expect(doctor(root, runner(calls), 'darwin', true, sources)).rejects.toThrow('cannot inspect source credentials');
});
