import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { requiredFeatures, requiredHarnesses } from './core.ts';
import { command, interruption, isolatedEnv, retainedFile, save, treeHash, type Command } from './io.ts';
import { doctor } from './doctor.ts';
import { copyCredentials, credentialSources, removeCredentials } from './isolation.ts';
import { sourceDigest, sourceHash } from './provenance.ts';
import { EVIDENCE_LIMIT, publishable } from './verify.ts';
import { HARNESSES, REPO, type CredentialSources, type Driver, type Harness, type Installation, type Observation, type Receipt } from './types.ts';

export type Ask = (question: string) => Promise<string>;
export const ask: Ask = async question => {
  if (!process.stdin.isTTY) throw new Error('Operator review requires an interactive terminal');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question + '\n> ', { signal: interruption.signal })).trim(); } finally { reader.close(); }
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
  if (await treeHash(path, ['skills/poteto-mode/scripts/node_modules']) !== expected) throw new Error('Codex installed tree differs from pinned candidate');
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
      if (d.result === 'pass' && d.candidate === true && typeof d.skill === 'string' && await realpath(d.skill) === expected) return;
    } catch { /* Other reviewed artifacts need not be doctor reports. */ }
  }
  throw new Error('Self-test requires the pinned project skill\'s passing child doctor.json');
}
export class MacDriver implements Driver {
  private copied: string[] = [];
  constructor(private run: Command = command, private review: Ask = ask, private sources?: CredentialSources) {}
  async cleanup(): Promise<void> { await removeCredentials(this.copied); }
  private candidate(home: string): Command {
    return (args, options = {}) => this.run(args, { ...options, env: isolatedEnv(home) });
  }
  private refuseSetup(receipt: Receipt): void {
    if (requiredFeatures(receipt).some(feature => feature === 'setup' || feature === 'skill-invocation:setup-pstack')) {
      throw new Error('setup exercise requires #120 (setup-pstack config-home)');
    }
  }
  async prepare(receipt: Receipt): Promise<Installation[]> {
    this.refuseSetup(receipt);
    const root = receipt.artifactRoot;
    if (!this.sources) throw new Error('Explicit --claude-config and --codex-home credential directories are required');
    await doctor(root, this.run, undefined, false, this.sources);
    const sources = await credentialSources(this.sources);
    // Fetch a separate immutable reference for pinned-source comparisons.
    const referenceHome = join(root, 'source-home'), reference = join(referenceHome, 'workspace');
    await mkdir(join(referenceHome, 'tmp'), { recursive: true, mode: 0o700 });
    const trustedRun: Command = (args, options = {}) => this.run(args, { ...options, env: isolatedEnv(referenceHome) });
    await trustedRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, reference]);
    await trustedRun(['git', 'fetch', 'origin', receipt.sha], { cwd: reference });
    await trustedRun(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', receipt.sha], { cwd: reference });
    const pinnedSource = await sourceHash(reference, receipt.sha, trustedRun);
    if (process.platform !== 'darwin') throw new Error('Live proof requires the operator Mac');
    const installs: Installation[] = [];
    for (const harness of requiredHarnesses(receipt)) {
      const home = join(root, 'state', harness), workspace = join(home, 'workspace');
      await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
      for (const dir of ['.claude', '.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
      await writeFile(join(home, 'settings.json'), '{}\n', { mode: 0o600 });
      const env = isolatedEnv(home, harness);
      const candidateRun = this.candidate(home);
      await candidateRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, workspace], { env });
      await candidateRun(['git', 'fetch', 'origin', receipt.sha], { cwd: workspace, env });
      await candidateRun(['git', 'checkout', '--detach', receipt.sha], { cwd: workspace, env });
      if ((await candidateRun(['git', 'rev-parse', 'HEAD'], { cwd: workspace, env })).trim() !== receipt.sha) throw new Error('Candidate checkout SHA mismatch');
      const candidate = join(workspace, 'plugins/pstack'), expected = await treeHash(candidate, ['skills/poteto-mode/scripts/node_modules']);
      if (await sourceDigest(workspace) !== pinnedSource) throw new Error('Candidate files differ from trusted pinned source');
      await copyCredentials(home, sources, this.copied);
      let location = candidate;
      if (harness === 'codex') {
        const added = await candidateRun(['codex', 'plugin', 'marketplace', 'add', workspace, '--json'], { env, cwd: home });
        await save(join(root, 'codex-marketplace.json'), JSON.parse(added));
        const installed = await candidateRun(['codex', 'plugin', 'add', 'pstack@open-pstack', '--json'], { env, cwd: home });
        await save(join(root, 'codex-install.json'), JSON.parse(installed));
        location = await codexInstallation(installed, home, expected);
        const listed = await candidateRun(['codex', 'plugin', 'list', '--marketplace', 'open-pstack', '--json'], { env, cwd: home });
        verifyCodexEnabled(listed);
        await save(join(root, 'codex-plugins.json'), JSON.parse(listed));
      }
      const manifest = JSON.parse(await readFile(join(location, harness === 'claude' ? '.claude-plugin/plugin.json' : '.codex-plugin/plugin.json'), 'utf8'));
      if (await sourceDigest(workspace) !== pinnedSource) throw new Error('Pinned source changed during installation');
      installs.push({ harness, sha: receipt.sha, home, location, treeHash: expected, sourceHash: pinnedSource, credentialSource: sources[harness], pluginVersion: manifest.version,
        cliVersion: (await candidateRun([harness, '--version'], { env })).trim() });
    }
    return installs;
  }
  async exercise(receipt: Receipt): Promise<Observation[]> {
    this.refuseSetup(receipt);
    const observations: Observation[] = [];
    for (const installation of receipt.installations) {
      const { harness, home } = installation, workspace = join(home, 'workspace');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned source changed before exercise');
      const env = isolatedEnv(home, harness), candidateRun = this.candidate(home);
      const request = { sha: receipt.sha, harness, workspace, features: requiredFeatures(receipt, harness),
        featureMap: join(workspace, '.claude/skills/verify-open-pstack/features'),
        selfTest: requiredFeatures(receipt, harness).includes('project-skill') ? `Invoke the candidate project skill natively; run doctor --candidate --output "${join(home, 'self-test')}". Do not invoke run, login, or publication recursively.` : false,
        credentials: { claude: env.CLAUDE_CONFIG_DIR, codex: env.CODEX_HOME },
        isolation: 'Real HOME/USER; both provider config roots and temporary state are run-owned. Use only copied disposable file credentials, never log in or write back to the credential sources. Exercise real requests; quota/auth failures fail closed.' };
      await save(join(receipt.artifactRoot, `${harness}-request.json`), request);
      console.log(JSON.stringify(request, null, 2));
      const raw = join(home, 'surface.raw');
      console.log('Exercise every requested feature from the native surface, using the maintained feature map. Exit when done.');
      await candidateRun(['/usr/bin/script', '-q', raw, ...launch(harness, home, workspace)], { cwd: workspace, env, interactive: true });
      if (await treeHash(installation.location, ['skills/poteto-mode/scripts/node_modules']) !== installation.treeHash) throw new Error('Installed tree changed during exercise');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned project/plugin source changed during exercise');
      const transcript = await retainedFile(receipt.artifactRoot, await this.review(`Retain a private copy of ${raw} inside output (outside state), review it, and enter its path. Do not publish raw content:`));
      for (const feature of requiredFeatures(receipt, harness)) {
        const answers = { surface: '', action: '', observed: '' };
        for (const [field, question] of [['surface', `${harness}/${feature}: native surface/discovery entry point?`], ['action', 'Concrete action exercised?'], ['observed', 'Observed assertion/result (not the model\'s success claim)?']] as const) {
          do { answers[field] = await this.review(`${question} Use printable ASCII, no backtick, < or >, and at most ${EVIDENCE_LIMIT} characters.`); } while (!publishable(answers[field]));
        }
        const { surface, action, observed } = answers;
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
        observations.push({ harness, feature, surface, action, observed,
          reviewer: 'operator', transcript: transcript.path, transcriptHash: transcript.sha256, artifacts });
      }
    }
    return observations;
  }
}
