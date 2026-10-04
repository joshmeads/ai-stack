import { afterEach, describe, expect, test } from 'bun:test';
import { cp, lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { codexInstallation, launch, MacDriver, verifyCodexEnabled, verifyProjectDoctor } from './harness.ts';
import { newReceipt } from './core.ts';
import { sourceDigest } from './provenance.ts';
import { evidence } from './verify.ts';
import { command, freshRoot, isolatedEnv, retainedFile, treeHash, type Command } from './io.ts';
const roots: string[] = [];
async function fixture(): Promise<string> { const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-test-'))); roots.push(root); return root; }
const originalEnv = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME };
afterEach(async () => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function loginFixture(root: string): Promise<string> {
  const home = join(root, 'daily-codex');
  await mkdir(home, { mode: 0o700 });
  await writeFile(join(home, 'auth.json'), 'opaque existing login');
  await writeFile(join(home, 'daily-state'), 'do not touch');
  process.env.CODEX_HOME = home;
  return join(home, 'auth.json');
}

describe('isolated harness boundaries', () => {
  test('candidate environment keeps operator identity while isolating provider configuration', () => {
    const previous = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
      GH_TOKEN: process.env.GH_TOKEN, CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
    process.env.HOME = '/operator/home'; process.env.USER = 'operator-user'; process.env.LOGNAME = 'operator-login';
    process.env.GH_TOKEN = 'test-publisher-token'; process.env.CODEX_HOME = '/daily/codex';
    process.env.CLAUDE_CONFIG_DIR = '/daily/claude'; process.env.ANTHROPIC_API_KEY = 'daily-anthropic'; process.env.OPENAI_API_KEY = 'daily-openai';
    try {
      for (const harness of ['claude', 'codex'] as const) {
        const env = isolatedEnv('/run/state', harness);
        expect(env.GH_TOKEN).toBeUndefined(); expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
        expect(env.HOME).toBe('/operator/home'); expect(env.USER).toBe('operator-user'); expect(env.LOGNAME).toBe('operator-login');
        expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null'); expect(env.TMPDIR).toBe('/run/state/tmp');
        expect(env.CLAUDE_CONFIG_DIR).toBe('/daily/claude'); expect(env.CODEX_HOME).toBe('/run/state/.codex');
        expect(env.GH_CONFIG_DIR).toBe('/run/state/.config/gh');
        expect(JSON.stringify(env)).not.toContain('/daily/codex');
      }
      expect(launch('claude', '/run/state', '/candidate')).toEqual(['claude', '--plugin-dir', '/candidate/plugins/pstack', '--settings', '{"enabledPlugins":{"pstack@open-pstack":false}}']);
      expect(launch('claude', '/run/state', '/candidate').join(' ')).not.toContain('/run/state');
      delete process.env.CLAUDE_CONFIG_DIR;
      expect(isolatedEnv('/run/state', 'claude').CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(launch('codex', '/run/state', '/candidate')).toEqual(['codex']);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
  test('candidate environment requires the real operator identity', () => {
    const previous = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME };
    try {
      delete process.env.HOME;
      expect(() => isolatedEnv('/run/state', 'claude')).toThrow('Real HOME');
      process.env.HOME = '/operator/home'; delete process.env.USER;
      expect(() => isolatedEnv('/run/state', 'claude')).toThrow('USER and LOGNAME');
      process.env.USER = 'operator-user'; delete process.env.LOGNAME;
      expect(() => isolatedEnv('/run/state', 'claude')).toThrow('USER and LOGNAME');
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
  test('doctor blocks non-Mac and missing isolation interfaces, retaining reasons', async () => {
    const root = await fixture();
    const run: Command = async args => args.includes('--version') ? 'version' : '';
    await expect(doctor(root, run, 'linux')).rejects.toThrow('operator Mac');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
    await expect(doctor(root, run, 'darwin', true)).rejects.toThrow('isolation missing');
  });
  test('doctor probes without installing or reading daily authentication', async () => {
    const calls: string[][] = [], root = await fixture();
    const run: Command = async args => { calls.push(args); return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path'; };
    await doctor(root, run, 'darwin', true);
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
    expect(calls.every(c => c.includes('--help') || c.includes('--version'))).toBe(true);
  });
  test('project self-test accepts real candidate doctor output through canonical workspace paths', async () => {
    const root = await fixture(), workspace = join(root, 'workspace');
    const skill = await realpath(join(import.meta.dir, '..'));
    await mkdir(join(workspace, '.claude/skills'), { recursive: true });
    await symlink(skill, join(workspace, '.claude/skills/verify-open-pstack'));
    const alias = join(root, 'workspace-alias'); await symlink(workspace, alias);
    const run: Command = async args => args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
    await doctor(root, run, 'darwin', false);
    const parentText = await readFile(join(root, 'doctor.json'), 'utf8');
    await expect(verifyProjectDoctor([parentText], workspace)).rejects.toThrow('passing child doctor');
    await doctor(root, run, 'darwin', true);
    const text = await readFile(join(root, 'doctor.json'), 'utf8');
    expect(JSON.parse(text).candidate).toBe(true); expect(JSON.parse(text).skill).toBe(skill);
    await verifyProjectDoctor(['not JSON', text], workspace);
    await verifyProjectDoctor([text], alias);
    const other = join(root, 'other-workspace');
    await mkdir(join(other, '.claude/skills/verify-open-pstack'), { recursive: true });
    await expect(verifyProjectDoctor([text], other)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor(['{}'], workspace)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor([JSON.stringify({ ...JSON.parse(text), result: 'blocked' })], workspace)).rejects.toThrow('passing child doctor');
  });

  test.each([false, true])('prepare pins local Git candidate and links existing Codex login (install failure=%s)', async failInstall => {
    const root = await fixture(), repository = join(root, 'repository'), operatorHome = join(root, 'operator-home'), calls: string[][] = [];
    const auth = await loginFixture(root);
    for (const manifest of ['.claude-plugin', '.codex-plugin']) {
      const dir = join(repository, 'plugins/pstack', manifest); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'plugin.json'), JSON.stringify({ version: 'test' }));
    }
    await mkdir(join(repository, '.claude/skills/verify-open-pstack'), { recursive: true });
    await writeFile(join(repository, '.claude/skills/verify-open-pstack/SKILL.md'), 'pinned project skill');
    await mkdir(join(repository, '.agents/skills'), { recursive: true });
    await symlink('../../.claude/skills/verify-open-pstack', join(repository, '.agents/skills/verify-open-pstack'));
    await command(['git', 'init', repository]);
    await command(['git', 'add', '.'], { cwd: repository });
    await command(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: repository });
    const sha = (await command(['git', 'rev-parse', 'HEAD'], { cwd: repository })).trim(), actualGit: Command = command;
    await mkdir(operatorHome, { mode: 0o700 });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const previous = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME };
    const run: Command = async (args, options = {}) => {
      calls.push(args);
      const env = options.env, candidate = Boolean(env?.CODEX_HOME?.startsWith(join(root, 'state') + '/'));
      if (candidate) {
        const stateHome = join(env!.CODEX_HOME!, '..');
        expect(env!.HOME).toBe(operatorHome); expect(env!.USER).toBe('operator-user'); expect(env!.LOGNAME).toBe('operator-login');
        expect(env!.CLAUDE_CONFIG_DIR).toBe(join(operatorHome, 'claude-config')); expect(env!.CODEX_HOME).toBe(join(stateHome, '.codex'));
        expect(env!.TMPDIR).toBe(join(stateHome, 'tmp')); expect(env!.GH_CONFIG_DIR).toBe(join(stateHome, '.config/gh'));
        expect(env!.GH_TOKEN).toBeUndefined(); expect(env!.GITHUB_TOKEN).toBeUndefined();
        for (const dir of [stateHome, env!.TMPDIR!, env!.CODEX_HOME!, env!.GH_CONFIG_DIR!]) {
          const info = await stat(dir); expect(info.isDirectory()).toBe(true); expect(info.mode & 0o777).toBe(0o700);
        }
        await expect(stat(join(stateHome, '.claude'))).rejects.toThrow('ENOENT');
        await expect(stat(join(stateHome, 'settings.json'))).rejects.toThrow('ENOENT');
      }
      if (args[0] === '/usr/bin/script') {
        expect(candidate).toBe(true); expect(options.interactive).toBe(true);
        await writeFile(args[2]!, 'retained raw native evidence');
        throw new Error('fixture native surface reached');
      }
      if (args[0] === 'git') {
        const local = [...args];
        if (args[1] === 'clone') local[local.length - 2] = repository;
        return actualGit(local, options);
      }
      if (args.includes('--version')) return 'version';
      if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
      if (args[0] === 'codex' && args[1] === 'plugin') {
        const linked = join(env!.CODEX_HOME!, 'auth.json');
        expect((await lstat(linked)).isSymbolicLink()).toBe(true);
        expect(await readlink(linked)).toBe(auth);
        if (failInstall) throw new Error('fixture installation failed');
        if (args[2] === 'marketplace') return '{}';
        if (args[2] === 'add') {
          const installedPath = join(env!.CODEX_HOME!, 'plugins/pstack');
          await cp(join(env!.CODEX_HOME!, '../workspace/plugins/pstack'), installedPath, { recursive: true });
          return JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath });
        }
        if (args[2] === 'list') return JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] });
      }
      throw new Error(`Unexpected fixture command: ${args.join(' ')}`);
    };
    const driver = new MacDriver(run, async () => '');
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      process.env.HOME = operatorHome; process.env.USER = 'operator-user'; process.env.LOGNAME = 'operator-login';
      process.env.CLAUDE_CONFIG_DIR = join(operatorHome, 'claude-config');
      const receipt = newReceipt(111, sha, sha, true, root), preparation = driver.prepare(receipt);
      if (failInstall) await expect(preparation).rejects.toThrow('fixture installation failed');
      else {
        const installs = await preparation; receipt.installations = installs;
        expect(installs.map(i => i.harness)).toEqual(['claude', 'codex']);
        expect(installs.every(i => i.sha === sha)).toBe(true);
        expect(installs.every(i => /^[a-f0-9]{64}$/.test(i.sourceHash!))).toBe(true);
        expect(installs[0]!.sourceHash).toBe(installs[1]!.sourceHash);
        expect(calls.some(c => c.join(' ') === 'codex plugin add pstack@open-pstack --json')).toBe(true);
        for (const installation of installs) {
          const one = newReceipt(111, sha, sha, true, root); one.installations = [installation];
          await expect(driver.exercise(one)).rejects.toThrow('fixture native surface reached');
        }
        expect(calls.filter(c => c[0] === '/usr/bin/script')).toHaveLength(2);
      }
    } finally {
      await mkdir(join(root, 'artifacts'), { mode: 0o700 });
      await writeFile(join(root, 'artifacts/private.txt'), 'private raw evidence', { mode: 0o600 });
      for (const harness of ['claude', 'codex']) await writeFile(join(root, 'state', harness, 'native-state.db'), 'retained candidate state');
      await driver.cleanup(); await driver.cleanup();
      Object.defineProperty(process, 'platform', platform);
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
    expect(calls.some(c => c.includes('auth') || c.includes('login'))).toBe(false);
    expect(calls.some(c => c[0] === '/usr/bin/sandbox-exec')).toBe(false);
    expect(await readFile(join(root, 'artifacts/private.txt'), 'utf8')).toBe('private raw evidence');
    expect(await readFile(auth, 'utf8')).toBe('opaque existing login');
    expect(await readFile(join(auth, '../daily-state'), 'utf8')).toBe('do not touch');
    expect((await stat(join(root, 'artifacts'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'artifacts/private.txt'))).mode & 0o777).toBe(0o600);
    for (const harness of ['claude', 'codex']) {
      const home = join(root, 'state', harness); expect((await stat(home)).isDirectory()).toBe(true);
      expect(await readFile(join(home, 'native-state.db'), 'utf8')).toBe('retained candidate state');
      if (harness === 'codex') await expect(stat(join(home, '.codex'))).rejects.toThrow('ENOENT');
      await expect(stat(join(home, '.claude'))).rejects.toThrow('ENOENT');
      if (!failInstall) expect(await readFile(join(home, 'surface.raw'), 'utf8')).toBe('retained raw native evidence');
    }
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
  });
  test.each([false, true])('setup interruption restores exact bytes or forbids publication (restore failure=%s)', async failRestore => {
    const root = await fixture(), home = join(root, 'state/claude'), workspace = join(home, 'workspace');
    const config = join(root, 'daily-claude'); process.env.CLAUDE_CONFIG_DIR = config;
    for (const path of ['plugins/pstack', '.claude/skills/verify-open-pstack', '.agents/skills']) await mkdir(join(workspace, path), { recursive: true });
    await symlink('../../.claude/skills/verify-open-pstack', join(workspace, '.agents/skills/verify-open-pstack'));
    await writeFile(join(workspace, 'plugins/pstack/SKILL.md'), 'candidate setup');
    await mkdir(config);
    const original = Buffer.from([0, 13, 10, 255, 97]);
    await writeFile(join(config, 'CLAUDE.md'), original);
    const receipt = newReceipt(111, 'a'.repeat(40), 'b'.repeat(40), false, root);
    receipt.selection = { paths: [], skills: [], features: ['setup'], noRuntime: false };
    receipt.installations = [{ harness: 'claude', home, location: join(workspace, 'plugins/pstack'), sha: receipt.sha, cliVersion: 'test', pluginVersion: 'test', treeHash: await treeHash(join(workspace, 'plugins/pstack')), sourceHash: await sourceDigest(workspace) }];
    const driver = new MacDriver(async args => {
      expect(args[0]).toBe('/usr/bin/script');
      await writeFile(join(config, 'CLAUDE.md'), 'changed by setup');
      await writeFile(join(config, 'pstack-models.md'), 'created by setup');
      if (failRestore) { await rm(join(config, 'CLAUDE.md')); await mkdir(join(config, 'CLAUDE.md')); }
      throw new Error('interrupted setup');
    }, async () => '');
    await expect(driver.exercise(receipt)).rejects.toThrow(failRestore ? 'Setup restoration requires a regular file' : 'interrupted setup');
    if (failRestore) {
      await expect(driver.cleanup()).rejects.toThrow('Setup restoration requires a regular file');
      await rm(join(config, 'CLAUDE.md'), { recursive: true });
      await expect(driver.cleanup()).rejects.toThrow('Setup restoration failed; publication forbidden');
      return;
    }
    await driver.cleanup();
    expect(await readFile(join(config, 'CLAUDE.md'))).toEqual(original);
    await expect(stat(join(config, 'pstack-models.md'))).rejects.toThrow('ENOENT');
  });
  test('exercise re-prompts unsafe evidence and publishes accepted answers verbatim', async () => {
    const root = await fixture(), home = join(root, 'state/claude'), workspace = join(home, 'workspace');
    for (const path of ['plugins/pstack', '.claude/skills/verify-open-pstack', '.agents/skills']) await mkdir(join(workspace, path), { recursive: true });
    await symlink('../../.claude/skills/verify-open-pstack', join(workspace, '.agents/skills/verify-open-pstack'));
    await writeFile(join(workspace, 'plugins/pstack/SKILL.md'), 'candidate plugin');
    await writeFile(join(root, 'transcript.txt'), 'reviewed native transcript');
    await writeFile(join(root, 'artifact.txt'), 'reviewed effect');
    const receipt = newReceipt(111, 'a'.repeat(40), 'b'.repeat(40), false, root);
    receipt.selection = { paths: [], skills: ['architect'], features: ['skill-invocation:architect'], noRuntime: false };
    receipt.installations = [{ harness: 'claude', home, location: join(workspace, 'plugins/pstack'), sha: receipt.sha, cliVersion: 'test', pluginVersion: 'test', treeHash: await treeHash(join(workspace, 'plugins/pstack')), sourceHash: await sourceDigest(workspace) }];
    const long = 's'.repeat(54), answers = ['transcript.txt', long, '`unsafe`', long, '✓', long, 'artifact.txt', 'PASS skill-invocation:architect'];
    const questions: string[] = [];
    const driver = new MacDriver(async () => '', async question => { questions.push(question); return answers.shift()!; });
    receipt.observations = await driver.exercise(receipt);
    expect(receipt.observations[0]!.surface).toBe(long);
    expect(questions.filter(question => question.startsWith('Concrete action'))).toHaveLength(2);
    expect(questions.filter(question => question.startsWith('Observed assertion'))).toHaveLength(2);
    for (const question of questions.slice(1, 6)) expect(question).toContain('printable ASCII, no backtick, < or >, and at most 160 characters');
    const comment = evidence(receipt);
    expect(comment).toContain(`surface ${long}; action ${long}; result ${long};`);
    expect(comment).not.toContain('[value omitted]');
    expect(answers).toHaveLength(0);
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
  });
});
