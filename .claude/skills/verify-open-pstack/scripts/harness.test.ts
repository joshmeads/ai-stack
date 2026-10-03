import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { codexInstallation, launch, MacDriver, verifyCodexEnabled, verifyProjectDoctor } from './harness.ts';
import { newReceipt } from './core.ts';
import { freshRoot, isolatedEnv, redact, retainedFile, treeHash, type Command } from './io.ts';
const roots: string[] = [];
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'pstack-test-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('isolated harness boundaries', () => {
  test('candidate environment never carries publisher credentials or daily config', () => {
    process.env.GH_TOKEN = 'test-publisher-token'; process.env.CODEX_HOME = '/daily/codex';
    process.env.CLAUDE_CONFIG_DIR = '/daily/claude';
    const oldAnthropic = process.env.ANTHROPIC_API_KEY, oldOpenai = process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'daily-anthropic'; process.env.OPENAI_API_KEY = 'daily-openai';
    try {
      for (const harness of ['claude', 'codex'] as const) {
        const env = isolatedEnv('/run/home', harness);
        expect(env.GH_TOKEN).toBeUndefined(); expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
        expect(process.env.HOME).toBe(env.HOME); expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        expect(env.TMPDIR).toBe('/run/home/tmp');
        expect(env[harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']).toBe('/run/home/config');
        expect(JSON.stringify(env)).not.toContain('/daily/');
      }
      expect(launch('claude', '/run/home', '/candidate')).toEqual(['claude', '--plugin-dir', '/candidate/plugins/pstack', '--settings', '/run/home/settings.json', '--setting-sources', 'project']);
      expect(launch('codex', '/run/home', '/candidate')).toEqual(['codex']);
    } finally {
      delete process.env.GH_TOKEN; delete process.env.CODEX_HOME; delete process.env.CLAUDE_CONFIG_DIR;
      if (oldAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldAnthropic;
      if (oldOpenai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenai;
    }
  });
  test('candidate environment preserves real account names without inventing an account', () => {
    const previous = { USER: process.env.USER, LOGNAME: process.env.LOGNAME };
    process.env.USER = 'operator-user'; process.env.LOGNAME = 'operator-login';
    try {
      for (const harness of ['claude', 'codex'] as const) {
        const env = isolatedEnv('/run/home', harness);
        expect(env.USER).toBe('operator-user'); expect(env.LOGNAME).toBe('operator-login');
        expect(process.env.HOME).toBe(env.HOME);
      }
      delete process.env.USER; delete process.env.LOGNAME;
      const env = isolatedEnv('/run/home', 'claude');
      expect(env.USER).toBeUndefined(); expect(env.LOGNAME).toBeUndefined();
    } finally {
      for (const name of ['USER', 'LOGNAME'] as const) {
        if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      }
    }
  });
  test('doctor blocks non-Mac and missing isolation interfaces, retaining reasons', async () => {
    const root = await fixture();
    const run: Command = async args => args.includes('--version') ? 'version' : '';
    await expect(doctor(root, run, 'linux')).rejects.toThrow('operator Mac');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
    await expect(doctor(root, run, 'darwin')).rejects.toThrow('isolation missing');
  });
  test('doctor probes without installing or reading daily authentication', async () => {
    const calls: string[][] = [], root = await fixture();
    const run: Command = async args => { calls.push(args); return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path'; };
    await doctor(root, run, 'darwin');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
    expect(calls.every(c => c.includes('--help') || c.includes('--version'))).toBe(true);
  });
  test('project self-test accepts real doctor output through canonical workspace paths', async () => {
    const root = await fixture(), workspace = join(root, 'workspace');
    const skill = await realpath(join(import.meta.dir, '..'));
    await mkdir(join(workspace, '.claude/skills'), { recursive: true });
    await symlink(skill, join(workspace, '.claude/skills/verify-open-pstack'));
    const alias = join(root, 'workspace-alias'); await symlink(workspace, alias);
    const run: Command = async args => args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
    await doctor(root, run, 'darwin');
    const text = await readFile(join(root, 'doctor.json'), 'utf8');
    expect(JSON.parse(text).skill).toBe(skill);
    await verifyProjectDoctor(['not JSON', text], workspace);
    await verifyProjectDoctor([text], alias);
    const other = join(root, 'other-workspace');
    await mkdir(join(other, '.claude/skills/verify-open-pstack'), { recursive: true });
    await expect(verifyProjectDoctor([text], other)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor(['{}'], workspace)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor([JSON.stringify({ ...JSON.parse(text), result: 'blocked' })], workspace)).rejects.toThrow('passing child doctor');
  });
  test('prepare creates private configuration homes before any harness command', async () => {
    const root = await fixture(), sha = 'a'.repeat(40), calls: string[][] = [];
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const run: Command = async (args, options = {}) => {
      calls.push(args);
      const env = options.env!;
      const config = env.CODEX_HOME ?? env.CLAUDE_CONFIG_DIR;
      expect(process.env.HOME).toBe(env.HOME);
      expect((await stat(env.HOME!)).isDirectory()).toBe(true);
      for (const path of [env.TMPDIR!]) {
        const info = await stat(path);
        expect(info.isDirectory()).toBe(true);
        expect(info.mode & 0o777).toBe(0o700);
      }
      if (options.cwd) expect((await stat(options.cwd)).isDirectory()).toBe(true);
      if (args[0] === 'claude' && env.CLAUDE_CONFIG_DIR) {
        const settings = join(env.CLAUDE_CONFIG_DIR, '..', 'settings.json');
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
        expect((await stat(settings)).mode & 0o777).toBe(0o600);
      }
      if (config) {
        const info = await stat(config);
        expect(info.isDirectory()).toBe(true);
        expect(info.mode & 0o777).toBe(0o700);
        expect(config).toBe(join(env.TMPDIR!, '..', 'config'));
        expect(config.startsWith(root + '/state/')).toBe(true);
        expect(env.GH_TOKEN).toBeUndefined();
      }
      if (args[0] === 'git' && args[1] === 'clone') {
        const plugin = join(args.at(-1)!, 'plugins/pstack');
        for (const manifest of ['.claude-plugin', '.codex-plugin']) {
          await mkdir(join(plugin, manifest), { recursive: true });
          await writeFile(join(plugin, manifest, 'plugin.json'), JSON.stringify({ version: 'test' }));
        }
      }
      if (args[0] === 'git' && args[1] === 'rev-parse') return sha;
      if (args.includes('--version')) return 'version';
      if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
      if (args[0] === 'codex' && args[1] === 'plugin') {
        expect(env.CODEX_HOME).toBeDefined();
        if (args[2] === 'marketplace') return '{}';
        if (args[2] === 'add') {
          const installedPath = join(env.CODEX_HOME!, 'plugins/pstack');
          await cp(join(env.CODEX_HOME!, '..', 'workspace/plugins/pstack'), installedPath, { recursive: true });
          return JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath });
        }
        if (args[2] === 'list') return JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] });
      }
      return '';
    };
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      const installs = await new MacDriver(run).prepare(newReceipt(111, sha, 'b'.repeat(40), true, root));
      expect(installs.map(i => i.harness)).toEqual(['claude', 'codex']);
      expect(installs.every(i => i.sha === sha)).toBe(true);
      expect(calls.some(c => c.join(' ') === 'codex plugin add pstack@open-pstack --json')).toBe(true);
    } finally { Object.defineProperty(process, 'platform', platform); }
  });
  test('Codex exact installed tree and enabled listing are required', async () => {
    const root = await fixture(), plugin = join(root, 'config/plugins/pstack');
    await mkdir(plugin, { recursive: true }); await writeFile(join(plugin, 'SKILL.md'), 'candidate');
    const hash = await treeHash(plugin), receipt = JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath: plugin });
    expect(await codexInstallation(receipt, root, hash)).toBe(plugin);
    await expect(codexInstallation(receipt, root, 'bad')).rejects.toThrow('differs');
    await expect(codexInstallation('{}', root, hash)).rejects.toThrow('Unrecognized');
    expect(() => verifyCodexEnabled(JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] }))).not.toThrow();
    expect(() => verifyCodexEnabled(JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: false }] }))).toThrow('enabled');
    const outside = await fixture(); await writeFile(join(outside, 'SKILL.md'), 'candidate');
    await expect(codexInstallation(JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath: outside }), root, hash)).rejects.toThrow('escaped');
  });
  test('plugin symlinks and evidence outside retained root are rejected', async () => {
    const root = await fixture(), outside = await fixture();
    await writeFile(join(outside, 'secret'), 'outside'); await symlink(join(outside, 'secret'), join(root, 'escape'));
    await expect(treeHash(root)).rejects.toThrow('symlink');
    await expect(retainedFile(root, 'escape')).rejects.toThrow('within output');
    await writeFile(join(root, 'reviewed.txt'), 'native surface');
    expect((await retainedFile(root, 'reviewed.txt')).sha256).toMatch(/^[a-f0-9]{64}$/);
    await mkdir(join(root, 'state')); await writeFile(join(root, 'state/raw'), 'raw');
    await expect(retainedFile(root, 'state/raw')).rejects.toThrow('outside isolated state');
  });
  test('output must be fresh and outside the repository', async () => {
    const root = await fixture(), repo = join(root, 'repo'); await mkdir(repo);
    await expect(freshRoot(join(repo, 'output'), repo)).rejects.toThrow('outside');
    await expect(freshRoot(root, repo)).rejects.toThrow();
    expect(await freshRoot(join(root, 'output'), repo)).toBe(join(root, 'output'));
    expect(redact('ghp_testsecret sk-providersecret Bearer abc')).toBe('[REDACTED] [REDACTED] [REDACTED]');
  });
});
