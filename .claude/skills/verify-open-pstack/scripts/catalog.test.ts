import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
    expect(installed.route(harness, 'devin:any@max')).toBe('external');
    expect(installed.route(harness, 'inherit-parent')).toBe('native');
  }
  expect(() => installed.route('claude', 'cursor:any@max')).toThrow('catalog-route-missing');
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
    // The sheet opts Codex writers into full access, which only Claude's external runner route passes on.
    expect(lines.get('codex writer sandbox')).toEqual(['full-access']);
    const report = { roles: roles.map(role => {
      const descriptors = (lines.get(role) ?? installed.defaults.get(role)!).map(dispatched);
      return { role, descriptors, routes: descriptors.map(d => installed.route(harness, d)) };
    }), writerSandbox: harness === 'claude' ? 'full-access' : null };
    expect(report.roles[0]!.descriptors).not.toEqual(installed.defaults.get(report.roles[0]!.role));
    expect(roles.slice(1, 3)).toEqual(['arena runners', 'bug-fix']);
    for (const role of roles.slice(1, 3)) expect(lines.has(role)).toBe(false);
    expect(roles.slice(3)).toEqual(['swarm workers', 'hardest tasks', 'how explainer', 'how explorer', 'feature, refactoring']);
    expect(roles.slice(3).map(role => lines.get(role))).toEqual([
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:claude-sonnet-5-5@high'], ['devin:swe-2@max'],
      ['codex:gpt-6.1-sol@max'],
    ]);
    expect(report.roles.slice(3).map(r => [r.descriptors, r.routes])).toEqual([
      [['codex:gpt-6-luna@max'], [harness === 'codex' ? 'native' : 'external']],
      [['claude:claude-opus-5-5@max'], [harness === 'claude' ? 'native' : 'external']],
      [['claude:sonnet@high'], [harness === 'claude' ? 'native' : 'external']],
      [['devin:swe-2@max'], ['external']],
      [['codex:gpt-6.1-sol@max'], [harness === 'codex' ? 'native' : 'external']],
    ]);
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    expect((await c!.assert(record(harness, 'pstack:poteto-mode'), f)).assertions.slice(0, 2)).toEqual(['skill-loaded', 'file:routes.json']);

    // A parent that leaves the Sonnet revision unnormalized, normalizes the pin to opus, or reports the role default
    // in place of the Devin lane, fails.
    for (const [role, wrong] of [['how explainer', 'claude:claude-sonnet-5-5@high'], ['hardest tasks', 'claude:opus@max'], ['how explorer', installed.defaults.get('how explorer')![0]]]) {
      const changed = { roles: report.roles.map(r => r.role === role ? { ...r, descriptors: [wrong!] } : r) };
      await writeFile(join(f.dir, 'routes.json'), JSON.stringify(changed));
      await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
    }

    // A Claude parent that passes no writer sandbox fails, and so does a Codex parent that passes one to its native writer.
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify({ ...report, writerSandbox: harness === 'claude' ? null : 'full-access' }));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');

    // A parent that routes the Devin lane natively fails.
    const nativeDevin = { roles: report.roles.map(r => r.role === 'how explorer' ? { ...r, routes: ['native'] } : r) };
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(nativeDevin));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');

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
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:sonnet@max'], ['claude:claude-opus-5@max'],
    ]);
    for (const [role, lanes] of installed.defaults) {
      if (!['swarm workers', 'hardest tasks', 'how explainer', 'judgment and prose'].includes(role)) expect(lines.get(role)).toEqual(lanes);
    }

    const rerun = prepared.replace('judgment and prose: claude:claude-opus-5@max', 'judgment and prose: claude:opus@max');
    await writeFile(path, rerun);
    expect((await c.assert(record(harness, 'pstack:setup-pstack'), f)).assertions).toEqual([
      'skill-loaded', 'file:pstack-models.md',
      'sheet:codex:gpt-6-luna@max', 'sheet:claude:claude-opus-5-5@max', 'sheet:claude:sonnet@max', 'sheet:claude:opus@max',
    ]);

    // Keeping the old pin, normalizing the registered pin, or dropping a role each fails.
    for (const wrong of [prepared, rerun.replace('claude:claude-opus-5-5@max', 'claude:opus@max'), rerun.replace(/\nbug-fix: [^\n]*/, '')]) {
      await writeFile(path, wrong);
      await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('new-families-sheet-mismatch');
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

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the read-only-provider case requires every role line, with how explorer on Devin, and a runner probe`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'read-only-provider')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8'), lines = await sheet(path);
    expect([...lines.keys()]).toEqual([...installed.defaults.keys()]);
    for (const [role, lanes] of installed.defaults) expect(lines.get(role)).toEqual(role === 'how explorer' ? ['devin:swe-2@max'] : lanes);

    const probed = { ...record(harness, 'pstack:setup-pstack'), commands: ['"$RUNNER/pstack-runner" --provider devin'] };
    expect((await c.assert(probed, f)).assertions).toEqual(['skill-loaded', 'file:pstack-models.md', 'runner-ran', 'sheet:devin:swe-2@max']);

    // No runner call fails; so does dropping the Devin lane or another role.
    await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('runner-not-run');
    for (const wrong of [prepared.replace('how explorer: devin:swe-2@max', `how explorer: ${installed.defaults.get('how explorer')!.join(', ')}`), prepared.replace(/\nbug-fix: [^\n]*/, '')]) {
      await writeFile(path, wrong);
      await expect(c.assert(probed, f)).rejects.toThrow('read-only-provider-sheet-mismatch');
    }
  });

  test(`${harness}: the runner recipe accepts any external provider in the installed catalog and refuses others`, async () => {
    const f = await fixture(harness);
    const [devin, swe16] = recipe('runner', harness, ['devin:swe-2@max', 'devin:swe-1.6@default']);
    await devin!.prepare!(f);
    await swe16!.prepare!(f);
    expect(devin!.prompt(f)).toContain(`--parent ${harness} --provider devin --model swe-2 --effort max --mode read-only`);
    expect(swe16!.prompt(f)).toContain(`--parent ${harness} --provider devin --model swe-1.6 --effort default --mode read-only`);
    const [unknown] = recipe('runner', harness, ['cursor:auto@default']);
    await expect(unknown!.prepare!(f)).rejects.toThrow('catalog-route-missing:cursor:auto@default');
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

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the keep-setting case requires the setting line and every role line after a rerun`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'keep-setting')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8');
    expect(prepared).toEndWith('\ncodex writer sandbox: full-access\n');
    const omitted = [...installed.defaults.keys()].find(role => !prepared.includes(`\n${role}: `))!;
    expect(installed.defaults.get(omitted)).toEqual(['inherit-parent']);
    const rerun = prepared.replace('codex writer sandbox: full-access\n', `${omitted}: inherit-parent\ncodex writer sandbox: full-access\n`);
    await writeFile(path, rerun);
    expect((await c.assert(record(harness, 'pstack:setup-pstack'), f)).assertions)
      .toEqual(['skill-loaded', 'file:pstack-models.md', 'setting:codex writer sandbox: full-access']);

    // Dropping the setting, changing it, or dropping a role fails.
    for (const [wrong, reason] of [
      [rerun.replace('codex writer sandbox: full-access\n', ''), 'setting-not-kept'],
      [rerun.replace('sandbox: full-access', 'sandbox: bounded'), 'setting-not-kept'],
      [rerun.replace(/\nbug-fix: [^\n]*/, ''), 'keep-setting-sheet-mismatch'],
    ]) {
      await writeFile(path, wrong!);
      await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow(reason);
    }
  });
}

// Stands in for Codex: logged in, and the model call writes the result the test hands it under `.agents/`.
const FAKE_CODEX = `#!/bin/sh
if [ "$1" = "login" ]; then echo 'Logged in using ChatGPT'; exit 0; fi
cat > /dev/null
mkdir -p .agents && printf '%s' "$FAKE_RESULT" > .agents/result.json
echo '{"type":"item.completed","item":{"type":"agent_message","text":"DONE"}}'
`;

test('the full-access writer case requires the opted-in receipt and both nonces in the child result', async () => {
  const f = await fixture('claude'), c = recipe('runner', 'claude').find(c => c.id === 'full-access-writer')!;
  await c.prepare!(f);
  // The parent gets the sheet and the role, never the flag; the sheet holds the opt-in and the writer lane.
  expect(c.prompt(f)).not.toContain('--writer-sandbox');
  const lines = await sheet(join(f.dir, 'full-access.sheet.md'));
  expect([lines.get('feature, refactoring'), lines.get('codex writer sandbox')]).toEqual([['codex:gpt-6.1-sol@max'], ['full-access']]);
  // Only the browser's DOM holds the page nonce; the child prompt holds the file nonce.
  const page = await readFile(join(f.dir, 'full-access.page.html'), 'utf8');
  const pageNonce = atob(/atob\('([^']+)'\)/.exec(page)![1]!), fileNonce = /"written":"([0-9a-f-]+)"/.exec(await readFile(join(f.dir, 'full-access.prompt.md'), 'utf8'))![1]!;
  expect(page).not.toContain(pageNonce);

  const bin = join(f.dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'codex'), FAKE_CODEX); await chmod(join(bin, 'codex'), 0o755);
  const launch = async (sandbox: string, name: string): Promise<Record<string, unknown>> => {
    const args = ['--parent', 'claude', '--provider', 'codex', '--model', 'gpt-6.1-sol', '--effort', 'max', '--mode', 'isolated-write',
      '--writer-sandbox', sandbox, '--prompt', join(f.dir, 'full-access.prompt.md'), '--cwd', join(f.dir, 'full-access-lane'),
      '--output', join(f.dir, `${name}.md`), '--receipt', join(f.dir, `${name}.json`)];
    const child = Bun.spawn([join(location, 'skills/poteto-mode/scripts/runner/pstack-runner'), ...args], { stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RESULT: JSON.stringify({ written: fileNonce, browser: pageNonce }) } });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0);
    return JSON.parse(await readFile(join(f.dir, `${name}.json`), 'utf8'));
  };
  const run = { ...record('claude', 'pstack:poteto-mode'), commands: ['"$RUNNER/pstack-runner" --provider codex'] };
  // The case reads the receipt and output at full-access.receipt.json and full-access.output.md.
  const receipt = await launch('full-access', 'full-access.receipt');
  await rm(join(f.dir, 'full-access.receipt.md'));
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...receipt, outputPath: join(f.dir, 'full-access.output.md') }));
  expect((await c.assert(run, f)).assertions).toEqual(['runner-ran', 'receipt-complete', 'writer-sandbox:full-access', 'file:result.json', 'browser-nonce']);

  // A bounded writer fails, and so does a result without the browser's nonce.
  const bounded = await launch('bounded', 'bounded.receipt');
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...bounded, outputPath: join(f.dir, 'full-access.output.md') }));
  await expect(c.assert(run, f)).rejects.toThrow('writer-sandbox:bounded');
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...receipt, outputPath: join(f.dir, 'full-access.output.md') }));
  await writeFile(join(f.dir, 'full-access-lane/.agents/result.json'), JSON.stringify({ written: fileNonce, browser: 'unrendered' }));
  await expect(c.assert(run, f)).rejects.toThrow('full-access-effect-mismatch');
});
