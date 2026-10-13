import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCatalog, recipe, type Case, type Fixture } from '../features/recipes.ts';
import { command } from './io.ts';
import type { Harness, SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const workspace = resolve(import.meta.dir, '../../../..'), location = join(workspace, 'plugins/pstack');

async function fixture(harness: Harness): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-catalog-recipe-'))); roots.push(dir);
  return { harness, dir, workspace, location, configHome: dir, run: command };
}
const record = (harness: Harness, skill: string): SessionRecord =>
  ({ harness, exitCode: 0, started: Date.now() - 1000, skills: [skill], commands: [], tools: [], context: [] });
const sheet = async (path: string): Promise<Map<string, string[]>> => new Map((await readFile(path, 'utf8')).split('\n')
  .filter(line => /^[a-z][^:]*: \S/.test(line)).map((line): [string, string[]] => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2).split(', ')]));
const setupCase = (id: string): Case => recipe('setup', 'claude').find(c => c.id === id)!;

test('reads role defaults, kept predecessors and routes from the generated catalog', async () => {
  const installed = await readCatalog(location);
  expect([...installed.defaults.keys()]).toContain('arena runners');
  expect(installed.kept.get('grok:grok-4.6')).toMatch(/^grok:/);
  for (const harness of ['claude', 'codex'] as const) {
    expect(installed.route(harness, `${harness}:any@max`)).toBe('native');
    expect(installed.route(harness, 'grok:any@max')).toBe('external');
    expect(installed.route(harness, 'inherit-parent')).toBe('native');
  }
  expect(() => installed.route('claude', 'devin:any@max')).toThrow('catalog-route-missing');
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the catalog case accepts the sheet's descriptors and catalog routes, and rejects a wrong route`, async () => {
    const f = await fixture(harness), [c] = recipe('catalog', harness), installed = await readCatalog(location);
    await c!.prepare!(f);
    const lines = await sheet(join(f.dir, 'pstack-models.md'));
    const roles: string[] = JSON.parse(`[${/the route of each: (.*?)\. Write to/.exec(c!.prompt(f))![1]}]`);
    expect(roles.length).toBeGreaterThan(0);
    // What a correct parent reports: the sheet's line, else the role default, routed by the catalog.
    const report = { roles: roles.map(role => {
      const descriptors = lines.get(role) ?? installed.defaults.get(role)!;
      return { role, descriptors, routes: descriptors.map(d => installed.route(harness, d)) };
    }) };
    expect(report.roles[0]!.descriptors).not.toEqual(installed.defaults.get(report.roles[0]!.role));
    expect(roles.slice(1)).toEqual(['arena runners', 'bug-fix']);
    for (const role of roles.slice(1)) expect(lines.has(role)).toBe(false);
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    expect((await c!.assert(record(harness, 'pstack:poteto-mode'), f)).assertions.slice(0, 2)).toEqual(['skill-loaded', 'file:routes.json']);

    report.roles[0]!.routes = report.roles[0]!.routes.map(r => r === 'native' ? 'external' : 'native');
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
  });
}

test('the kept-predecessor case requires the kept model, the materialized role and the proposed replacement', async () => {
  const f = await fixture('claude'), c = setupCase('keep-predecessor'), installed = await readCatalog(location);
  await c.prepare!(f);
  const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8');
  const omitted = [...installed.defaults.keys()].find(role => !prepared.includes(`\n${role}: `))!;
  expect(installed.defaults.get(omitted)).toEqual(['inherit-parent']);
  const rerun = `${prepared}${omitted}: inherit-parent\n`;
  await writeFile(path, rerun);
  await writeFile(join(f.dir, 'proposal.json'), JSON.stringify({ kept: 'grok:grok-4.6@high', proposed: `${installed.kept.get('grok:grok-4.6')}@high` }));
  expect((await c.assert(record('claude', 'pstack:setup-pstack'), f)).assertions).toContain('kept:grok:grok-4.6@high');

  await writeFile(path, rerun.replaceAll('grok:grok-4.6@', `${installed.kept.get('grok:grok-4.6')}@`));
  await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow('kept-predecessor-replaced');
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the runner recipe's default route is the candidate's role default for this parent`, async () => {
    const f = await fixture(harness), [c] = recipe('runner', harness), installed = await readCatalog(location);
    await c!.prepare!(f);
    const [route] = installed.defaults.get(harness === 'claude' ? 'bug-fix' : 'judgment and prose')!;
    const [provider, rest] = route!.split(':'), [model, effort] = rest!.split('@');
    expect(provider).not.toBe(harness);
    expect(c!.prompt(f)).toContain(`--parent ${harness} --provider ${provider} --model ${model} --effort ${effort} --mode read-only`);
  });
}

test('the first-run case requires a sheet equal to the catalog role defaults', async () => {
  const f = await fixture('codex'), c = setupCase('first-run'), installed = await readCatalog(location);
  const path = join(f.dir, 'pstack-models.md');
  await writeFile(path, 'stale\n'); await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
  await c.prepare!(f);
  await expect(readFile(path)).rejects.toThrow();
  await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
  const lines = [...installed.defaults].map(([role, lanes]) => `${role}: ${lanes.join(', ')}`);
  await writeFile(path, `# pstack model configuration\n\n${lines.join('\n')}\n`);
  expect((await c.assert(record('codex', 'pstack:setup-pstack'), f)).assertions).toContain('sheet:role-defaults');
  await writeFile(path, `# pstack model configuration\n\n${lines.slice(1).join('\n')}\n`);
  await expect(c.assert(record('codex', 'pstack:setup-pstack'), f)).rejects.toThrow('first-run-not-role-defaults');
});
