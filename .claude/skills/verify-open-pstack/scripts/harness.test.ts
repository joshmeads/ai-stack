import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { codexInstallation, launch, MacDriver, verifyCodexEnabled, verifyProjectDoctor } from './harness.ts';
import { newReceipt } from './core.ts';
import { command, freshRoot, isolatedEnv, retainedFile, treeHash, type Command } from './io.ts';
const roots: string[] = [];
async function fixture(): Promise<string> { const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-test-'))); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function sourceFixture(root: string) {
  const sources = { claude: join(root, 'source-claude'), codex: join(root, 'source-codex') };
  const credentials = {
    claude: JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-claude', refreshToken: 'fixture-claude-refresh' } }),
    codex: JSON.stringify({ tokens: { access_token: 'fixture-codex', refresh_token: 'fixture-codex-refresh', id_token: 'fixture-codex-id' } }),
  };
  for (const tool of ['claude', 'codex'] as const) {
    await mkdir(sources[tool], { mode: 0o700 });
    await writeFile(join(sources[tool], tool === 'claude' ? '.credentials.json' : 'auth.json'), credentials[tool]);
    await writeFile(join(sources[tool], 'source-only.txt'), 'must not be copied');
  }
  return { sources, credentials };
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
        expect(env.CLAUDE_CONFIG_DIR).toBe('/run/state/.claude'); expect(env.CODEX_HOME).toBe('/run/state/.codex');
        expect(env.GH_CONFIG_DIR).toBe('/run/state/.config/gh'); expect(JSON.stringify(env)).not.toContain('/daily/');
      }
      expect(launch('claude', '/run/state', '/candidate')).toEqual(['claude', '--plugin-dir', '/candidate/plugins/pstack', '--settings', '/run/state/settings.json', '--setting-sources', 'project']);
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
    const { sources } = await sourceFixture(root);
    const parentRun: Command = async args => args[1] === 'auth' ? JSON.stringify({ loggedIn: true }) : args[1] === 'login' ? 'Logged in using ChatGPT' : run(args);
    await doctor(root, parentRun, 'darwin', false, sources);
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
  test('setup fails closed before any prepare or exercise command', async () => {
    const root = await fixture(), sha = '1'.repeat(40), calls: string[][] = [];
    const receipt = newReceipt(120, sha, sha, false, root);
    receipt.selection.features = ['setup'];
    const driver = new MacDriver(async args => { calls.push(args); return ''; }, async () => '', { claude: join(root, 'source-claude'), codex: join(root, 'source-codex') });
    const message = 'setup exercise requires #120 (setup-pstack config-home)';
    for (const operation of [() => driver.prepare(receipt), () => driver.exercise(receipt)]) {
      let caught: unknown;
      try { await operation(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error); expect((caught as Error).message).toBe(message); expect(calls).toEqual([]);
    }
  });
  test.each(['claude', 'codex'] as const)('prepare refuses an unauthenticated %s source before candidate commands', async tool => {
    const root = await fixture(), calls: string[][] = [], sha = '2'.repeat(40);
    const { sources, credentials } = await sourceFixture(root);
    const run: Command = async (args, options = {}) => {
      calls.push(args);
      if (args.includes('--version')) return 'version';
      if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
      if (args[1] === 'auth' || args[1] === 'login') {
        expect(options.env!.CLAUDE_CONFIG_DIR).toBe(sources.claude);
        expect(options.env!.CODEX_HOME).toBe(sources.codex);
        if (args[0] === 'claude') {
          expect(args).toEqual(['claude', 'auth', 'status', '--json']);
          return JSON.stringify({ loggedIn: tool !== 'claude' });
        }
        expect(args).toEqual(['codex', 'login', 'status']);
        if (tool === 'codex') throw new Error('Not logged in');
        return 'Logged in using ChatGPT';
      }
      throw new Error(`Unexpected fixture command: ${args.join(' ')}`);
    };
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const remediation = tool === 'claude' ? `CLAUDE_CONFIG_DIR='${sources.claude}' claude auth login` : `CODEX_HOME='${sources.codex}' codex login`;
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      await expect(new MacDriver(run, async () => '', sources).prepare(newReceipt(111, sha, sha, true, root))).rejects.toThrow(remediation);
    } finally { Object.defineProperty(process, 'platform', platform); }
    expect(calls.some(c => c.join(' ') === (tool === 'claude' ? 'claude auth status --json' : 'codex login status'))).toBe(true);
    expect(calls.some(c => c.includes('login') && c.join(' ') !== 'codex login status')).toBe(false);
    expect(calls.some(c => c[0] === 'git' && !c.includes('--version'))).toBe(false);
    await expect(stat(join(root, 'state'))).rejects.toThrow('ENOENT');
    for (const provider of ['claude', 'codex'] as const) {
      expect(await readFile(join(sources[provider], provider === 'claude' ? '.credentials.json' : 'auth.json'), 'utf8')).toBe(credentials[provider]);
    }
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
  });
  test.each([false, true])('prepare uses pinned local git fixture and disposable config credentials (install failure=%s)', async failInstall => {
    const root = await fixture(), repository = join(root, 'repository'), operatorHome = join(root, 'operator-home'), calls: string[][] = [];
    const { sources, credentials } = await sourceFixture(root);
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
      if (args[1] === 'auth' || args[1] === 'login') {
        expect(options.env!.CLAUDE_CONFIG_DIR).toBe(sources.claude);
        expect(options.env!.CODEX_HOME).toBe(sources.codex);
        if (args[0] === 'claude') {
          expect(args).toEqual(['claude', 'auth', 'status', '--json']);
          return JSON.stringify({ loggedIn: true });
        }
        expect(args).toEqual(['codex', 'login', 'status']);
        return 'Logged in using ChatGPT';
      }
      const env = options.env, candidate = Boolean(env?.CLAUDE_CONFIG_DIR?.startsWith(join(root, 'state') + '/'));
      if (candidate) {
        const stateHome = join(env!.CLAUDE_CONFIG_DIR!, '..');
        expect(env!.HOME).toBe(operatorHome); expect(env!.USER).toBe('operator-user'); expect(env!.LOGNAME).toBe('operator-login');
        expect(env!.CLAUDE_CONFIG_DIR).toBe(join(stateHome, '.claude')); expect(env!.CODEX_HOME).toBe(join(stateHome, '.codex'));
        expect(env!.TMPDIR).toBe(join(stateHome, 'tmp')); expect(env!.GH_CONFIG_DIR).toBe(join(stateHome, '.config/gh'));
        expect(env!.GH_TOKEN).toBeUndefined(); expect(env!.GITHUB_TOKEN).toBeUndefined();
        for (const dir of [stateHome, env!.TMPDIR!, env!.CLAUDE_CONFIG_DIR!, env!.CODEX_HOME!, env!.GH_CONFIG_DIR!]) {
          const info = await stat(dir); expect(info.isDirectory()).toBe(true); expect(info.mode & 0o777).toBe(0o700);
        }
        const settings = join(stateHome, 'settings.json'); expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
        expect((await stat(settings)).mode & 0o777).toBe(0o600);
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
        for (const tool of ['claude', 'codex'] as const) {
          const file = join(env![tool === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']!, tool === 'claude' ? '.credentials.json' : 'auth.json');
          expect(await readFile(file, 'utf8')).toBe(credentials[tool]); expect((await stat(file)).mode & 0o777).toBe(0o600);
        }
        if (failInstall) throw new Error('fixture installation failed');
        if (args[2] === 'marketplace') return '{}';
        if (args[2] === 'add') {
          const installedPath = join(env!.CODEX_HOME!, 'plugins/pstack');
          await cp(join(join(env!.CLAUDE_CONFIG_DIR!, '..'), 'workspace/plugins/pstack'), installedPath, { recursive: true });
          return JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath });
        }
        if (args[2] === 'list') return JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] });
      }
      throw new Error(`Unexpected fixture command: ${args.join(' ')}`);
    };
    const driver = new MacDriver(run, async () => '', sources);
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      process.env.HOME = operatorHome; process.env.USER = 'operator-user'; process.env.LOGNAME = 'operator-login';
      const receipt = newReceipt(111, sha, sha, true, root), preparation = driver.prepare(receipt);
      if (failInstall) await expect(preparation).rejects.toThrow('fixture installation failed');
      else {
        const installs = await preparation; receipt.installations = installs;
        expect(installs.map(i => i.harness)).toEqual(['claude', 'codex']);
        expect(installs.map(i => i.credentialSource)).toEqual([sources.claude, sources.codex]);
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
      await writeFile(join(root, 'artifacts/private.txt'), credentials.codex, { mode: 0o600 });
      for (const harness of ['claude', 'codex']) await writeFile(join(root, 'state', harness, 'native-state.db'), 'retained candidate state');
      await driver.cleanup(); await driver.cleanup();
      Object.defineProperty(process, 'platform', platform);
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
    expect(calls.filter(c => c.join(' ') === 'claude auth status --json')).toHaveLength(1);
    expect(calls.filter(c => c.join(' ') === 'codex login status')).toHaveLength(1);
    expect(calls.some(c => c[0] === '/usr/bin/sandbox-exec')).toBe(false);
    expect(await readFile(join(root, 'artifacts/private.txt'), 'utf8')).toBe(credentials.codex);
    expect((await stat(join(root, 'artifacts'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'artifacts/private.txt'))).mode & 0o777).toBe(0o600);
    for (const harness of ['claude', 'codex']) {
      const home = join(root, 'state', harness); expect((await stat(home)).isDirectory()).toBe(true);
      expect(await readFile(join(home, 'native-state.db'), 'utf8')).toBe('retained candidate state');
      for (const tool of ['claude', 'codex'] as const) {
        const filename = tool === 'claude' ? '.credentials.json' : 'auth.json';
        await expect(stat(join(home, '.' + tool, filename))).rejects.toThrow('ENOENT');
        expect(await readFile(join(sources[tool], filename), 'utf8')).toBe(credentials[tool]);
        expect(await readFile(join(sources[tool], 'source-only.txt'), 'utf8')).toBe('must not be copied');
        await expect(stat(join(home, '.' + tool, 'source-only.txt'))).rejects.toThrow('ENOENT');
      }
      if (!failInstall) expect(await readFile(join(home, 'surface.raw'), 'utf8')).toBe('retained raw native evidence');
    }
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
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
