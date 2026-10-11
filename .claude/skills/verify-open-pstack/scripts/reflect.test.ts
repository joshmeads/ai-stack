import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recipe, shellCommands, type Fixture } from '../features/recipes.ts';
import { command, sha256 } from './io.ts';
import { parseSession } from './harness.ts';
import type { Harness, SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const opening = 'Reflect on the corrections in this disposable session.';
const unrelated = 'An unrelated synthetic opening.';
const chat = '00000000-1111-2222-3333-444444444444';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(harness: Harness): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-reflect-recipe-'))); roots.push(dir);
  const workspace = resolve(import.meta.dir, '../../../..');
  return { harness, dir, workspace, location: join(workspace, 'plugins/pstack'), configHome: dir, run: command };
}

const home = (f: Fixture) => join(f.dir, 'transcript # home');
const transcript = (f: Fixture) => join(home(f), f.harness === 'codex' ? 'sessions/2026/10/11/known.jsonl' : 'projects/fixture/known.jsonl');
const helper = (f: Fixture) => join(f.location, 'skills/poteto-mode/scripts/resolve-codex-transcript.ts');
const resolverCommand = (f: Fixture) => `CODEX_HOME=${quote(home(f))} bun ${quote(helper(f))} ${chat} > ${quote(join(f.dir, 'result.json'))}`;

/** Does what a passing session does: Codex runs the real resolver, Claude reads the fixture and writes its report. */
async function simulatedRecord(f: Fixture, available: boolean): Promise<SessionRecord> {
  if (f.harness === 'codex') {
    const child = Bun.spawn(['bash', '-c', resolverCommand(f)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0); expect(stderr).toBe(''); expect(stdout).toBe('');
  } else {
    await writeFile(join(f.dir, 'result.json'), JSON.stringify(available ? {
      status: 'resolved', path: transcript(f), opening_user_message: { line: 2, characters: opening.length, sha256: sha256(opening) },
    } : { status: 'unresolved', reason: 'opening_message_mismatch', fallback: 'session_digest' }));
  }
  if (!available) await writeFile(join(f.dir, 'digest.md'), 'The requested opening is missing from this synthetic fixture.');
  return { harness: f.harness, exitCode: 0, started: Date.now() - 1000, skills: ['pstack:reflect'],
    commands: f.harness === 'codex' ? [`/bin/zsh -lc ${quote(resolverCommand(f))}`] : [],
    tools: f.harness === 'claude' ? [{ name: 'Read', id: 'read', input: { file_path: transcript(f), offset: 1, limit: 500 }, parent: null, failed: false,
      result: await readFile(transcript(f), 'utf8') }] : [] };
}

test.each(['claude', 'codex'] as const)('%s Reflect recipes verify the opening and the digest fallback rather than a generic result', async harness => {
  const cases = recipe('skill-invocation:reflect', harness);
  expect(cases.map(c => c.id)).toEqual(['locate-transcript', 'digest-fallback']);
  for (const c of cases) {
    const f = await fixture(harness), available = c.id === 'locate-transcript';
    await c.prepare!(f);
    const record = await simulatedRecord(f, available), result = await c.assert(record, f);
    expect(result.assertions).toContain(available ? 'opening-verified' : 'digest-fallback');
    expect(c.prompt(f)).toContain(harness === 'claude' ? '/pstack:reflect' : '$pstack:reflect');
    await expect(c.assert({ ...record, skills: [] }, f)).rejects.toThrow('skill-not-loaded');
    await expect(c.assert({ ...record, commands: [], tools: [] }, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-not-run' : 'reflect-transcript-not-read');
    if (available) {
      await writeFile(join(f.dir, 'digest.md'), 'An unneeded digest.');
      await expect(c.assert(record, f)).rejects.toThrow('reflect-unneeded-fallback');
      const report = JSON.parse(await readFile(join(f.dir, 'result.json'), 'utf8'));
      report.opening_user_message.line = 1; await writeFile(join(f.dir, 'result.json'), JSON.stringify(report));
      await expect(c.assert(record, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-output-mismatch' : 'reflect-opening-mismatch');
    } else {
      if (harness === 'codex') expect(JSON.parse(await readFile(join(f.dir, 'result.json'), 'utf8')).opening_user_message.sha256).toBe(sha256(unrelated));
      await writeFile(join(f.dir, 'digest.md'), 'word '.repeat(2001));
      await expect(c.assert(record, f)).rejects.toThrow('reflect-digest-budget');
      await writeFile(join(f.dir, 'result.json'), JSON.stringify({ status: 'resolved', path: 'unverified' }));
      await expect(c.assert(record, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-output-mismatch' : 'reflect-fallback-mismatch');
    }
  }
});

test.each(['claude', 'codex'] as const)('%s prompts leave the lookup to the installed mapping', async harness => {
  for (const c of recipe('skill-invocation:reflect', harness)) {
    const prompt = c.prompt(await fixture(harness));
    for (const leak of ['resolve-codex-transcript', 'poteto-mode/scripts', 'bun ', 'known.jsonl', 'state_5.sqlite']) expect(prompt).not.toContain(leak);
  }
});

test.each(['claude', 'codex'] as const)('%s echoed paths, source reads and altered commands cannot prove the action', async harness => {
  const f = await fixture(harness), c = recipe('skill-invocation:reflect', harness)[0]!;
  await c.prepare!(f);
  const good = await simulatedRecord(f, true);
  const record: SessionRecord = { ...good, commands: [], tools: [] };
  const target = harness === 'codex' ? helper(f) : transcript(f), exact = resolverCommand(f);
  const falseActions: Partial<SessionRecord>[] = [
    {}, { commands: [`echo ${target}`] }, { commands: [`printf '%s\\n' '${target}'`] }, { commands: [`cat '${helper(f)}'`] },
    { tools: [{ name: 'Read', id: 'source-only', input: { file_path: helper(f), offset: 1, limit: 500 }, parent: null, failed: false, result: 'The helper source.' }] },
  ];
  if (harness === 'codex') {
    falseActions.push(...[
      `echo ${JSON.stringify(exact)}`, exact.split(' > ')[0]!, exact.replace(chat, '00000000-1111-2222-3333-555555555555'),
      exact + '\ntrue', exact + '; true', exact + ' || true', exact + ' | cat', `echo ${quote(helper(f))} ${chat} > ${quote(join(f.dir, 'result.json'))}`,
      exact.replace(helper(f), join(f.dir, 'resolve-codex-transcript.ts')), exact.replace(' > ', ' 2> '),
    ].map(command => ({ commands: [command] })));
  }
  for (const action of falseActions) {
    await expect(c.assert({ ...record, ...action }, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-not-run' : 'reflect-transcript-not-read');
  }
});

test('Codex accepts the resolver however the shell wraps or prefixes it', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f);
  const record = await simulatedRecord(f, true), exact = resolverCommand(f);
  for (const command of [exact, `/bin/bash -lc ${quote(exact)}`, `/bin/sh -c ${quote(exact)}`, `cd ${quote(f.dir)} && env ${exact.replace(` > ${quote(join(f.dir, 'result.json'))}`, ' > result.json')}`,
    `export CODEX_HOME=${quote(home(f))} && bun run "${helper(f)}" "${chat}" 1>"${join(f.dir, 'result.json')}"`]) {
    expect(shellCommands(command)).toBeDefined();
    await c.assert({ ...record, commands: [command] }, f);
  }
});

test('Claude requires a completed successful bounded parent Read containing the actual records', async () => {
  const f = await fixture('claude'), c = recipe('skill-invocation:reflect', 'claude')[0]!;
  await c.prepare!(f); const record = await simulatedRecord(f, true), read = record.tools[0]!;
  for (const changed of [
    { failed: true }, { result: undefined }, { result: 'I read it and it passed.' }, { result: '' }, { parent: 'child-agent' },
    { input: { ...read.input, limit: undefined } }, { input: { ...read.input, limit: 501 } }, { input: { ...read.input, offset: 2 } },
  ]) {
    await expect(c.assert({ ...record, tools: [{ ...read, ...changed }] }, f)).rejects.toThrow('reflect-transcript-not-read');
  }
  const events = (completed: boolean, failed: boolean) => [
    { type: 'user', isReplay: true, message: { content: '<command-name>/pstack:reflect</command-name>' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read', name: 'Read', input: read.input }] } },
    ...completed ? [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read', is_error: failed, content: read.result }] } }] : [],
    { type: 'result', subtype: 'success', result: 'I read it and it passed.' },
  ].map(event => JSON.stringify(event)).join('\n');
  for (const [completed, failed] of [[false, false], [true, true]]) {
    await expect(c.assert(parseSession('claude', events(completed!, failed!), 0, record.started), f)).rejects.toThrow('reflect-transcript-not-read');
  }
  await c.assert(parseSession('claude', events(true, false), 0, record.started), f);
});

test('Codex requires a completed resolver command and rejects failed, pending or claimed execution', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f); const record = await simulatedRecord(f, true), exact = record.commands[0]!;
  const rollout = JSON.stringify({ type: 'response_item', payload: { content: [{ text: '<skill>\n<name>pstack:reflect</name>\n<path>/run/.codex/plugins/cache/open-pstack/pstack/test/skills/reflect/SKILL.md</path>' }] } });
  for (const event of [
    { type: 'item.completed', item: { type: 'command_execution', command: exact, exit_code: 1 } },
    { type: 'item.completed', item: { type: 'command_execution', command: exact, exit_code: null } },
    { type: 'item.started', item: { type: 'command_execution', command: exact, exit_code: 0 } },
    { type: 'item.completed', item: { type: 'agent_message', text: `I ran ${exact} successfully.` } },
  ]) {
    await expect(c.assert(parseSession('codex', JSON.stringify(event), 0, record.started, rollout), f)).rejects.toThrow('reflect-resolver-not-run');
  }
  const parsed = parseSession('codex', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: exact, exit_code: 0 } }), 0, record.started, rollout);
  await c.assert(parsed, f);
});
