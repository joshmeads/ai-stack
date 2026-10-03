import { expect, test } from 'bun:test';
import { parse } from './cli.ts';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import type { Command } from './io.ts';
const accounts = ['--claude-account', 'eric@litman.org', '--codex-account', 'eric@healthspanners.com'];
test('candidate mode is an explicit doctor-only flag', () => {
  expect(parse(['doctor', '--candidate', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: true });
  expect(() => parse(['doctor', '--candidate', '--candidate', '--output', '/fresh/probe'])).toThrow('Duplicate option');
  expect(() => parse(['run', '--candidate', '--pr', '111', '--output', '/fresh/run', ...accounts])).toThrow('Unknown option');
});
test('candidate doctor probes only help and versions with private roots already present', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-doctor-'))), calls: string[][] = [];
  const run: Command = async (args, options = {}) => {
    calls.push(args);
    const env = options.env!;
    for (const key of ['HOME', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'GH_CONFIG_DIR']) {
      expect(env[key]!.startsWith(root + '/probe-home')).toBe(true);
      const info = await stat(env[key]!);
      expect(info.isDirectory()).toBe(true);
      expect(info.mode & 0o777).toBe(0o700);
    }
    return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
  };
  try {
    await doctor(root, run, 'darwin', true);
    const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
    expect(report.candidate).toBe(true); expect(report.result).toBe('pass');
    expect(Object.keys(report.checks)).toEqual(['bun', 'git', 'claude', 'codex', 'claudeHelp', 'codex plugin marketplace add --help', 'codex plugin add --help']);
    expect(calls.every(args => args.includes('--version') || args.includes('--help'))).toBe(true);
    expect(calls.some(args => ['gh', 'caam', '/usr/bin/sandbox-exec'].includes(args[0]!))).toBe(false);
    expect(calls.some(args => args.includes('auth') || args.includes('login'))).toBe(false);
    await doctor(root, run, 'darwin');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).candidate).toBe(false);
    expect(calls.some(args => args[0] === 'gh' && args[1] === '--version')).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('CLI strictly validates run inputs and permits read-only child doctor', () => {
  expect(parse(['doctor', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: false });
  expect(parse(['run', '--pr', '123', '--self-test', '--output', '/fresh/run', ...accounts])).toEqual({ mode: 'run', output: '/fresh/run', pr: 123, selfTest: true, claudeAccount: 'eric@litman.org', codexAccount: 'eric@healthspanners.com' });
  for (const args of [[], ['wat'], ['run', '--pr', '0', '--output', '/tmp/a', ...accounts], ['run', '--pr', '1.5', '--output', '/tmp/a', ...accounts], ['doctor', '--pr', '1', '--output', '/tmp/a'], ['doctor', '--output', '/tmp/a', '--output', '/tmp/b'], ['run', '--pr', '1', ...accounts], ['doctor', '--output', '--self-test'], ['doctor', '--output', '/tmp/a', '--publish']]) expect(() => parse(args)).toThrow();
});
test('run requires both explicit account choices without defaults or doctor account options', () => {
  const run = ['run', '--pr', '111', '--output', '/fresh/run'];
  expect(() => parse(run)).toThrow('Run requires --claude-account and --codex-account');
  expect(() => parse([...run, ...accounts.slice(0, 2)])).toThrow('Run requires');
  expect(() => parse([...run, ...accounts.slice(2)])).toThrow('Run requires');
  for (const option of ['--claude-account', '--codex-account']) {
    expect(() => parse(['doctor', '--output', '/fresh/probe', option, 'eric@litman.org'])).toThrow('Unknown option');
    expect(() => parse([...run, ...accounts, option, 'eric@mobilyze.com'])).toThrow('Duplicate option');
    expect(() => parse([...run, option])).toThrow('Missing value');
    expect(() => parse([...run, option, '--self-test'])).toThrow('Missing value');
  }
});
test('account choices are bounded emails rather than vault paths or arbitrary strings', () => {
  for (const option of ['--claude-account', '--codex-account']) {
    const other = option === '--claude-account' ? '--codex-account' : '--claude-account';
    const args = ['run', '--pr', '111', '--output', '/fresh/run', other, 'eric@litman.org', option];
    for (const account of ['../eric@litman.org', 'claude/eric@litman.org', 'eric\\@litman.org', 'eric@../litman.org', 'eric@litman..org', 'eric', ' eric@litman.org', 'eric@litman.org\n', '@litman.org', 'eric@litman', 'x'.repeat(65) + '@litman.org', 'x@' + 'a.'.repeat(127) + 'org']) expect(() => parse([...args, account])).toThrow('Account must be a safe email');
    const result = parse([...args, 'eric+verification@litman.org']);
    expect(result.mode).toBe('run');
    if (result.mode === 'run') expect(option === '--claude-account' ? result.claudeAccount : result.codexAccount).toBe('eric+verification@litman.org');
  }
});
