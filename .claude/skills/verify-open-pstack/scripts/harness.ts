import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { requiredFeatures } from './core.ts';
import { command, isolatedEnv, redact, retainedFile, save, treeHash, type Command } from './io.ts';
import { doctor } from './doctor.ts';
import { HARNESSES, REPO, type Driver, type Harness, type Installation, type Observation, type Receipt } from './types.ts';

export type Ask = (question: string) => Promise<string>;
export const ask: Ask = async question => {
  if (!process.stdin.isTTY) throw new Error('Operator review requires an interactive terminal');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question + '\n> ')).trim(); } finally { reader.close(); }
};
export function launch(harness: Harness, home: string, workspace: string): string[] {
  return harness === 'claude'
    ? ['claude', '--plugin-dir', join(workspace, 'plugins/pstack'), '--settings', join(home, 'settings.json'), '--setting-sources', 'project']
    : ['codex'];
}
export async function codexInstallation(output: string, home: string, expected: string): Promise<string> {
  const result = JSON.parse(output);
  if (result.name !== 'pstack' || result.marketplaceName !== 'open-pstack' || typeof result.installedPath !== 'string') {
    throw new Error('Unrecognized Codex installation receipt; isolation cannot be established');
  }
  const path = await realpath(result.installedPath);
  if (!path.startsWith(await realpath(home) + '/')) throw new Error('Codex installation escaped isolated home');
  if (await treeHash(path) !== expected) throw new Error('Codex installed tree differs from pinned candidate');
  return path;
}
export function verifyCodexEnabled(output: string): void {
  const result = JSON.parse(output);
  const plugins = Array.isArray(result.installed) ? result.installed.filter((p: Record<string, unknown>) => p.name === 'pstack' && p.marketplaceName === 'open-pstack') : [];
  if (plugins.length !== 1 || plugins[0].installed !== true || plugins[0].enabled !== true) throw new Error('Isolated Codex plugin is not installed and enabled');
}
export async function verifyProjectDoctor(texts: string[], workspace: string): Promise<void> {
  const expected = await realpath(join(workspace, '.claude/skills/verify-open-pstack'));
  for (const text of texts) {
    try {
      const d = JSON.parse(text);
      if (d.result === 'pass' && typeof d.skill === 'string' && await realpath(d.skill) === expected) return;
    } catch { /* Other reviewed artifacts need not be doctor reports. */ }
  }
  throw new Error('Self-test requires the pinned project skill\'s passing child doctor.json');
}
export class MacDriver implements Driver {
  constructor(private run: Command = command, private review: Ask = ask) {}
  async prepare(receipt: Receipt): Promise<Installation[]> {
    const root = receipt.artifactRoot;
    await doctor(root, this.run);
    const installs: Installation[] = [];
    for (const harness of HARNESSES) {
      const home = join(root, 'state', harness), workspace = join(home, 'workspace');
      await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
      await mkdir(join(home, 'config'), { recursive: true, mode: 0o700 });
      const env = isolatedEnv(home, harness);
      await this.run(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, workspace], { env });
      await this.run(['git', 'fetch', 'origin', receipt.sha], { cwd: workspace, env });
      await this.run(['git', 'checkout', '--detach', receipt.sha], { cwd: workspace, env });
      if ((await this.run(['git', 'rev-parse', 'HEAD'], { cwd: workspace, env })).trim() !== receipt.sha) throw new Error('Candidate checkout SHA mismatch');
      const candidate = join(workspace, 'plugins/pstack'), expected = await treeHash(candidate);
      let location = candidate;
      if (harness === 'claude') await writeFile(join(home, 'settings.json'), '{}\n', { mode: 0o600 });
      else {
        const added = await this.run(['codex', 'plugin', 'marketplace', 'add', workspace, '--json'], { env, cwd: home });
        await save(join(root, 'codex-marketplace.json'), JSON.parse(added));
        const installed = await this.run(['codex', 'plugin', 'add', 'pstack@open-pstack', '--json'], { env, cwd: home });
        await save(join(root, 'codex-install.json'), JSON.parse(installed));
        location = await codexInstallation(installed, home, expected);
        const listed = await this.run(['codex', 'plugin', 'list', '--marketplace', 'open-pstack', '--json'], { env, cwd: home });
        verifyCodexEnabled(listed);
        await save(join(root, 'codex-plugins.json'), JSON.parse(listed));
      }
      const manifest = JSON.parse(await readFile(join(location, harness === 'claude' ? '.claude-plugin/plugin.json' : '.codex-plugin/plugin.json'), 'utf8'));
      installs.push({ harness, sha: receipt.sha, home, location, treeHash: expected, pluginVersion: manifest.version,
        cliVersion: (await this.run([harness, '--version'], { env })).trim() });
    }
    return installs;
  }
  async exercise(receipt: Receipt): Promise<Observation[]> {
    const observations: Observation[] = [];
    for (const installation of receipt.installations) {
      const { harness, home } = installation, workspace = join(home, 'workspace');
      const env = isolatedEnv(home, harness);
      const request = { sha: receipt.sha, harness, workspace, features: requiredFeatures(receipt),
        featureMap: join(workspace, '.claude/skills/verify-open-pstack/features'),
        selfTest: requiredFeatures(receipt).includes('project-skill') ? 'Invoke the project skill natively; run only doctor with fresh output outside workspace. Do not invoke run or publish recursively.' : false };
      await save(join(receipt.artifactRoot, `${harness}-request.json`), request);
      console.log(JSON.stringify(request, null, 2));
      const login = await this.review(`Authenticate only in this isolated ${harness} home if needed. Launch an unrecorded login session now? Type LOGIN or SKIP (already authenticated in this isolated home).`);
      if (login === 'LOGIN') await this.run(harness === 'claude' ? ['claude', 'auth', 'login'] : ['codex', 'login'], { cwd: workspace, env, interactive: true });
      else if (login !== 'SKIP') throw new Error('Expected LOGIN or SKIP');
      const raw = join(home, 'surface.raw');
      console.log('Exercise every requested feature from the native surface, using the maintained feature map. Exit when done.');
      await this.run(['script', '-q', raw, ...launch(harness, home, workspace)], { cwd: workspace, env, interactive: true });
      if (await treeHash(installation.location) !== installation.treeHash) throw new Error('Installed tree changed during exercise');
      const transcript = await retainedFile(receipt.artifactRoot, await this.review(`Copy/redact ${raw} into output (outside state), review it, and enter the reviewed transcript path:`));
      const text = await readFile(join(receipt.artifactRoot, transcript.path), 'utf8');
      if (redact(text) !== text) throw new Error('Transcript contains recognizable credentials; redact before accepting');
      for (const feature of requiredFeatures(receipt)) {
        const surface = await this.review(`${harness}/${feature}: native surface/discovery entry point?`);
        const action = await this.review('Concrete action exercised?');
        const observed = await this.review('Observed assertion/result (not the model\'s success claim)?');
        const artifacts = [];
        for (const path of (await this.review('Reviewed artifact paths inside output, one or more separated by commas?')).split(',')) {
          artifacts.push(await retainedFile(receipt.artifactRoot, path.trim()));
        }
        if (feature === 'project-skill') {
          const doctors = await Promise.all(artifacts.map(a => readFile(join(receipt.artifactRoot, a.path), 'utf8')));
          await verifyProjectDoctor(doctors, workspace);
        }
        if (await this.review(`Operator: type PASS ${feature} only after reviewing the native transcript and artifacts; anything else fails.`) !== `PASS ${feature}`) {
          throw new Error(`Operator rejected ${harness}/${feature}`);
        }
        observations.push({ harness, feature, surface: redact(surface), action: redact(action), observed: redact(observed),
          reviewer: 'operator', transcript: transcript.path, transcriptHash: transcript.sha256, artifacts });
      }
    }
    return observations;
  }
}
