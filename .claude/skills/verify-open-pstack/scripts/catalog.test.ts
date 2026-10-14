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
const mirror = (f: Fixture, text: string) =>
  writeFile(join(f.dir, 'AGENTS.md'), `notes\n<!-- pstack:models:begin -->\n${text}<!-- pstack:models:end -->\n`);

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
    // What a correct parent reports: the sheet's line, else the role default, with a Sonnet revision normalized to
    // its rolling alias, routed by the catalog.
    const dispatched = (d: string) => d.replace(/^claude:claude-sonnet-[0-9-]+@/, 'claude:sonnet@');
    const report = { roles: roles.map(role => {
      const descriptors = (lines.get(role) ?? installed.defaults.get(role)!).map(dispatched);
      return { role, descriptors, routes: descriptors.map(d => installed.route(harness, d)) };
    }) };
    expect(report.roles[0]!.descriptors).not.toEqual(installed.defaults.get(report.roles[0]!.role));
    expect(roles.slice(1, 3)).toEqual(['arena runners', 'bug-fix']);
    for (const role of roles.slice(1, 3)) expect(lines.has(role)).toBe(false);
    expect(roles.slice(3)).toEqual(['swarm workers', 'hardest tasks', 'how explainer']);
    expect(roles.slice(3).map(role => lines.get(role))).toEqual([
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:claude-sonnet-5-5@high'],
    ]);
    expect(report.roles.slice(3).map(r => [r.descriptors, r.routes])).toEqual([
      [['codex:gpt-6-luna@max'], [harness === 'codex' ? 'native' : 'external']],
      [['claude:claude-opus-5-5@max'], [harness === 'claude' ? 'native' : 'external']],
      [['claude:sonnet@high'], [harness === 'claude' ? 'native' : 'external']],
    ]);
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    expect((await c!.assert(record(harness, 'pstack:poteto-mode'), f)).assertions.slice(0, 2)).toEqual(['skill-loaded', 'file:routes.json']);

    // A parent that leaves the Sonnet revision unnormalized, or normalizes the pin to opus, fails.
    for (const [role, wrong] of [['how explainer', 'claude:claude-sonnet-5-5@high'], ['hardest tasks', 'claude:opus@max']]) {
      const changed = { roles: report.roles.map(r => r.role === role ? { ...r, descriptors: [wrong!] } : r) };
      await writeFile(join(f.dir, 'routes.json'), JSON.stringify(changed));
      await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
    }

    report.roles[0]!.routes = report.roles[0]!.routes.map(r => r === 'native' ? 'external' : 'native');
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
  });
}

test('the kept-predecessor case requires every loaded role, the materialized role and the proposed replacement', async () => {
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
  await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow('kept-sheet-mismatch');

  // A rerun that keeps the model but drops a loaded role fails too.
  await writeFile(path, rerun.replace(/\nbug-fix: [^\n]*/, ''));
  await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow('kept-sheet-mismatch');
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the new-families case keeps Luna, Sonnet and the pin, and requires the old pin as opus`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'new-families')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8'), lines = await sheet(path);
    expect([...lines.keys()]).toEqual([...installed.defaults.keys()]);
    expect(['swarm workers', 'hardest tasks', 'how explainer', 'judgment and prose'].map(role => lines.get(role))).toEqual([
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:claude-sonnet-5-5@max'], ['claude:claude-opus-5@max'],
    ]);
    for (const [role, lanes] of installed.defaults) {
      if (!['swarm workers', 'hardest tasks', 'how explainer', 'judgment and prose'].includes(role)) expect(lines.get(role)).toEqual(lanes);
    }

    const rerun = prepared.replace('judgment and prose: claude:claude-opus-5@max', 'judgment and prose: claude:opus@max')
      .replace('how explainer: claude:claude-sonnet-5-5@max', 'how explainer: claude:sonnet@max');
    await writeFile(path, rerun);
    if (harness === 'codex') await mirror(f, rerun);
    expect((await c.assert(record(harness, 'pstack:setup-pstack'), f)).assertions).toEqual([
      'skill-loaded', 'file:pstack-models.md', ...(harness === 'codex' ? ['codex-mirror'] : []),
      'sheet:codex:gpt-6-luna@max', 'sheet:claude:claude-opus-5-5@max', 'sheet:claude:sonnet@max', 'sheet:claude:opus@max',
    ]);

    // Keeping an old revision, normalizing the registered pin, or dropping a role each fails.
    for (const wrong of [prepared, rerun.replace('how explainer: claude:sonnet@max', 'how explainer: claude:claude-sonnet-5-5@max'), rerun.replace('claude:claude-opus-5-5@max', 'claude:opus@max'), rerun.replace(/\nbug-fix: [^\n]*/, '')]) {
      await writeFile(path, wrong);
      await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('new-families-sheet-mismatch');
    }
    await writeFile(path, rerun);

    // On Codex, the AGENTS.md block must mirror the rewritten sheet.
    if (harness === 'codex') {
      // A stale block, a block missing the sheet's last newline, or a second block each fails.
      for (const agents of [`<!-- pstack:models:begin -->\n${prepared}<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun.replace(/\n$/, '')}<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun}<!-- pstack:models:end -->\n<!-- pstack:models:begin -->\nold\n<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun}<!-- pstack:models:end -->\n<!-- pstack:models:begin -->`]) {
        await writeFile(join(f.dir, 'AGENTS.md'), agents);
        await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('codex-mirror-mismatch');
      }
    }
  });

  test(`${harness}: the runner recipe's default route is the candidate's role default for this parent`, async () => {
    const f = await fixture(harness), [c] = recipe('runner', harness), installed = await readCatalog(location);
    await c!.prepare!(f);
    const [route] = installed.defaults.get(harness === 'claude' ? 'bug-fix' : 'judgment and prose')!;
    const [provider, rest] = route!.split(':'), [model, effort] = rest!.split('@');
    expect(provider).not.toBe(harness);
    expect(c!.prompt(f)).toContain(`--parent ${harness} --provider ${provider} --model ${model} --effort ${effort} --mode read-only`);
  });
}

test('the native-agents case needs each new agent dispatched, its child run, and its own nonce written', async () => {
  const f = await fixture('claude'), c = recipe('catalog', 'claude').find(c => c.id === 'native-agents')!;
  expect(recipe('catalog', 'codex').some(c => c.id === 'native-agents')).toBe(false);
  await c.prepare!(f);
  const agents = ['pstack-sonnet-max', 'pstack-opus-5-5-max'];
  const tools = (names: string[], children = names) => [
    ...names.map((agent, i) => ({ name: 'Agent', id: `a${i}`, input: { subagent_type: `pstack:${agent}` }, parent: null, failed: false })),
    ...children.map(agent => ({ name: 'Read', id: `r-${agent}`, input: {}, parent: `a${names.indexOf(agent)}`, failed: false })),
  ];
  const run = (names: string[], children?: string[]): SessionRecord => ({ ...record('claude', 'pstack:poteto-mode'), tools: tools(names, children) });
  for (const agent of agents) await writeFile(join(f.dir, `${agent}.out`), await readFile(join(f.dir, `${agent}.nonce`), 'utf8'));
  expect((await c.assert(run(agents), f)).assertions).toEqual(agents.map(agent => `native:${agent}`));

  await expect(c.assert(run(['pstack-sonnet-max', 'pstack-opus-max']), f)).rejects.toThrow('agent-not-dispatched:pstack:pstack-opus-5-5-max');
  await expect(c.assert(run(agents, ['pstack-sonnet-max']), f)).rejects.toThrow('child-did-not-run:pstack:pstack-opus-5-5-max');
  // A model override on the dispatch would run the agent on another model.
  const overridden = run(agents);
  overridden.tools[1]!.input.model = 'opus';
  await expect(c.assert(overridden, f)).rejects.toThrow('agent-not-dispatched:pstack:pstack-opus-5-5-max');
  await writeFile(join(f.dir, 'pstack-sonnet-max.out'), 'guess\n');
  await expect(c.assert(run(agents), f)).rejects.toThrow('nonce-mismatch:pstack:pstack-sonnet-max');
});

test('the first-run case requires a sheet equal to the catalog role defaults', async () => {
  const f = await fixture('codex'), c = setupCase('first-run'), installed = await readCatalog(location);
  const path = join(f.dir, 'pstack-models.md');
  await writeFile(path, 'stale\n'); await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
  await c.prepare!(f);
  await expect(readFile(path)).rejects.toThrow();
  await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
  const lines = [...installed.defaults].map(([role, lanes]) => `${role}: ${lanes.join(', ')}`);
  const written = `# pstack model configuration\n\n${lines.join('\n')}\n`;
  await writeFile(path, written);
  await expect(c.assert(record('codex', 'pstack:setup-pstack'), f)).rejects.toThrow('codex-mirror-mismatch');
  await mirror(f, written);
  expect((await c.assert(record('codex', 'pstack:setup-pstack'), f)).assertions).toContain('sheet:role-defaults');
  await writeFile(path, `# pstack model configuration\n\n${lines.slice(1).join('\n')}\n`);
  await expect(c.assert(record('codex', 'pstack:setup-pstack'), f)).rejects.toThrow('first-run-not-role-defaults');
});
