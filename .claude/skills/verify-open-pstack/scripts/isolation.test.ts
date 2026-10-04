import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertNoKnownSecrets, isolatedEnv } from './io.ts';
import { copyCredentials, removeCredentials, selectedAccounts, vaultRoot } from './isolation.ts';
import type { Accounts } from './types.ts';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-isolation-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const accounts: Accounts = { claude: 'claude@example.com', codex: 'codex@example.com' };
function profiles(active?: 'claude' | 'codex' | 'both'): string {
  return JSON.stringify({ profiles: [
    { tool: 'claude', name: accounts.claude, active: active === 'claude' || active === 'both', identity: { email: accounts.claude } },
    { tool: 'codex', name: accounts.codex, active: active === 'codex' || active === 'both', identity: { email: accounts.codex } },
  ] });
}
async function vault(root: string): Promise<string> {
  const base = join(root, 'vault');
  for (const tool of ['claude', 'codex'] as const) {
    const path = join(base, tool, accounts[tool]);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, tool === 'claude' ? '.credentials.json' : 'auth.json'), JSON.stringify(
      tool === 'claude'
        ? { claudeAiOauth: { accessToken: 'selected-claude-access', refreshToken: 'selected-claude-refresh' }, account: 'claude-evidence' }
        : { tokens: { access_token: 'selected-codex-access', refresh_token: 'selected-codex-refresh', id_token: 'selected-codex-id' }, account_id: 'codex-evidence' },
    ), { mode: 0o600 });
  }
  return base;
}

describe('disposable credential isolation', () => {
  test('vault root follows caam precedence and requires an absolute operator home', () => {
    const previous = { CAAM_HOME: process.env.CAAM_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, HOME: process.env.HOME };
    try {
      process.env.CAAM_HOME = '/operator/caam'; process.env.XDG_DATA_HOME = '/operator/data'; process.env.HOME = '/operator/home';
      expect(vaultRoot()).toBe('/operator/caam/data/vault');
      delete process.env.CAAM_HOME;
      expect(vaultRoot()).toBe('/operator/data/caam/vault');
      delete process.env.XDG_DATA_HOME;
      expect(vaultRoot()).toBe('/operator/home/.local/share/caam/vault');
      process.env.HOME = 'relative';
      expect(() => vaultRoot()).toThrow('absolute operator HOME');
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  test('selected accounts match exact identities regardless of daily activity and reject mismatches', () => {
    expect(selectedAccounts(profiles(), accounts)).toEqual(accounts);
    expect(selectedAccounts(profiles('both'), accounts)).toEqual(accounts);

    const wrongIdentity = JSON.parse(profiles('both')); wrongIdentity.profiles[0].identity.email = 'other@example.com';
    expect(() => selectedAccounts(JSON.stringify(wrongIdentity), accounts)).toThrow(`caam claude/${accounts.claude} identity mismatch`);
    const duplicate = JSON.parse(profiles()); duplicate.profiles.push(duplicate.profiles[0]);
    expect(() => selectedAccounts(JSON.stringify(duplicate), accounts)).toThrow();
    expect(() => selectedAccounts('{"profiles":[]}', accounts)).toThrow();
    expect(() => selectedAccounts('{}', accounts)).toThrow();
    expect(() => selectedAccounts('not JSON', accounts)).toThrow();
    expect(() => selectedAccounts(profiles(), { ...accounts, claude: '../escape@example.com' })).toThrow('safe claude account');
  });

  test('copies complete refresh-capable credentials to isolated config roots with private modes and leaves the vault unchanged', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    const originals = [join(base, 'claude', accounts.claude, '.credentials.json'), join(base, 'codex', accounts.codex, 'auth.json')];
    const before = await Promise.all(originals.map(path => readFile(path)));

    await copyCredentials(home, base, accounts, copied);

    const env = isolatedEnv(home);
    expect(copied).toEqual([join(env.CLAUDE_CONFIG_DIR!, '.credentials.json'), join(env.CODEX_HOME!, 'auth.json')]);
    for (let index = 0; index < copied.length; index++) {
      expect((await lstat(copied[index]!)).isSymbolicLink()).toBe(false);
      expect((await stat(copied[index]!)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(copied[index]!))).mode & 0o777).toBe(0o700);
      expect(await readFile(copied[index]!)).toEqual(before[index]!);
    }
    expect(JSON.parse(await readFile(copied[0]!, 'utf8')).claudeAiOauth.refreshToken).toBe('selected-claude-refresh');
    expect(JSON.parse(await readFile(copied[1]!, 'utf8')).tokens.refresh_token).toBe('selected-codex-refresh');
    expect(await Promise.all(originals.map(path => readFile(path)))).toEqual(before);
  });

  test('registers only exact copied credential token fields for parent comment-body redaction', async () => {
    const root = await fixture(), base = await vault(root), copied: string[] = [];
    const exact = ['comment-claude-access-7', 'comment-claude-refresh-7', 'comment-codex-access-7', 'comment-codex-refresh-7', 'comment-codex-id-7'];
    const ordinary = ['visible-token-shaped-claude-field-7', 'visible-token-shaped-codex-field-7'];
    await writeFile(join(base, 'claude', accounts.claude, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: exact[0], refreshToken: exact[1], sessionTokenHint: ordinary[0] },
    }));
    await writeFile(join(base, 'codex', accounts.codex, 'auth.json'), JSON.stringify({
      tokens: { access_token: exact[2], refresh_token: exact[3], id_token: exact[4], token_hint: ordinary[1] },
    }));

    await copyCredentials(join(root, 'candidate'), base, accounts, copied);

    for (const secret of exact) expect(() => assertNoKnownSecrets(secret)).toThrow('Comment contains copied credentials');
    expect(() => assertNoKnownSecrets(ordinary.join(' '))).not.toThrow();
  });

  test('cleanup removes only copied files while preserving candidate state, raw evidence, config directories, and vault files', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const raw = join(home, 'surface.raw'), artifact = join(home, 'reviewed-transcript.txt'), state = join(home, '.claude/session-state.json');
    await writeFile(raw, 'private raw transcript');
    await writeFile(artifact, 'private reviewed evidence');
    await writeFile(state, 'candidate session state');
    const originals = [join(base, 'claude', accounts.claude, '.credentials.json'), join(base, 'codex', accounts.codex, 'auth.json')];
    const before = await Promise.all(originals.map(path => readFile(path, 'utf8')));

    await removeCredentials(copied);
    await removeCredentials(copied);

    for (const path of copied) expect(await Bun.file(path).exists()).toBe(false);
    expect(await readFile(raw, 'utf8')).toBe('private raw transcript');
    expect(await readFile(artifact, 'utf8')).toBe('private reviewed evidence');
    expect(await readFile(state, 'utf8')).toBe('candidate session state');
    expect((await stat(join(home, '.claude'))).isDirectory()).toBe(true);
    expect((await stat(join(home, '.codex'))).isDirectory()).toBe(true);
    expect(await Promise.all(originals.map(path => readFile(path, 'utf8')))).toEqual(before);
  });

  test('partial copy cleanup removes the copied file without deleting candidate evidence or changing the vault', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    const bad = join(base, 'codex', accounts.codex, 'auth.json');
    await writeFile(bad, '{"unknown":true}');
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('unknown format');
    expect(copied).toHaveLength(1);
    const evidence = join(home, 'prepare-failure.txt'); await writeFile(evidence, 'retain failed-run evidence');

    await removeCredentials(copied);

    expect(await Bun.file(copied[0]!).exists()).toBe(false);
    expect(await readFile(evidence, 'utf8')).toBe('retain failed-run evidence');
    expect(await readFile(bad, 'utf8')).toBe('{"unknown":true}');
  });

  test('vault credential files and selected account directories must be canonical regular sources', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    const credential = join(base, 'claude', accounts.claude, '.credentials.json'), outside = join(root, 'outside-auth');
    await writeFile(outside, '{"claudeAiOauth":{"accessToken":"external"}}');
    await rm(credential); await symlink(outside, credential);
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('contained regular file');
    expect(copied).toEqual([]);

    await rm(join(base, 'claude', accounts.claude), { recursive: true });
    await symlink(join(base, 'codex', accounts.codex), join(base, 'claude', accounts.claude));
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('not symlinked');
    expect(await readFile(outside, 'utf8')).toContain('external');
  });

  test('candidate config-directory redirects fail closed without touching external sentinels', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), external = join(root, 'external');
    await mkdir(home); await mkdir(external);
    const sentinel = join(external, '.credentials.json'); await writeFile(sentinel, 'external sentinel');
    await symlink(external, join(home, '.claude'));
    const copied: string[] = [];

    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('redirected');
    expect(await readFile(sentinel, 'utf8')).toBe('external sentinel');
    expect(copied).toEqual([]);

    await expect(removeCredentials([join(home, '.claude/.credentials.json')])).rejects.toThrow('redirected candidate credential directories');
    expect(await readFile(sentinel, 'utf8')).toBe('external sentinel');
    expect((await stat(home)).isDirectory()).toBe(true);
  });

  test('cleanup unlinks a copied-file leaf redirect without following it or removing candidate state', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const external = join(root, 'external-credential'); await writeFile(external, 'external sentinel');
    await rm(copied[0]!); await symlink(external, copied[0]!);
    const state = join(home, 'state.json'); await writeFile(state, 'preserved');

    await removeCredentials(copied);

    expect(await Bun.file(copied[0]!).exists()).toBe(false);
    expect(await readFile(external, 'utf8')).toBe('external sentinel');
    expect(await readFile(state, 'utf8')).toBe('preserved');
  });
});
