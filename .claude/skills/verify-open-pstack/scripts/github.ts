import { command, type Command } from './io.ts';
import { REPO, type ChangedFile, type GitHub, type Pull } from './types.ts';

export class Publisher implements GitHub {
  constructor(private run: Command = command) {}
  private async api(path: string, args: string[] = []): Promise<unknown> {
    return JSON.parse(await this.run(['gh', 'api', `repos/${REPO}/${path}`, ...args]));
  }
  async pull(pr: number): Promise<Pull> {
    const data = await this.api(`pulls/${pr}`) as { number: number; head: { sha: string; repo?: { full_name: string } }; base: { sha: string }; draft: boolean; state: string };
    if (data.number !== pr || typeof data.draft !== 'boolean' || typeof data.state !== 'string') throw new Error('Invalid PR response');
    return { number: pr, head: { sha: data.head.sha }, base: { sha: data.base.sha }, draft: data.draft, state: data.state, headRepo: data.head.repo?.full_name ?? '' };
  }
  async files(pr: number): Promise<ChangedFile[]> {
    const metadata = await this.api(`pulls/${pr}`) as { changed_files: number };
    if (!Number.isInteger(metadata.changed_files) || metadata.changed_files > 3000) throw new Error('PR file count cannot be completely enumerated');
    const pages = await this.api(`pulls/${pr}/files?per_page=100`, ['--paginate', '--slurp']);
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Invalid file pagination');
    const files: ChangedFile[] = pages.flat().map((file: { filename: string; previous_filename?: string }) => {
      if (typeof file.filename !== 'string' || (file.previous_filename !== undefined && typeof file.previous_filename !== 'string')) throw new Error('Invalid changed file');
      return { filename: file.filename, ...(file.previous_filename ? { previous_filename: file.previous_filename } : {}) };
    });
    if (files.length !== metadata.changed_files || new Set(files.map(f => f.filename)).size !== files.length) throw new Error('Incomplete or duplicate changed-file response');
    return files;
  }
  async comment(pr: number, body: string): Promise<string> {
    if (body.length > 60000) throw new Error('Evidence exceeds comment budget');
    const result = await this.api(`issues/${pr}/comments`, ['--method', 'POST', '-f', `body=${body}`]) as { html_url: string };
    if (typeof result.html_url !== 'string' || !result.html_url.startsWith(`https://github.com/${REPO}/issues/`) && !result.html_url.startsWith(`https://github.com/${REPO}/pull/`)) throw new Error('Missing same-repository evidence comment URL');
    return result.html_url;
  }
  async status(sha: string, state: 'success' | 'failure', target: string, description: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid status SHA');
    await this.api(`statuses/${sha}`, ['--method', 'POST', '-f', 'context=live-gate', '-f', `state=${state}`, '-f', `target_url=${target}`, '-f', `description=${description.slice(0, 140)}`]);
  }
  async ready(pr: number): Promise<void> { await this.run(['gh', 'pr', 'ready', String(pr), '--repo', REPO]); }
  async draft(pr: number): Promise<void> { await this.run(['gh', 'pr', 'ready', String(pr), '--undo', '--repo', REPO]); }
}
