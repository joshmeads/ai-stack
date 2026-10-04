import { chmod, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isolatedEnv, registerSecrets } from './io.ts';
import { HARNESSES, type Accounts, type Harness } from './types.ts';

export function vaultRoot(): string {
  if (process.env.CAAM_HOME) return join(process.env.CAAM_HOME, 'data/vault');
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'caam/vault');
  if (!process.env.HOME || !isAbsolute(process.env.HOME)) throw new Error('Trusted parent requires an absolute operator HOME');
  return join(process.env.HOME, '.local/share/caam/vault');
}

export function selectedAccounts(text: string, accounts: Accounts): Accounts {
  const result = JSON.parse(text);
  if (!Array.isArray(result.profiles)) throw new Error('Unknown caam list schema; expected profiles');
  for (const tool of HARNESSES) {
    const name = accounts[tool];
    if (!/^[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(name) || name.length > 254) throw new Error(`Explicit safe ${tool} account email required`);
    const matching = result.profiles.filter((profile: Record<string, unknown>) => profile.tool === tool && profile.name === name);
    if (matching.length !== 1 || (matching[0].identity as Record<string, unknown> | undefined)?.email !== name) {
      throw new Error(`caam ${tool}/${name} identity mismatch or missing; inspect caam list --json (never activate or repair automatically)`);
    }
  }
  return accounts;
}

function credentialLocation(home: string, tool: Harness): { directory: string; path: string } {
  const env = isolatedEnv(home);
  const directory = tool === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
  if (!directory) throw new Error(`Isolated ${tool} configuration directory is missing`);
  return { directory, path: join(directory, tool === 'claude' ? '.credentials.json' : 'auth.json') };
}

async function canonicalDirectory(path: string, message: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error(message);
}

function credentialTokens(tool: Harness, auth: Record<string, unknown>): string[] {
  const fields = (tool === 'claude' ? auth.claudeAiOauth : auth.tokens) as Record<string, unknown> | undefined;
  const access = tool === 'claude' ? fields?.accessToken : fields?.access_token;
  if (typeof access !== 'string') throw new Error(`${tool} vault requires file-backed OAuth credentials; unknown format blocks`);
  const names = tool === 'claude' ? ['accessToken', 'refreshToken'] : ['access_token', 'refresh_token', 'id_token'];
  return names.flatMap(name => typeof fields?.[name] === 'string' ? [fields[name] as string] : []);
}

export async function copyCredentials(home: string, vault: string, accounts: Accounts, copied: string[]): Promise<void> {
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('Credential copy requires canonical candidate state');
  const base = await realpath(vault);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await canonicalDirectory(home, 'Credential copy refuses redirected candidate state');

  for (const tool of HARNESSES) {
    const file = tool === 'claude' ? '.credentials.json' : 'auth.json';
    const profile = join(base, tool, accounts[tool]), source = join(profile, file);
    for (const directory of [join(base, tool), profile]) {
      const info = await lstat(directory);
      if (!directory.startsWith(base + '/') || !info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new Error('Selected vault directories must be canonical, not symlinked');
      }
    }
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || await realpath(source) !== source) throw new Error('Vault credentials must be a contained regular file');
    const bytes = await readFile(source);
    const auth = JSON.parse(bytes.toString()) as Record<string, unknown>;
    registerSecrets(credentialTokens(tool, auth));

    const target = credentialLocation(home, tool);
    await mkdir(target.directory, { recursive: true, mode: 0o700 });
    await canonicalDirectory(target.directory, 'Candidate credential directory redirected');
    await chmod(target.directory, 0o700);
    copied.push(target.path);
    await writeFile(target.path, bytes, { mode: 0o600, flag: 'wx' });
  }
}

export async function removeCredentials(paths: string[]): Promise<void> {
  for (const path of new Set(paths)) {
    if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Credential cleanup requires canonical copied paths');
    const home = resolve(path, '../..');
    const expected = HARNESSES.map(tool => credentialLocation(home, tool).path);
    if (!expected.includes(path)) throw new Error('Credential cleanup only removes copied provider credential files');

    const homeInfo = await lstat(home).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!homeInfo) continue;
    if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || await realpath(home) !== home) throw new Error('Credential cleanup refuses redirected candidate state');

    const directory = resolve(path, '..');
    const directoryInfo = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!directoryInfo) continue;
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error('Credential cleanup refuses redirected candidate credential directories');
    }

    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) continue;
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Credential cleanup only removes regular credential files or their leaf links');
    await unlink(path);
  }
}
