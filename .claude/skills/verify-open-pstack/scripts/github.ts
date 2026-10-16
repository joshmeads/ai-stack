import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION_MANIFESTS } from './core.ts';
import { command, type Command } from './io.ts';
import { REPO, type ChangedFile, type GitHub, type Pull } from './types.ts';

export function parseChangedFiles(output: string): ChangedFile[] {
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('Truncated changed-file diff');
  const fields = output.slice(0, -1).split('\0'), files: ChangedFile[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^(?:[AMDT]|[RC]\d{1,3})$/.test(status)) throw new Error('Invalid changed-file status');
    const previous = /^[RC]/.test(status) ? fields[i++] : undefined, filename = fields[i++];
    if (!filename || previous === '') throw new Error('Incomplete changed-file diff');
    files.push({ filename, ...(previous !== undefined ? { previous_filename: previous } : {}) });
  }
  if (new Set(files.map(f => f.filename)).size !== files.length) throw new Error('Duplicate changed-file diff');
  return files;
}
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The manifest's version strings, and the manifest without them. */
function versions(path: string, text: string): { versions: unknown[]; rest: Json } | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!object(value)) return undefined;
  if (path !== '.claude-plugin/marketplace.json') { const { version, ...rest } = value; return { versions: [version], rest }; }
  if (!Array.isArray(value.plugins)) return undefined;
  const found: unknown[] = [];
  const plugins = value.plugins.map(plugin => { if (!object(plugin)) return plugin; const { version, ...rest } = plugin; found.push(version); return rest; });
  return { versions: found, rest: { ...value, plugins } };
}
/** True when the two manifest texts differ only in version strings, and at least one changed. */
export function versionOnly(path: string, before: string, after: string): boolean {
  const a = versions(path, before), b = versions(path, after);
  if (!a || !b || !Bun.deepEquals(a.rest, b.rest)) return false;
  const changed = a.versions.flatMap((v, i) => v === b.versions[i] ? [] : [[v, b.versions[i]]]);
  return changed.length > 0 && changed.every(pair => pair.every(v => typeof v === 'string'));
}

export class Publisher implements GitHub {
  constructor(private run: Command = command) {}
  private async api(path: string, args: string[] = [], allowInterrupted = false): Promise<unknown> {
    return JSON.parse(await this.run(['gh', 'api', `repos/${REPO}/${path}`, ...args], { allowInterrupted }));
  }
  async pull(pr: number): Promise<Pull> {
    const data = await this.api(`pulls/${pr}`) as { number: number; head: { sha: string; repo?: { full_name: string } }; base: { sha: string }; state: string };
    if (data.number !== pr || typeof data.state !== 'string') throw new Error('Invalid PR response');
    return { number: pr, head: { sha: data.head.sha }, base: { sha: data.base.sha }, state: data.state, headRepo: data.head.repo?.full_name ?? '' };
  }
  async files(base: string, head: string): Promise<ChangedFile[]> {
    if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid diff SHA');
    const repository = await mkdtemp(join(tmpdir(), 'open-pstack-diff-'));
    const env = { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' };
    try {
      await this.run(['git', 'init', '--bare', '--template=', repository], { env });
      await this.run(['git', 'fetch', '--no-tags', '--', `https://github.com/${REPO}.git`, base, head], { cwd: repository, env });
      for (const sha of [base, head]) {
        if ((await this.run(['git', 'rev-parse', '--verify', `${sha}^{commit}`], { cwd: repository, env })).trim() !== sha) throw new Error('Pinned diff commit unavailable');
      }
      const output = await this.run(['git', 'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], { cwd: repository, env });
      const files = parseChangedFiles(output);
      // The three-dot diff compares the merge base to the head, so the version check does too.
      const mergeBase = (await this.run(['git', 'merge-base', base, head], { cwd: repository, env })).trim();
      const blob = async (commit: string, path: string): Promise<{ mode: string; text: string } | undefined> => {
        const entry = /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(await this.run(['git', 'ls-tree', '-z', commit, '--', path], { cwd: repository, env }));
        return entry ? { mode: entry[1]!, text: await this.run(['git', 'cat-file', 'blob', entry[2]!], { cwd: repository, env }) } : undefined;
      };
      for (const file of files) {
        if (file.previous_filename || !Object.hasOwn(VERSION_MANIFESTS, file.filename)) continue;
        const before = await blob(mergeBase, file.filename), after = await blob(head, file.filename);
        if (before && after && before.mode === after.mode && versionOnly(file.filename, before.text, after.text)) file.versionOnly = true;
      }
      return files;
    } finally { await rm(repository, { recursive: true, force: true }); }
  }
  async comment(pr: number, body: string): Promise<string> {
    if (body.length > 60000) throw new Error('Evidence exceeds comment budget');
    const result = await this.api(`issues/${pr}/comments`, ['--method', 'POST', '-f', `body=${body}`]) as { html_url: string };
    if (typeof result.html_url !== 'string' || !result.html_url.startsWith(`https://github.com/${REPO}/issues/`) && !result.html_url.startsWith(`https://github.com/${REPO}/pull/`)) throw new Error('Missing same-repository evidence comment URL');
    return result.html_url;
  }
  async status(sha: string, state: 'success' | 'failure', target: string, description: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid status SHA');
    await this.api(`statuses/${sha}`, ['--method', 'POST', '-f', 'context=live-gate', '-f', `state=${state}`, '-f', `target_url=${target}`, '-f', `description=${description.slice(0, 140)}`], state === 'failure');
  }
}
