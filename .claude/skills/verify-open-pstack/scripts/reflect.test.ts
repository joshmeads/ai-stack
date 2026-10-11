import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recipe, type Fixture } from '../features/recipes.ts';
import { command, sha256 } from './io.ts';
import { parseSession } from './harness.ts';
import type { Harness, SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const opening = 'Reflect on the corrections in this disposable session.';
const chat = '00000000-1111-2222-3333-444444444444';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(harness: Harness): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-reflect-recipe-'))); roots.push(dir);
  const workspace = resolve(import.meta.dir, '../../../..');
  return { harness, dir, workspace, location: join(workspace, 'plugins/pstack'), configHome: dir, run: command };
}

const home = (f: Fixture) => join(f.dir, 'transcript-home');
const transcript = (f: Fixture) => join(home(f), f.harness === 'codex' ? 'sessions/2026/10/11/known.jsonl' : 'projects/fixture/known.jsonl');
const helper = (f: Fixture) => join(f.location, 'skills/poteto-mode/scripts/resolve-codex-transcript.ts');
const plain = (f: Fixture) => `CODEX_HOME=${home(f)} bun ${helper(f)} ${chat}`;

/** Runs the real resolver as the harness would and records its captured stdout. */
async function resolverOutput(f: Fixture): Promise<string> {
  const child = Bun.spawn(['bun', helper(f), chat], { env: { ...process.env, CODEX_HOME: home(f) }, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0); expect(stderr).toBe('');
  return stdout;
}

const commandTool = (command: string, result: string, failed = false): SessionRecord['tools'][number] =>
  ({ name: 'command', id: 'item_1', input: { command }, result, parent: null, failed });

/** Does what a passing session does: Codex runs the real resolver, Claude reads the fixture and writes its report. */
async function simulatedRecord(f: Fixture, available: boolean): Promise<SessionRecord> {
  let tools: SessionRecord['tools'];
  if (f.harness === 'codex') {
    const wrapped = `/bin/zsh -lc ${quote(plain(f))}`;
    tools = [commandTool(wrapped, await resolverOutput(f))];
  } else {
    await writeFile(join(f.dir, 'result.json'), JSON.stringify(available ? {
      status: 'resolved', path: transcript(f), opening_user_message: { line: 2, characters: opening.length, sha256: sha256(opening) },
    } : { status: 'unresolved', reason: 'opening_message_mismatch', fallback: 'session_digest' }));
    tools = [{ name: 'Read', id: 'read', input: { file_path: transcript(f), offset: 1, limit: 500 }, parent: null, failed: false, result: await readFile(transcript(f), 'utf8') }];
  }
  if (!available) await writeFile(join(f.dir, 'digest.md'), 'The requested opening is missing from this synthetic fixture.');
  return { harness: f.harness, exitCode: 0, started: Date.now() - 1000, skills: ['pstack:reflect'], commands: [], tools };
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
    await expect(c.assert({ ...record, tools: [] }, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-not-run' : 'reflect-transcript-not-read');
    if (available) {
      await writeFile(join(f.dir, 'digest.md'), 'An unneeded digest.');
      await expect(c.assert(record, f)).rejects.toThrow('reflect-unneeded-fallback');
    } else {
      for (const blank of [' \n\t ', '']) {
        await writeFile(join(f.dir, 'digest.md'), blank);
        await expect(c.assert(record, f)).rejects.toThrow(blank ? 'reflect-digest-empty' : 'fixture-file-missing');
      }
      await writeFile(join(f.dir, 'digest.md'), 'word '.repeat(2001));
      await expect(c.assert(record, f)).rejects.toThrow('reflect-digest-budget');
    }
  }
});

test('both Codex cases prepare in one fixture, each from a fresh index', async () => {
  const f = await fixture('codex'), [located, fallback] = recipe('skill-invocation:reflect', 'codex');
  await located!.prepare!(f);
  await fallback!.prepare!(f);
  await fallback!.assert(await simulatedRecord(f, false), f);
});

test.each(['claude', 'codex'] as const)('%s prompts leave the lookup to the installed mapping', async harness => {
  for (const c of recipe('skill-invocation:reflect', harness)) {
    const prompt = c.prompt(await fixture(harness));
    for (const leak of ['resolve-codex-transcript', 'poteto-mode/scripts', 'bun ', 'known.jsonl', 'state_5.sqlite', 'stdout']) expect(prompt).not.toContain(leak);
  }
});

test('Codex accepts a plain resolver invocation, wrapped, prefixed or quoted', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f);
  const record = await simulatedRecord(f, true), output = record.tools[0]!.result!;
  for (const command of [
    `bun ${helper(f)} ${chat}`, `/bin/zsh -lc ${quote(`bun ${helper(f)} ${chat}`)}`, plain(f), `/bin/bash -c ${quote(plain(f))}`,
    `CODEX_HOME="${home(f)}" "${helper(f)}" "${chat}"`, `/bin/zsh -lc 'CODEX_HOME="${home(f)}" bun "${helper(f)}" ${chat}'`,
  ]) await c.assert({ ...record, tools: [commandTool(command, output)] }, f);
});

test('Codex rejects anything but a completed plain invocation, including each review reproducer', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f);
  const record = await simulatedRecord(f, true), output = record.tools[0]!.result!, exact = plain(f);
  for (const command of [
    `${exact} # comment`, `# ${exact}`, `${exact} > ${quote(join(f.dir, 'out.json'))}`, `${exact} >/dev/null`, `${exact} && true`, `${exact}; true`,
    `${exact} | cat`, `CODEX_HOME=${quote(home(f))} \\\n  bun ${quote(helper(f))} ${chat}`, `bun ${quote(helper(f))} $CHAT`, `bun "$(echo ${helper(f)})" ${chat}`,
    `echo '{"path":"${helper(f)}"}'`, `cat ${quote(helper(f))}`, `bun ${quote(helper(f))} 00000000-1111-2222-3333-555555555555`,
    `bun ${quote(join(f.dir, 'resolve-codex-transcript.ts'))} ${chat}`, `CODEX_HOME=/elsewhere bun ${quote(helper(f))} ${chat}`, `bun ${quote(helper(f))} ${chat} extra`,
    `/bin/zsh -lc ${quote(`/bin/zsh -lc ${quote(exact)}`)}`,
  ]) {
    await expect(c.assert({ ...record, tools: [commandTool(command, output)] }, f)).rejects.toThrow('reflect-resolver-not-run');
  }
  await expect(c.assert({ ...record, tools: [commandTool(exact, output, true)] }, f)).rejects.toThrow('reflect-resolver-not-run');
  await expect(c.assert({ ...record, tools: [{ ...commandTool(exact, output), name: 'Read' }] }, f)).rejects.toThrow('reflect-resolver-not-run');
  // Evidence is the harness-captured output, so a report file the model writes or overwrites cannot change the verdict.
  await writeFile(join(f.dir, 'result.json'), '{"status":"resolved"}');
  await c.assert(record, f);
});

test('Codex reads the resolver output exactly, without extra fields or message text', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f);
  const record = await simulatedRecord(f, true), output = record.tools[0]!.result!, exact = record.tools[0]!.input.command;
  const result = JSON.parse(output);
  for (const changed of [
    { ...result, extra: true }, { ...result, chat_id: '00000000-1111-2222-3333-555555555555' },
    { ...result, opening_user_message: { ...result.opening_user_message, line: 1 } },
  ]) {
    await expect(c.assert({ ...record, tools: [commandTool(exact, JSON.stringify(changed))] }, f)).rejects.toThrow('reflect-resolver-output-mismatch');
  }
  await expect(c.assert({ ...record, tools: [commandTool(exact, 'not json')] }, f)).rejects.toThrow('reflect-resolver-output-mismatch');
  for (const leaked of [output + opening, `${opening}\n${output}`, output + 'Fixture only.']) {
    await expect(c.assert({ ...record, tools: [commandTool(exact, leaked)] }, f)).rejects.toThrow('reflect-message-text-exposed');
  }
});

test('Claude echoed paths and source reads cannot prove the bounded Read', async () => {
  const f = await fixture('claude'), c = recipe('skill-invocation:reflect', 'claude')[0]!;
  await c.prepare!(f);
  const record = await simulatedRecord(f, true);
  for (const tools of [[], [commandTool(`echo ${transcript(f)}`, transcript(f))],
    [{ name: 'Read', id: 'source-only', input: { file_path: helper(f), offset: 1, limit: 500 }, parent: null, failed: false, result: 'The helper source.' }]]) {
    await expect(c.assert({ ...record, tools }, f)).rejects.toThrow('reflect-transcript-not-read');
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

test('Codex requires a completed resolver command in the native stream and rejects failed, pending or claimed execution', async () => {
  const f = await fixture('codex'), c = recipe('skill-invocation:reflect', 'codex')[0]!;
  await c.prepare!(f); const record = await simulatedRecord(f, true), { command: exact } = record.tools[0]!.input, output = record.tools[0]!.result!;
  const rollout = JSON.stringify({ type: 'response_item', payload: { content: [{ text: '<skill>\n<name>pstack:reflect</name>\n<path>/run/.codex/plugins/cache/open-pstack/pstack/test/skills/reflect/SKILL.md</path>' }] } });
  const item = (exit_code: number | null) => ({ id: 'item_1', type: 'command_execution', command: exact, aggregated_output: output, exit_code });
  for (const event of [
    { type: 'item.completed', item: item(1) }, { type: 'item.completed', item: item(null) }, { type: 'item.started', item: item(0) },
    { type: 'item.completed', item: { type: 'agent_message', text: `I ran ${exact} and it printed ${output}` } },
  ]) {
    await expect(c.assert(parseSession('codex', JSON.stringify(event), 0, record.started, rollout), f)).rejects.toThrow('reflect-resolver-not-run');
  }
  await c.assert(parseSession('codex', JSON.stringify({ type: 'item.completed', item: item(0) }), 0, record.started, rollout), f);
});
