import { chmod, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isolatedEnv, registerSecrets } from './io.ts';
import { HARNESSES, type CredentialSources, type Harness } from './types.ts';

export function loginFix(tool: Harness, directory: string): string {
  const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
  return tool === 'claude' ? `CLAUDE_CONFIG_DIR=${quoted} claude auth login` : `CODEX_HOME=${quoted} codex login`;
}

export async function credentialSources(sources: CredentialSources): Promise<CredentialSources> {
  const canonical = {} as CredentialSources;
  for (const tool of HARNESSES) {
    const directory = sources[tool];
    try {
      if (typeof directory !== 'string' || !directory || directory.includes('\0')) throw new Error('explicit source directory required');
      const path = resolve(directory), info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('source directory must be a directory, not symlinked');
      canonical[tool] = await realpath(path);
      const source = join(canonical[tool], tool === 'claude' ? '.credentials.json' : 'auth.json');
      const sourceInfo = await lstat(source);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || await realpath(source) !== source) throw new Error('credentials must be a contained regular file');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${tool} credential source unavailable: ${reason}; log in once with: ${loginFix(tool, directory ?? '')}`);
    }
  }
  return canonical;
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
  const apiKey = tool === 'codex' && typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY ? auth.OPENAI_API_KEY : undefined;
  if ((typeof access !== 'string' || !access) && !apiKey) throw new Error(`${tool} requires file-backed native credentials; unknown format blocks`);
  const names = tool === 'claude' ? ['accessToken', 'refreshToken'] : ['access_token', 'refresh_token', 'id_token'];
  return [...(apiKey ? [apiKey] : []), ...names.flatMap(name => typeof fields?.[name] === 'string' ? [fields[name] as string] : [])];
}

export async function copyCredentials(home: string, sources: CredentialSources, copied: string[]): Promise<void> {
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('Credential copy requires canonical candidate state');
  const canonical = await credentialSources(sources);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await canonicalDirectory(home, 'Credential copy refuses redirected candidate state');

  for (const tool of HARNESSES) {
    const source = join(canonical[tool], tool === 'claude' ? '.credentials.json' : 'auth.json');
    const bytes = await readFile(source);
    try {
      const auth = JSON.parse(bytes.toString()) as Record<string, unknown>;
      registerSecrets(credentialTokens(tool, auth));
    } catch {
      throw new Error(`${tool} credential source has unsupported file-backed credentials; log in once with: ${loginFix(tool, canonical[tool])}`);
    }

    const target = credentialLocation(home, tool);
    await mkdir(target.directory, { recursive: true, mode: 0o700 });
    await canonicalDirectory(target.directory, 'Candidate credential directory redirected');
    await chmod(target.directory, 0o700);
    const file = await open(target.path, 'wx', 0o600);
    copied.push(target.path);
    try { await file.writeFile(bytes); }
    finally { await file.close(); }
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
