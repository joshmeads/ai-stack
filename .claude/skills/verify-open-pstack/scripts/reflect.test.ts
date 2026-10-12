import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { recipe, type Case, type Fixture } from '../features/recipes.ts';
import { command } from './io.ts';
import { parseSession } from './harness.ts';
import type { Harness, SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const chat = '00000000-1111-2222-3333-444444444444';

async function fixture(harness: Harness): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-reflect-recipe-'))); roots.push(dir);
  const workspace = resolve(import.meta.dir, '../../../..'), location = join(dir, 'installed-pstack');
  // A symlinked install gives the launcher an installed path that differs from its realpath.
  await symlink(join(workspace, 'plugins/pstack'), location);
  return { harness, dir, workspace, location, configHome: dir, run: command };
}

const home = (f: Fixture) => join(f.dir, 'transcript-home');
/** The one transcript the Claude case prepared; its file name carries the per-run nonce. */
async function claudeTranscript(f: Fixture): Promise<string> {
  const dir = join(home(f), 'projects/fixture'), names = await readdir(dir);
  expect(names).toHaveLength(1);
  return join(dir, names[0]!);
}
const opener = async (path: string): Promise<string> => JSON.parse((await readFile(path, 'utf8')).split('\n')[1]!).message.content[0].text;
const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');
const launcher = (f: Fixture) => join(f.location, 'skills/poteto-mode/scripts/resolve-codex-transcript');
const lookup = (f: Fixture) => `CODEX_HOME=${home(f)} ${launcher(f)} ${chat}`;
const tool = (name: string, input: Record<string, any>, result: string | undefined, failed = false): SessionRecord['tools'][number] =>
  ({ name, id: 'item_1', input, result, parent: null, failed });

/** Runs the installed launcher as a session would, returning the stdout the harness captures. */
async function launch(f: Fixture): Promise<string> {
  const child = Bun.spawn([launcher(f), chat], { env: { ...process.env, CODEX_HOME: home(f) }, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0); expect(stderr).toBe('');
  return stdout;
}

/** Does what a passing session does: Codex runs the launcher, Claude reads the transcript and writes its report. */
async function simulatedRecord(f: Fixture, available: boolean): Promise<SessionRecord> {
  let tools: SessionRecord['tools'];
  if (f.harness === 'codex') {
    tools = [tool('command', { command: `/bin/zsh -lc '${lookup(f)}'` }, await launch(f))];
  } else {
    const path = await claudeTranscript(f), opening = await opener(path);
    await writeFile(join(f.dir, 'result.json'), JSON.stringify(available ? {
      status: 'resolved', path, opening_user_message: { line: 2, characters: opening.length, sha256: hash(opening) },
    } : { status: 'unresolved', reason: 'opening_message_mismatch', fallback: 'session_digest' }));
    tools = [tool('Bash', { command: `cat -n ${path}` }, await readFile(path, 'utf8'))];
  }
  if (!available) await writeFile(join(f.dir, 'digest.md'), 'The requested opening is missing from this synthetic fixture.');
  return { harness: f.harness, exitCode: 0, started: Date.now() - 1000, skills: ['pstack:reflect'], commands: [], tools };
}

async function prepared(harness: Harness, index = 0): Promise<{ f: Fixture; c: Case; record: SessionRecord }> {
  const f = await fixture(harness), c = recipe('skill-invocation:reflect', harness)[index]!;
  await c.prepare!(f);
  return { f, c, record: await simulatedRecord(f, index === 0) };
}

test.each(['claude', 'codex'] as const)('%s Reflect recipes verify the opening and the digest fallback rather than a generic result', async harness => {
  const cases = recipe('skill-invocation:reflect', harness);
  expect(cases.map(c => c.id)).toEqual(['locate-transcript', 'digest-fallback']);
  for (const index of [0, 1]) {
    const { f, c, record } = await prepared(harness, index), available = index === 0;
    expect((await c.assert(record, f)).assertions).toContain(available ? 'opening-verified' : 'digest-fallback');
    expect(c.prompt(f)).toContain(harness === 'claude' ? '/pstack:reflect' : '$pstack:reflect');
    await expect(c.assert({ ...record, skills: [] }, f)).rejects.toThrow('skill-not-loaded');
    await expect(c.assert({ ...record, tools: [] }, f)).rejects.toThrow(harness === 'codex' ? 'reflect-resolver-not-run' : 'reflect-transcript-not-read');
    if (available) {
      await writeFile(join(f.dir, 'digest.md'), 'An unneeded digest.');
      await expect(c.assert(record, f)).rejects.toThrow('reflect-unneeded-fallback');
    } else {
      for (const [content, reason] of [[' \n\t ', 'reflect-digest-empty'], ['', 'fixture-file-missing'], ['word '.repeat(2001), 'reflect-digest-budget']]) {
        await writeFile(join(f.dir, 'digest.md'), content!);
        await expect(c.assert(record, f)).rejects.toThrow(reason!);
      }
    }
  }
});

test('both Codex cases prepare in one fixture, each from a fresh index', async () => {
  const f = await fixture('codex'), [located, fallback] = recipe('skill-invocation:reflect', 'codex');
  await located!.prepare!(f);
  await fallback!.prepare!(f);
  await fallback!.assert(await simulatedRecord(f, false), f);
});

test.each(['claude', 'codex'] as const)('%s prompts name neither the resolver nor the per-run nonce', async harness => {
  for (const index of [0, 1]) {
    const { f, c } = await prepared(harness, index), prompt = c.prompt(f);
    const nonce = harness === 'codex'
      ? (await readdir(join(home(f), 'sessions/2026/10/11')))[0]!.replace(/^rollout-|\.jsonl$/g, '')
      : (await readdir(join(home(f), 'projects/fixture')))[0]!.replace(/\.jsonl$/, '');
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    for (const leak of [nonce, 'resolve-codex-transcript', 'poteto-mode/scripts', 'state_5.sqlite']) expect(prompt).not.toContain(leak);
  }
});

test('Codex accepts the launcher installed or by realpath only when the chat ID follows it, and rejects the script', async () => {
  const { f, c, record } = await prepared('codex'), output = record.tools[0]!.result!;
  const installed = launcher(f), resolved = await realpath(installed);
  expect(resolved).not.toBe(installed);
  const accept = (commandText: string) => c.assert({ ...record, tools: [tool('command', { command: commandText }, output)] }, f);
  for (const path of [installed, resolved]) {
    for (const commandText of [`CODEX_HOME=${home(f)} ${path} ${chat}`, `cd /tmp && CODEX_HOME="${home(f)}" "${path}" ${chat} # lookup`,
      `/bin/zsh -lc '${path} ${chat} 2>&1'`, `(${path} ${chat})|cat`, `/bin/zsh -lc "CODEX_HOME='${home(f)}' '${path}' ${chat}"`]) await accept(commandText);
    for (const commandText of [`bun ${path}.ts ${chat}`, `/bin/bash -lc 'bun --no-env-file --config=/dev/null "${path}.ts" ${chat}'`,
      `${path}-old ${chat}`, `/opt${path} ${chat}`, `bun ${path}''.ts ${chat}`, `bun ${path}"".ts ${chat}`,
      `bun "${path}"'.ts' ${chat}`, `${path}(.ts|.x) ${chat}`, `bun ${path}\` \`.ts ${chat}`,
      `CODEX_HOME=${home(f)} '${path}'`]) await expect(accept(commandText)).rejects.toThrow('reflect-resolver-not-run');
  }
});

test.each(['claude', 'codex'] as const)('%s fixtures write requested and unrelated openers of equal length but different content and hashes', async harness => {
  const written = async (index: number) => {
    const { f } = await prepared(harness, index);
    if (harness === 'claude') return opener(await claudeTranscript(f));
    const dir = join(home(f), 'sessions/2026/10/11'), [name] = await readdir(dir);
    return JSON.parse((await readFile(join(dir, name!), 'utf8')).split('\n')[2]!).payload.content[0].text as string;
  };
  const [requested, unrelated] = [await written(0), await written(1)];
  expect(requested).toBe('Reflect on the corrections in this disposable session.');
  expect(unrelated.length).toBe(requested.length);
  expect(unrelated).not.toBe(requested);
  expect(hash(unrelated)).not.toBe(hash(requested));
});

test('Codex rejects output from another fixture, another run, or a command that does not name the resolver', async () => {
  const { f, c, record } = await prepared('codex'), [good] = record.tools;
  const other = await prepared('codex');
  const stale = JSON.parse(good!.result!);
  await c.prepare!(f);
  for (const changed of [
    good!, tool('command', good!.input, other.record.tools[0]!.result),
    tool('command', { command: `echo '${JSON.stringify(stale)}'` }, good!.result), tool('command', { command: `cat ${f.dir}/report.json` }, good!.result),
    tool('command', good!.input, good!.result, true), tool('command', good!.input, 'not json'),
  ]) {
    await expect(c.assert({ ...record, tools: [changed] }, f)).rejects.toThrow('reflect-resolver-not-run');
  }
  // The rerun's own output still passes, so only the stale nonce path failed above.
  const fresh = await launch(f);
  await c.assert({ ...record, tools: [tool('command', good!.input, fresh)] }, f);
  await c.assert({ ...record, tools: [tool('command', good!.input, JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fresh)).reverse())))] }, f);
});

test('Claude accepts a parent read naming this run\'s transcript whose output shows the file\'s opener or its hash', async () => {
  for (const index of [0, 1]) {
    const { f, c, record } = await prepared('claude', index), [read] = record.tools, path = await claudeTranscript(f);
    const relative = path.slice(f.dir.length + 1), text = await opener(path), requested = 'Reflect on the corrections in this disposable session.';
    const [metadata, user] = (await readFile(path, 'utf8')).trimEnd().split('\n');
    for (const accepted of [
      tool('Read', { file_path: path }, `1\t${metadata}\n2\t${user}`),
      tool('Bash', { command: `python3 -I - ${path} <<'EOF'\nprint(sha)\nEOF` }, `line 2 chars ${text.length} sha ${hash(text)}`),
      tool('Bash', { command: `cd ${f.dir} && shasum -a 256 ${relative}` }, `${hash(text)}  ${relative}`),
    ]) await c.assert({ ...record, tools: [accepted] }, f);
    for (const rejected of [
      tool('Read', { file_path: path, limit: 1 }, `1\t${metadata}`),
      tool('Bash', { command: `wc -c ${path}` }, `227 ${path}`),
      tool('Bash', { command: `ls -la ${join(home(f), 'projects/fixture')}` }, `-rw-r--r-- 1 fixture staff 227 ${relative.split('/').pop()}\n${hash(text)}`),
      tool('Bash', { command: `cat ${join(f.dir, 'result.json')}` }, await readFile(join(f.dir, 'result.json'), 'utf8') + hash(text)),
      tool('Bash', { command: `printf %s '${text}' | shasum -a 256` }, hash(text)),
      { ...read!, failed: true }, { ...read!, result: undefined }, { ...read!, parent: 'child-agent' },
    ]) {
      await expect(c.assert({ ...record, tools: [rejected] }, f)).rejects.toThrow('reflect-transcript-not-read');
    }
    // The fallback's file holds the unrelated opener, so output showing only the requested opener's hash proves no read.
    if (index === 1) {
      await expect(c.assert({ ...record, tools: [tool('Bash', { command: `shasum -a 256 ${path}` }, `want ${hash(requested)}`)] }, f)).rejects.toThrow('reflect-transcript-not-read');
    }
    await expect(c.assert({ ...record, tools: [] }, f)).rejects.toThrow('reflect-transcript-not-read');
    await c.prepare!(f);
    await expect(c.assert(record, f)).rejects.toThrow('reflect-transcript-not-read');
  }
});

// Tool calls recorded from two honest live-gate sessions on 2026-10-12 (PR #165) that printed only the opener's line,
// length and SHA-256. `TRANSCRIPT` and `DIR` stand for the fixture paths those sessions saw.
const RECORDED_HASH_READS = [{
  command: `cd /tmp && python3 -I -c '
import json,hashlib,sys
p=sys.argv[1]; want="Reflect on the corrections in this disposable session."
def h(s): return hashlib.sha256(s.encode()).hexdigest()
for i,l in enumerate(open(p,encoding="utf-8"),1):
    r=json.loads(l)
    if r.get("type")=="user":
        c=r["message"].get("content")
        if isinstance(c,list): c="".join(b.get("text","") for b in c if isinstance(b,dict) and b.get("type")=="text")
        print("line",i,"chars",len(c),"sha",h(c),"match",c==want)
        break
print("want chars",len(want),"sha",h(want))
' TRANSCRIPT`,
  output: `line 2 chars 54 sha 806b07f50229d4919efa1815a781836f481054609e06f8e8ce03de6c3704d33e match True
want chars 54 sha 806b07f50229d4919efa1815a781836f481054609e06f8e8ce03de6c3704d33e
Shell cwd was reset to DIR`,
}, {
  command: `python3 -I - RELATIVE <<'EOF'
import json,sys,hashlib
exp="Reflect on the corrections in this disposable session."
p=sys.argv[1]
with open(p,'rb') as f:
  for i,raw in enumerate(f,1):
    if i>500 or len(raw)>256*1024: break
    try: r=json.loads(raw)
    except Exception as e: print(i,"badjson"); continue
    msg=r.get("message") or {}
    print(i, "type=",r.get("type"), "keys=",sorted(r.keys()), "role=",msg.get("role") if isinstance(msg,dict) else None)
    if r.get("type")=="user" and isinstance(msg,dict) and msg.get("role")=="user":
      c=msg.get("content")
      if isinstance(c,list): c="".join(x.get("text","") for x in c if isinstance(x,dict) and x.get("type")=="text")
      print(" chars",len(c),"sha",hashlib.sha256(c.encode()).hexdigest(),"match",c==exp)
      print(" expected chars",len(exp),"sha",hashlib.sha256(exp.encode()).hexdigest())
      break
EOF`,
  output: `1 type= system keys= ['subtype', 'type'] role= None
2 type= user keys= ['message', 'type', 'uuid'] role= user
 chars 54 sha 806b07f50229d4919efa1815a781836f481054609e06f8e8ce03de6c3704d33e match True
 expected chars 54 sha 806b07f50229d4919efa1815a781836f481054609e06f8e8ce03de6c3704d33e`,
}];

test.each([['an absolute', 0], ['a relative', 1]] as const)('Claude accepts the recorded hash-only read with %s path, replayed as native events', async (_form, which) => {
  const { f, c, record } = await prepared('claude'), path = await claudeTranscript(f), recorded = RECORDED_HASH_READS[which]!;
  const fill = (text: string) => text.replaceAll('TRANSCRIPT', path).replaceAll('RELATIVE', path.slice(f.dir.length + 1)).replaceAll('DIR', f.dir);
  const events = (input: string, parent: string | null = null) => [
    { type: 'user', isReplay: true, message: { content: '<command-name>/pstack:reflect</command-name>' } },
    { type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: input } }] } },
    { type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: 'bash', is_error: false, content: fill(recorded.output) }] } },
    { type: 'result', subtype: 'success', result: 'Resolved.' },
  ].map(event => JSON.stringify(event)).join('\n');
  await c.assert(parseSession('claude', events(fill(recorded.command)), 0, record.started), f);
  // The same read of the old fixture name, or from a child agent, does not count.
  await expect(c.assert(parseSession('claude', events(fill(recorded.command).replaceAll(basename(path), 'known.jsonl')), 0, record.started), f))
    .rejects.toThrow('reflect-transcript-not-read');
  await expect(c.assert(parseSession('claude', events(fill(recorded.command), 'agent'), 0, record.started), f)).rejects.toThrow('reflect-transcript-not-read');
});

test('Claude rejects a correct result.json when no tool read the transcript', async () => {
  for (const index of [0, 1]) {
    const { f, c, record } = await prepared('claude', index);
    await c.assert(record, f);
    const reportOnly = [
      { type: 'user', isReplay: true, message: { content: '<command-name>/pstack:reflect</command-name>' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'write', name: 'Write', input: { file_path: join(f.dir, 'result.json'), content: await readFile(join(f.dir, 'result.json'), 'utf8') } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'write', is_error: false, content: 'File created successfully.' }] } },
      { type: 'result', subtype: 'success', result: 'Resolved.' },
    ].map(event => JSON.stringify(event)).join('\n');
    await expect(c.assert(parseSession('claude', reportOnly, 0, record.started), f)).rejects.toThrow('reflect-transcript-not-read');
  }
});

test('Claude accepts a completed Bash read in the native stream and rejects a failed or pending one', async () => {
  const { f, c, record } = await prepared('claude'), path = await claudeTranscript(f), content = await readFile(path, 'utf8');
  const events = (completed: boolean, failed: boolean) => [
    { type: 'user', isReplay: true, message: { content: '<command-name>/pstack:reflect</command-name>' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: `cat -n ${path}` } }] } },
    ...completed ? [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bash', is_error: failed, content }] } }] : [],
    { type: 'result', subtype: 'success', result: 'I read it and it passed.' },
  ].map(event => JSON.stringify(event)).join('\n');
  for (const [completed, failed] of [[false, false], [true, true]]) {
    await expect(c.assert(parseSession('claude', events(completed!, failed!), 0, record.started), f)).rejects.toThrow('reflect-transcript-not-read');
  }
  await c.assert(parseSession('claude', events(true, false), 0, record.started), f);
});

test('Codex requires a completed resolver command in the native stream and rejects failed, pending or claimed execution', async () => {
  const { f, c, record } = await prepared('codex'), { command: exact } = record.tools[0]!.input, output = record.tools[0]!.result!;
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
