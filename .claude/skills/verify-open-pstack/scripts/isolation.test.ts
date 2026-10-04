import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertNoKnownSecrets, isolatedEnv } from './io.ts';
import { copyCredentials, credentialSources, loginFix, removeCredentials } from './isolation.ts';
import type { CredentialSources } from './types.ts';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-isolation-')));
  roots.push(root);
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function sources(root: string): Promise<CredentialSources> {
  const directories = { claude: join(root, 'Claude logged in'), codex: join(root, 'Codex logged in') };
  for (const tool of ['claude', 'codex'] as const) {
    await mkdir(directories[tool], { mode: 0o700 });
    await writeFile(join(directories[tool], tool === 'claude' ? '.credentials.json' : 'auth.json'), JSON.stringify(
      tool === 'claude'
        ? { claudeAiOauth: { accessToken: 'selected-claude-access', refreshToken: 'selected-claude-refresh' }, account: 'claude-evidence' }
        : { tokens: { access_token: 'selected-codex-access', refresh_token: 'selected-codex-refresh', id_token: 'selected-codex-id' }, account_id: 'codex-evidence' },
    ), { mode: 0o600 });
    await writeFile(join(directories[tool], 'settings.json'), '{"source-only":true}');
  }
  return directories;
}
function files(source: CredentialSources): string[] { return [join(source.claude, '.credentials.json'), join(source.codex, 'auth.json')]; }

describe('generic disposable credential sources', () => {
  test('validates and canonicalizes explicitly selected normal-login directories with spaces', async () => {
    const root = await fixture(), source = await sources(root);
    expect(await credentialSources({ claude: join(source.claude, '..', 'Claude logged in'), codex: source.codex })).toEqual(source);
    const missing = { ...source, codex: join(root, 'not logged in') };
    await expect(credentialSources(missing)).rejects.toThrow(loginFix('codex', missing.codex));
    await rm(files(source)[0]!);
    await expect(credentialSources(source)).rejects.toThrow(loginFix('claude', source.claude));
  });

  test('login guidance quotes directories safely without activating or repairing anything', async () => {
    const { command } = await import('./io.ts');
    const root = await fixture(), path = join(root, "dir's $(touch unexpected) ; config");
    const fix = loginFix('claude', path);
    const assignment = fix.slice('CLAUDE_CONFIG_DIR='.length, -' claude auth login'.length);
    expect(await command(['/bin/sh', '-c', `printf '%s' ${assignment}`], { cwd: root })).toBe(path);
    expect(await Bun.file(join(root, 'unexpected')).exists()).toBe(false);
    expect(loginFix('codex', '/normal/codex')).toBe("CODEX_HOME='/normal/codex' codex login");
  });

  test('copies only complete refresh-capable credential files with private modes and leaves source configuration unchanged', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    const originals = files(source), before = await Promise.all(originals.map(path => readFile(path)));
    await copyCredentials(home, source, copied);
    const env = isolatedEnv(home);
    expect(copied).toEqual([join(env.CLAUDE_CONFIG_DIR!, '.credentials.json'), join(env.CODEX_HOME!, 'auth.json')]);
    for (let index = 0; index < copied.length; index++) {
      expect((await lstat(copied[index]!)).isSymbolicLink()).toBe(false);
      expect((await stat(copied[index]!)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(copied[index]!))).mode & 0o777).toBe(0o700);
      expect(await readFile(copied[index]!)).toEqual(before[index]!);
      expect(await readdir(dirname(copied[index]!))).toEqual([index === 0 ? '.credentials.json' : 'auth.json']);
    }
    expect(JSON.parse(await readFile(copied[0]!, 'utf8')).claudeAiOauth.refreshToken).toBe('selected-claude-refresh');
    expect(JSON.parse(await readFile(copied[1]!, 'utf8')).tokens.refresh_token).toBe('selected-codex-refresh');
    expect(await Promise.all(originals.map(path => readFile(path)))).toEqual(before);
    for (const directory of Object.values(source)) expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe('{"source-only":true}');
  });

  test('registers only exact copied OAuth credential fields for public comment checks', async () => {
    const root = await fixture(), source = await sources(root), copied: string[] = [];
    const exact = ['comment-claude-access-7', 'comment-claude-refresh-7', 'comment-codex-access-7', 'comment-codex-refresh-7', 'comment-codex-id-7'];
    const ordinary = ['visible-token-shaped-claude-field-7', 'visible-token-shaped-codex-field-7'];
    await writeFile(files(source)[0]!, JSON.stringify({ claudeAiOauth: { accessToken: exact[0], refreshToken: exact[1], sessionTokenHint: ordinary[0] } }));
    await writeFile(files(source)[1]!, JSON.stringify({ tokens: { access_token: exact[2], refresh_token: exact[3], id_token: exact[4], token_hint: ordinary[1] } }));
    await copyCredentials(join(root, 'candidate'), source, copied);
    for (const secret of exact) expect(() => assertNoKnownSecrets(secret)).toThrow('Comment contains copied credentials');
    expect(() => assertNoKnownSecrets(ordinary.join(' '))).not.toThrow();
  });

  test('supports native Codex auth.json API-key credentials without discarding fields', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    const auth = { OPENAI_API_KEY: 'exact-codex-api-key-7', auth_mode: 'apikey', last_refresh: null };
    await writeFile(files(source)[1]!, JSON.stringify(auth));
    await copyCredentials(home, source, copied);
    expect(JSON.parse(await readFile(copied[1]!, 'utf8'))).toEqual(auth);
    expect(() => assertNoKnownSecrets(auth.OPENAI_API_KEY)).toThrow('Comment contains copied credentials');
  });

  test('cleanup removes only copied files while preserving candidate state, private raw evidence, config directories, and source credentials', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, source, copied);
    const raw = join(home, 'surface.raw'), artifact = join(home, 'reviewed-transcript.txt'), state = join(home, '.claude/session-state.json');
    await writeFile(raw, 'private raw transcript'); await writeFile(artifact, 'private reviewed evidence'); await writeFile(state, 'candidate session state');
    const before = await Promise.all(files(source).map(path => readFile(path, 'utf8')));
    await removeCredentials(copied); await removeCredentials(copied);
    for (const path of copied) expect(await Bun.file(path).exists()).toBe(false);
    expect(await readFile(raw, 'utf8')).toBe('private raw transcript');
    expect(await readFile(artifact, 'utf8')).toBe('private reviewed evidence');
    expect(await readFile(state, 'utf8')).toBe('candidate session state');
    expect((await stat(join(home, '.claude'))).isDirectory()).toBe(true);
    expect((await stat(join(home, '.codex'))).isDirectory()).toBe(true);
    expect(await Promise.all(files(source).map(path => readFile(path, 'utf8')))).toEqual(before);
  });

  test('partial copy cleanup retains failed-run evidence and malformed source files', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    const bad = files(source)[1]!; await writeFile(bad, '{"unknown":true}');
    await expect(copyCredentials(home, source, copied)).rejects.toThrow(loginFix('codex', source.codex));
    expect(copied).toHaveLength(1);
    const evidence = join(home, 'prepare-failure.txt'); await writeFile(evidence, 'retain failed-run evidence');
    await removeCredentials(copied);
    expect(await Bun.file(copied[0]!).exists()).toBe(false);
    expect(await readFile(evidence, 'utf8')).toBe('retain failed-run evidence');
    expect(await readFile(bad, 'utf8')).toBe('{"unknown":true}');
  });

  test('source credentials and selected directories must be canonical regular sources', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    const credential = files(source)[0]!, outside = join(root, 'outside-auth');
    await writeFile(outside, '{"claudeAiOauth":{"accessToken":"external"}}');
    await rm(credential); await symlink(outside, credential);
    await expect(copyCredentials(home, source, copied)).rejects.toThrow('contained regular file');
    expect(copied).toEqual([]);
    await rm(source.claude, { recursive: true }); await symlink(source.codex, source.claude);
    await expect(copyCredentials(home, source, copied)).rejects.toThrow('not symlinked');
    expect(await readFile(outside, 'utf8')).toContain('external');
  });

  test('candidate config-directory redirects fail closed without touching external sentinels', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), external = join(root, 'external');
    await mkdir(home); await mkdir(external);
    const sentinel = join(external, '.credentials.json'); await writeFile(sentinel, 'external sentinel');
    await symlink(external, join(home, '.claude'));
    const copied: string[] = [];
    await expect(copyCredentials(home, source, copied)).rejects.toThrow('redirected');
    expect(await readFile(sentinel, 'utf8')).toBe('external sentinel'); expect(copied).toEqual([]);
    await expect(removeCredentials([join(home, '.claude/.credentials.json')])).rejects.toThrow('redirected candidate credential directories');
    expect(await readFile(sentinel, 'utf8')).toBe('external sentinel'); expect((await stat(home)).isDirectory()).toBe(true);
  });

  test('cleanup unlinks copied-file leaf redirects without following them or removing candidate state', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, source, copied);
    const external = join(root, 'external-credential'); await writeFile(external, 'external sentinel');
    await rm(copied[0]!); await symlink(external, copied[0]!);
    const state = join(home, 'state.json'); await writeFile(state, 'preserved');
    await removeCredentials(copied);
    expect(await Bun.file(copied[0]!).exists()).toBe(false);
    expect(await readFile(external, 'utf8')).toBe('external sentinel'); expect(await readFile(state, 'utf8')).toBe('preserved');
  });

  test('an existing destination is not added to cleanup or deleted on copy failure', async () => {
    const root = await fixture(), source = await sources(root), home = join(root, 'candidate'), copied: string[] = [];
    await mkdir(join(home, '.claude'), { recursive: true });
    const existing = join(home, '.claude/.credentials.json'); await writeFile(existing, 'existing credential sentinel');
    await expect(copyCredentials(home, source, copied)).rejects.toThrow();
    expect(copied).toEqual([]); await removeCredentials(copied);
    expect(await readFile(existing, 'utf8')).toBe('existing credential sentinel');
  });
});
