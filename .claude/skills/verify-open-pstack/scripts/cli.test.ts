import { expect, test } from 'bun:test';
import { parse } from './cli.ts';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import type { Command } from './io.ts';
import type { GitHub } from './types.ts';
import { REPO } from './types.ts';
import { verify } from './verify.ts';
import { validateRegistry } from './core.ts';
import registry from '../features/registry.json';
const sources = ['--claude-config', '/operator/claude config', '--codex-home', '/operator/codex home'];

test('publisher revision is recorded independently of candidate proof', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-publisher-revision-')));
  const candidate = 'a'.repeat(40), base = 'b'.repeat(40), publisherRevision = 'c'.repeat(40);
  const github: GitHub = {
    async pull() { return { number: 111, head: { sha: candidate }, base: { sha: base }, state: 'open', headRepo: REPO }; },
    async files() { return [{ filename: 'README.md' }]; },
    async comment() { return `https://github.com/${REPO}/pull/111#issuecomment-1`; },
    async status() {},
  };
  try {
    const receipt = await verify({ pr: 111, selfTest: false, root, publisherRevision, registry: validateRegistry(registry), github,
      driver: { async prepare() { throw new Error('Docs must not prepare harnesses'); }, async exercise() { throw new Error('Docs must not exercise harnesses'); } }, persist: async () => {} });
    expect(receipt.sha).toBe(candidate);
    expect(receipt.publisherRevision).toBe(publisherRevision);
    expect(receipt.publisherRevision).not.toBe(receipt.sha);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('candidate mode is an explicit doctor-only flag', () => {
  expect(parse(['doctor', '--candidate', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: true });
  expect(() => parse(['doctor', '--candidate', '--candidate', '--output', '/fresh/probe'])).toThrow('Duplicate option');
  expect(() => parse(['run', '--candidate', '--pr', '111', '--output', '/fresh/run', ...sources])).toThrow('Unknown option');
});
test('candidate doctor probes only help and versions with private roots already present', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-doctor-'))), calls: string[][] = [];
  const run: Command = async (args, options = {}) => {
    calls.push(args);
    const env = options.env!;
    expect(env.HOME === process.env.HOME).toBe(true);
    expect(env.USER === process.env.USER).toBe(true);
    expect(env.LOGNAME === process.env.LOGNAME).toBe(true);
    for (const key of ['TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'GH_CONFIG_DIR']) {
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
    expect(calls.some(args => args[0] === 'gh')).toBe(false);
    expect(calls.some(args => args.includes('auth') || args.includes('login'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('CLI strictly validates run inputs and permits read-only child doctor', () => {
  expect(parse(['doctor', '--candidate', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: true });
  expect(parse(['run', '--pr', '123', '--self-test', '--output', '/fresh/run', ...sources])).toEqual({ mode: 'run', output: '/fresh/run', pr: 123, selfTest: true, claudeConfig: sources[1], codexHome: sources[3] });
  for (const args of [[], ['wat'], ['run', '--pr', '0', '--output', '/tmp/a', ...sources], ['run', '--pr', '1.5', '--output', '/tmp/a', ...sources], ['run', '--pr', '9007199254740992', '--output', '/tmp/a', ...sources], ['doctor', '--pr', '1', '--output', '/tmp/a'], ['doctor', '--output', '/tmp/a', '--output', '/tmp/b'], ['run', '--pr', '1', ...sources], ['doctor', '--output', '--self-test'], ['doctor', '--output', '/tmp/a', '--publish']]) expect(() => parse(args)).toThrow();
});
test('run and parent doctor require paired credential directories; candidate doctor rejects sources', () => {
  const run = ['run', '--pr', '111', '--output', '/fresh/run'];
  const parent = ['doctor', '--output', '/fresh/probe'];
  expect(() => parse(run)).toThrow('Run requires --claude-config and --codex-home');
  expect(() => parse(parent)).toThrow('Doctor requires both --claude-config and --codex-home');
  expect(() => parse([...run, ...sources.slice(0, 2)])).toThrow('Run requires');
  expect(() => parse([...run, ...sources.slice(2)])).toThrow('Run requires');
  expect(parse([...parent, ...sources])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: false, claudeConfig: sources[1], codexHome: sources[3] });
  expect(() => parse([...parent, '--candidate', ...sources])).toThrow('Candidate doctor cannot inspect source credentials');
  for (const option of ['--claude-config', '--codex-home']) {
    expect(() => parse([...parent, option, '/operator/config'])).toThrow('requires both');
    expect(() => parse([...parent, '--candidate', option, '/operator/config'])).toThrow('Candidate doctor cannot inspect source credentials');
    for (const mode of [run, parent]) {
      expect(() => parse([...mode, ...sources, option, '/other/config'])).toThrow('Duplicate option');
      expect(() => parse([...mode, option])).toThrow('Missing value');
      expect(() => parse([...mode, option, '--output'])).toThrow('Missing value');
      expect(() => parse([...mode, option, ''])).toThrow('Missing value');
    }
  }
});
test('credential options accept directory paths and reject NUL paths and obsolete account options', () => {
  for (const option of ['--claude-config', '--codex-home']) {
    const other = option === '--claude-config' ? '--codex-home' : '--claude-config';
    for (const mode of [['run', '--pr', '111'], ['doctor']]) {
      const args = [...mode, '--output', '/fresh/run', other, '/operator/config', option];
      expect(() => parse([...args, '/operator/config\0suffix'])).toThrow(`Invalid credential directory: ${option}`);
      for (const directory of ['/operator/config with spaces', './preauthenticated-config']) {
        const result = parse([...args, directory]);
        expect(option === '--claude-config' ? result.claudeConfig : result.codexHome).toBe(directory);
      }
    }
  }
  for (const option of ['--claude-account', '--codex-account']) {
    expect(() => parse(['run', '--pr', '111', '--output', '/fresh/run', ...sources, option, 'person@example.com'])).toThrow(`Unknown option: ${option}`);
  }
});
