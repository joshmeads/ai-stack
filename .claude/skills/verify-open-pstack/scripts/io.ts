import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export type Command = (args: string[], options?: { cwd?: string; env?: Record<string, string>; interactive?: boolean }) => Promise<string>;
export const command: Command = async (args, options = {}) => {
  const child = Bun.spawn(args, { cwd: options.cwd, env: options.env,
    stdin: options.interactive ? 'inherit' : 'ignore', stdout: options.interactive ? 'inherit' : 'pipe',
    stderr: options.interactive ? 'inherit' : 'pipe' });
  const [output, error] = options.interactive ? ['', ''] : await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (await child.exited !== 0) throw new Error(`${args[0]} failed: ${redact(error).slice(0, 1500)}`);
  return output;
};
export function redact(text: string): string {
  return text.replace(/(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+|Bearer\s+\S+)/gi, '[REDACTED]');
}
export function isolatedEnv(home: string, harness?: 'claude' | 'codex', credentials = false): Record<string, string> {
  const env: Record<string, string> = { PATH: (process.env.PATH ?? '').split(':').filter(isAbsolute).join(':'),
    HOME: home, TMPDIR: join(home, 'tmp'), TERM: process.env.TERM ?? 'xterm-256color',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  if (harness === 'claude') env.CLAUDE_CONFIG_DIR = join(home, 'config');
  if (harness === 'codex') env.CODEX_HOME = join(home, 'config');
  if (credentials) for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  return env;
}
export async function save(path: string, value: unknown): Promise<void> {
  await writeFile(path + '.tmp', redact(JSON.stringify(value, null, 2)) + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
export async function freshRoot(path: string, repository: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Output must be an absolute fresh directory outside the repository');
  const parent = await realpath(resolve(path, '..'));
  const root = join(parent, path.split('/').at(-1)!);
  const repo = await realpath(repository);
  if (root === repo || root.startsWith(repo + '/')) throw new Error('Output must be outside the repository');
  await mkdir(root, { mode: 0o700 }); // EEXIST deliberately rejects reuse and symlinks.
  return root;
}
export function sha256(data: string | Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
export async function treeHash(root: string): Promise<string> {
  const entries: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Plugin tree symlink refused: ${path}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) entries.push(`${relative(root, path)}\0${sha256(await readFile(path))}`);
      else throw new Error(`Non-file in plugin tree: ${path}`);
    }
  }
  await walk(root);
  if (!entries.length) throw new Error('Empty plugin tree');
  return sha256(entries.join('\n'));
}
export async function retainedFile(root: string, path: string): Promise<{ path: string; sha256: string }> {
  const actual = await realpath(isAbsolute(path) ? path : join(root, path));
  if (!actual.startsWith(root + '/') || actual.includes('/state/')) throw new Error('Evidence must be retained outside isolated state, within output');
  const stat = await lstat(actual);
  if (!stat.isFile() || !stat.size) throw new Error('Evidence file must be a nonempty regular file');
  return { path: relative(root, actual), sha256: sha256(await readFile(actual)) };
}
