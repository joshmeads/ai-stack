import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import data from '../features/registry.json';
import { requiredFeatures, validateRegistry } from './core.ts';
import { parseChangedFiles, Publisher } from './github.ts';
import { command, sha256 } from './io.ts';
import { evidence, liveEvidenceBody, MAC_TESTS, validateMacTests, verify } from './verify.ts';
import { HARNESSES, REPO, type Driver, type GitHub, type Pull, type Receipt } from './types.ts';
const SHA = 'a'.repeat(40), BASE = 'b'.repeat(40), NEXT = 'c'.repeat(40), HASH = 'd'.repeat(64);
const URL = `https://github.com/${REPO}/pull/123#issuecomment-1`;
// Explicit fake-driver proof exercises the gate; it makes no OS-enforcement claim.
const testMacLog = (sha: string) => `Pinned SHA: ${sha}\n${MAC_TESTS.map(name => `(pass) ${name} [1ms]`).join('\n')}\n 2 pass\n 0 fail\nPSTACK_MAC_TEST_EXIT=0\n`;
const roots: string[] = [];
function temporary(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-publish-test-'))); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(runtime = false, selfTest = false) {
  const root = temporary();
  writeFileSync(join(root, 'retained.log'), 'reviewed transcript'); writeFileSync(join(root, 'fixture.json'), 'reviewed artifact');
  const calls: string[] = [], saved: Receipt[] = [];
  const pull: Pull = { number: 123, head: { sha: SHA }, base: { sha: BASE }, draft: true, state: 'open', headRepo: REPO, body: '- [ ] The exact candidate is installed in every affected harness.\n- [ ] The changed behavior passes from each real user surface.\n- [ ] The installed version, action, and observed result appear below.\n\nLive evidence:\n\n_pending_\n\n## Operator notes\nRetain these notes.' };
  let hook: (call: string) => void = () => {};
  const mark = (call: string) => { calls.push(call); hook(call); };
  const github: GitHub = {
    async pull() { mark('pull'); return structuredClone(pull); },
    async files(base, head) { expect(base).toBe(BASE); expect(head).toBe(SHA); mark('files'); return [{ filename: runtime ? 'plugins/pstack/skills/architect/SKILL.md' : 'README.md' }]; },
    async body(_pr, body) { mark('body'); pull.body = body; },
    async comment(_pr, body) { mark('comment'); expect(body).toContain(SHA); return URL; },
    async status(sha, state, target) { mark(`status:${state}:${sha}`); expect(target).toBe(URL); },
    async ready() { mark('ready'); pull.draft = false; }, async draft() { mark('draft'); pull.draft = true; },
  };
  const driver: Driver = {
    async prepare(r) {
      const log = testMacLog(r.sha); writeFileSync(join(root, 'mac-proof.log'), log);
      r.macProof = { sha: r.sha, platform: 'darwin', reviewer: 'operator', tests: { path: 'mac-proof.log', sha256: sha256(log) }, noKeychainDialog: true,
        authenticated: HARNESSES.map(harness => ({ harness, observed: 'unit-driver authenticated request assertion', transcript: 'retained.log', transcriptHash: sha256('reviewed transcript') })) };
      mark('prepare'); return HARNESSES.map(harness => ({ harness, sha: r.sha, cliVersion: 'test', pluginVersion: '1.5.0', treeHash: HASH, location: `/isolated/${harness}/plugin`, home: `/isolated/${harness}` })); },
    async exercise(r) { mark('exercise'); return HARNESSES.flatMap(harness => requiredFeatures(r).map(feature => ({ harness, feature, surface: 'native surface', action: 'invoke', observed: 'fixture changed', reviewer: 'operator' as const, transcript: 'retained.log', transcriptHash: sha256('reviewed transcript'), artifacts: [{ path: 'fixture.json', sha256: sha256('reviewed artifact') }] }))); },
  };
  const options = { pr: 123, root, selfTest, registry: validateRegistry(data), github, driver, persist: async (r: Receipt) => { saved.push(structuredClone(r)); } };
  return { options, calls, saved, pull, hook: (fn: typeof hook) => { hook = fn; } };
}

describe('exact-head publication state machine', () => {
  test('Mac test output requires both exact names, no skips/failures and successful process exit', () => {
    expect(() => validateMacTests(testMacLog(SHA), SHA)).not.toThrow();
    for (const log of [testMacLog(NEXT), testMacLog(SHA).replace(MAC_TESTS[0], 'other test'), testMacLog(SHA).replace('(pass)', '(skip)'),
      testMacLog(SHA).replace('0 fail', '1 fail'), testMacLog(SHA).replace('2 pass', '2 pass\n 1 skip'), testMacLog(SHA).replace('EXIT=0', 'EXIT=1')]) {
      expect(() => validateMacTests(log, SHA)).toThrow('Both pinned Mac');
    }
  });
  test.each(['missing', 'sha', 'keychain', 'authenticated', 'transcript', 'overwrite', 'skip'])('runtime Mac proof %s blocks success and readiness', async defect => {
    const f = fixture(true);
    const exercise = f.options.driver.exercise;
    f.options.driver.exercise = async receipt => {
      const observations = await exercise(receipt);
      const proof = receipt.macProof!;
      if (defect === 'missing') delete receipt.macProof;
      if (defect === 'sha') proof.sha = NEXT;
      if (defect === 'keychain') proof.noKeychainDialog = false;
      if (defect === 'authenticated') proof.authenticated.pop();
      if (defect === 'transcript') proof.authenticated[0]!.transcriptHash = HASH;
      if (defect === 'overwrite') writeFileSync(join(f.options.root, proof.tests.path), 'overwritten');
      if (defect === 'skip') { const log = testMacLog(SHA).replace('(pass)', '(skip)'); writeFileSync(join(f.options.root, proof.tests.path), log); proof.tests.sha256 = sha256(log); }
      return observations;
    };
    await expect(verify(f.options)).rejects.toThrow();
    expect(f.calls).not.toContain(`status:success:${SHA}`); expect(f.calls).not.toContain('ready');
  });
  test('proof mutation during publication withdraws exact-SHA success', async () => {
    const f = fixture(true);
    f.hook(call => { if (call === `status:success:${SHA}`) writeFileSync(join(f.options.root, 'mac-proof.log'), 'changed'); });
    await expect(verify(f.options)).rejects.toThrow('Mac isolation proof changed');
    expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls).not.toContain('ready');
  });
  test('docs-only publishes no-runtime evidence without either harness, then readies', async () => {
    const f = fixture(), receipt = await verify(f.options);
    expect(receipt.status).toBe('success'); expect(receipt.sha).toBe(SHA);
    expect(evidence(receipt)).toContain('no runtime change');
    expect(f.calls).not.toContain('prepare'); expect(f.calls).not.toContain('exercise');
    expect(f.calls.indexOf('comment')).toBeLessThan(f.calls.indexOf('body'));
    expect(f.calls.indexOf('body')).toBeLessThan(f.calls.indexOf(`status:success:${SHA}`));
    expect(f.calls.indexOf(`status:success:${SHA}`)).toBeLessThan(f.calls.indexOf('ready'));
    expect(f.pull.body).toContain(URL); expect(f.pull.body).toContain('Retain these notes.'); expect(f.pull.body).not.toContain('_pending_');
    expect(f.pull.body).toContain('- [x] The installed version, action, and observed result appear below.');
    expect(liveEvidenceBody(f.pull.body, receipt)).toBe(f.pull.body);
  });
  test('unmanaged evidence replacement preserves every following heading and operator note', async () => {
    const receipt = await verify(fixture().options);
    for (const suffix of ['# Release notes\nKeep these.', '## Notes\nKeep these.', '### Operator notes\nKeep these.', 'Ordinary operator text.\n\n## Later\nKeep these.', '---\nTrailing section.']) {
      const before = `Summary is untouched.\n\nLive evidence:\n\n_pending_\n\n${suffix}`;
      const after = liveEvidenceBody(before, receipt);
      expect(after).toStartWith('Summary is untouched.\n\n');
      expect(after).toEndWith(suffix); expect(after).not.toContain('_pending_');
      expect(liveEvidenceBody(after, receipt)).toBe(after);
    }
    const ordinary = 'Live evidence:\nOperator-owned text immediately follows.\n# Closing notes';
    expect(liveEvidenceBody(ordinary, receipt)).toEndWith('Operator-owned text immediately follows.\n# Closing notes');
  });
  test('all changed surfaces and explicit project self-test run in both harnesses', async () => {
    const f = fixture(true, true), r = await verify(f.options);
    expect(r.observations).toHaveLength(4); expect(f.calls).toContain('prepare'); expect(f.calls).toContain('exercise');
    expect(evidence(r)).toContain('operator reviewed'); expect(evidence(r)).toContain(HASH);
  });
  test('already-ready PR is never toggled ready', async () => {
    const f = fixture(); f.pull.draft = false; await verify(f.options); expect(f.calls).not.toContain('ready');
  });
  test('successful verification cleans credentials once before any publication', async () => {
    const f = fixture(true);
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    const receipt = await verify(f.options);
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(1);
    expect(f.calls.indexOf('exercise')).toBeLessThan(f.calls.indexOf('cleanup'));
    expect(f.calls.indexOf('cleanup')).toBeLessThan(f.calls.indexOf('comment'));
    expect(receipt.cleanup).toContain('removed');
    expect(receipt.status).toBe('success');
  });
  test('cleanup failure is retried and recorded before failed publication, preserving a ready PR', async () => {
    const f = fixture(true); f.pull.draft = false;
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); throw new Error('credential removal denied'); };
    const comment = f.options.github.comment;
    f.options.github.comment = async (pr, body) => {
      expect(f.saved.at(-1)?.phase).toBe('failed');
      expect(f.saved.at(-1)?.cleanup).toContain('FAILED');
      expect(f.saved.at(-1)?.failure).toContain('credential removal denied');
      expect(body).toContain('FAILED');
      return comment(pr, body);
    };
    await expect(verify(f.options)).rejects.toThrow('credential removal denied');
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(2);
    expect(f.calls.lastIndexOf('cleanup')).toBeLessThan(f.calls.indexOf('comment'));
    expect(f.calls).not.toContain(`status:success:${SHA}`);
    expect(f.calls).toContain(`status:failure:${SHA}`);
    expect(f.calls).not.toContain('ready'); expect(f.calls).not.toContain('draft');
    expect(f.pull.draft).toBe(false);
    expect(f.saved.at(-1)?.compensation?.join()).toContain('remove copied session credentials: FAILED');
  });
  test('a successful cleanup retry still cannot publish success after the original cleanup failure', async () => {
    const f = fixture(true); let attempts = 0;
    f.options.driver.cleanup = async () => { if (++attempts === 1) throw new Error('temporary cleanup failure'); };
    await expect(verify(f.options)).rejects.toThrow('temporary cleanup failure');
    expect(attempts).toBe(2); expect(f.saved.at(-1)?.cleanup).toContain('removed');
    expect(f.calls).not.toContain(`status:success:${SHA}`); expect(f.calls).not.toContain('ready');
  });
  test('exercise failure cleans credentials before publishing its retained failure', async () => {
    const f = fixture(true); f.pull.draft = false;
    f.options.driver.exercise = async () => { f.calls.push('exercise'); throw new Error('surface failed'); };
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    await expect(verify(f.options)).rejects.toThrow('surface failed');
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(1);
    expect(f.calls.indexOf('exercise')).toBeLessThan(f.calls.indexOf('cleanup'));
    expect(f.calls.indexOf('cleanup')).toBeLessThan(f.calls.indexOf('comment'));
    expect(f.saved.at(-1)?.cleanup).toContain('removed');
    expect(f.saved.at(-1)?.failure).toBe('surface failed');
    expect(f.pull.draft).toBe(false); expect(f.calls).not.toContain('draft');
  });
  test('publication failure does not repeat an already completed cleanup', async () => {
    const f = fixture(true);
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    f.hook(call => { if (call === 'body') throw new Error('publisher failed'); });
    await expect(verify(f.options)).rejects.toThrow('publisher failed');
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(1);
    expect(f.saved.at(-1)?.cleanup).toContain('removed');
  });
  test('body readback must confirm installed evidence before success or readiness', async () => {
    const f = fixture(); f.options.github.body = async () => {};
    await expect(verify(f.options)).rejects.toThrow('body update was not retained');
    expect(f.calls).not.toContain(`status:success:${SHA}`); expect(f.calls).not.toContain('ready');
  });
  test('already-ready PR stays ready when publication fails', async () => {
    const f = fixture(); f.pull.draft = false; f.hook(call => { if (call === 'body') throw new Error('body denied'); });
    await expect(verify(f.options)).rejects.toThrow('body denied'); expect(f.calls).not.toContain('draft'); expect(f.pull.draft).toBe(false);
  });
  test('transcript or artifact overwrite after acceptance prevents publication and readiness', async () => {
    for (const file of ['retained.log', 'fixture.json']) {
      for (const boundary of ['exercise', 'comment', 'body', `status:success:${SHA}`]) {
        const f = fixture(true); f.hook(call => { if (call === boundary) writeFileSync(join(f.options.root, file), 'overwritten'); });
        await expect(verify(f.options)).rejects.toThrow('changed after acceptance'); expect(f.calls).not.toContain('ready');
        if (boundary === `status:success:${SHA}`) expect(f.calls).toContain(`status:failure:${SHA}`);
        else expect(f.calls).not.toContain(`status:success:${SHA}`);
      }
    }
  });
  test('broad evidence remains bounded for success, failure and PR body while retaining full receipt data', async () => {
    const f = fixture(true), receipt = await verify(f.options);
    const observation = receipt.observations[0];
    receipt.observations = Array.from({ length: 400 }, (_, index) => ({ ...observation, feature: `skill:${index}`, action: 'a'.repeat(3000), observed: 'r'.repeat(3000), artifacts: Array.from({ length: 20 }, (_, n) => ({ path: `artifact-${n}`, sha256: HASH })) }));
    const comment = evidence(receipt); expect(comment.length).toBeLessThan(60000); expect(comment).toContain('additional reviewed observations'); expect(comment).toContain('Evidence-set SHA-256');
    expect(liveEvidenceBody(f.pull.body, receipt).length).toBeLessThan(60000);
    receipt.failure = 'reason '.repeat(10000); expect(evidence(receipt).length).toBeLessThan(60000); expect(receipt.observations).toHaveLength(400);
  });
  test('closed or foreign PR never enters publication', async () => {
    for (const field of ['state', 'headRepo'] as const) {
      const f = fixture(); f.pull[field] = 'other';
      await expect(verify(f.options)).rejects.toThrow('open same-repository'); expect(f.calls).toEqual(['pull']);
    }
  });
  test('head movement during classify, prepare, exercise, or comment aborts without success or readiness', async () => {
    for (const boundary of ['files', 'prepare', 'exercise', 'comment', 'body']) {
      const f = fixture(true); f.hook(call => { if (call === boundary) f.pull.head.sha = NEXT; });
      await expect(verify(f.options)).rejects.toThrow('changed');
      expect(f.calls.some(c => c.startsWith('status:success'))).toBe(false); expect(f.calls).not.toContain('ready');
      expect(f.saved.at(-1)?.phase).toBe('head-moved');
    }
  });
  test('head or base movement after status withdraws success only on original SHA', async () => {
    for (const field of ['head', 'base'] as const) {
      const f = fixture(); f.hook(call => { if (call === `status:success:${SHA}`) f.pull[field].sha = NEXT; });
      await expect(verify(f.options)).rejects.toThrow('changed');
      expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls.join()).not.toContain(`status:failure:${NEXT}`);
      expect(f.calls).not.toContain('ready'); expect(f.saved.at(-1)?.status).toBe('failure');
    }
  });
  test('post-ready head race restores draft and revokes the old status', async () => {
    const f = fixture(); f.hook(call => { if (call === 'ready') f.pull.head.sha = NEXT; });
    await expect(verify(f.options)).rejects.toThrow('changed');
    expect(f.calls).toContain('draft'); expect(f.pull.draft).toBe(true); expect(f.saved.at(-1)?.madeReady).toBe(false);
  });
  test('incomplete exercise records failure against pinned head and never readies', async () => {
    const f = fixture(true); f.options.driver.exercise = async () => [];
    await expect(verify(f.options)).rejects.toThrow('Missing/duplicate');
    expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls).not.toContain('ready');
    expect(f.saved.at(-1)?.failure).toContain('Missing/duplicate');
  });
  test('ambiguous publication responses revoke success without claiming a readiness transition', async () => {
    for (const boundary of [`status:success:${SHA}`, 'ready']) {
      const f = fixture(); f.hook(call => { if (call === boundary) throw new Error('response lost'); });
      await expect(verify(f.options)).rejects.toThrow('response lost');
      expect(f.calls).toContain(`status:failure:${SHA}`);
      expect(f.calls).not.toContain('draft');
    }
  });
  test('another actor making the PR ready during the run is not reverted after failure', async () => {
    const f = fixture();
    f.hook(call => { if (call === `status:success:${SHA}`) f.pull.draft = false; });
    f.options.persist = async receipt => {
      if (receipt.status === 'success') throw new Error('receipt denied');
      f.saved.push(structuredClone(receipt));
    };
    await expect(verify(f.options)).rejects.toThrow('receipt denied');
    expect(f.calls).not.toContain('ready'); expect(f.calls).not.toContain('draft'); expect(f.pull.draft).toBe(false);
  });
  test('readiness is checked again after entering the ready phase', async () => {
    const f = fixture(), persist = f.options.persist;
    f.options.persist = async receipt => { await persist(receipt); if (receipt.phase === 'ready') f.pull.draft = false; };
    await verify(f.options);
    expect(f.calls).not.toContain('ready'); expect(f.calls).not.toContain('draft'); expect(f.pull.draft).toBe(false);
  });
  test('a failed or idempotent readiness call never rolls back another actor', async () => {
    const f = fixture();
    f.options.github.ready = async () => { f.calls.push('ready'); f.pull.draft = false; throw new Error('already ready'); };
    await expect(verify(f.options)).rejects.toThrow('already ready');
    expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls).not.toContain('draft'); expect(f.pull.draft).toBe(false);
  });
  test('receipt-write errors cannot prevent compensating an accepted success or ready write', async () => {
    for (const boundary of [`status:success:${SHA}`, 'ready']) {
      const f = fixture(); let deny = false;
      f.hook(call => { if (call === boundary) { f.pull.base.sha = NEXT; deny = true; } });
      f.options.persist = async receipt => {
        if (deny && ['head-moved', 'failed'].includes(receipt.phase)) throw new Error('ENOSPC');
        f.saved.push(structuredClone(receipt));
      };
      await expect(verify(f.options)).rejects.toThrow('changed');
      expect(f.calls).toContain(`status:failure:${SHA}`);
      if (boundary === 'ready') { expect(f.calls).toContain('draft'); expect(f.pull.draft).toBe(true); }
    }
  });
  test('failed compensation is retained, not reported as successful', async () => {
    const f = fixture(); f.hook(call => {
      if (call === `status:success:${SHA}`) f.pull.head.sha = NEXT;
      if (call === `status:failure:${SHA}`) throw new Error('publisher denied');
    });
    await expect(verify(f.options)).rejects.toThrow('changed');
    expect(f.saved.at(-1)?.compensation?.join()).toContain('FAILED');
  });
});

describe('publisher request boundaries', () => {
  test('NUL diff parser preserves rename provenance and rejects malformed results', () => {
    expect(parseChangedFiles('R100\0plugins/pstack/skills/architect/SKILL.md\0docs/new.md\0M\0README.md\0')).toEqual([{ filename: 'docs/new.md', previous_filename: 'plugins/pstack/skills/architect/SKILL.md' }, { filename: 'README.md' }]);
    expect(parseChangedFiles('')).toEqual([]);
    for (const output of ['M\0README.md', 'R100\0old\0', 'M\0same\0M\0same\0', 'X\0file\0']) expect(() => parseChangedFiles(output)).toThrow();
  });
  test('fresh local git diff uses immutable base/head even when the source branch moves', async () => {
    const repository = temporary(), env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' }).trim();
    git('init', '-q'); writeFileSync(join(repository, 'README.md'), 'base'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repository, 'runtime')); writeFileSync(join(repository, 'runtime', 'skill.md'), 'immutable runtime'); git('add', '.'); git('commit', '-qm', 'runtime'); const head = git('rev-parse', 'HEAD');
    git('rm', '-q', 'runtime/skill.md'); git('commit', '-qm', 'later docs-only branch');
    const calls: string[][] = [];
    const publisher = new Publisher(async (args, options) => {
      calls.push(args);
      if (args[0] === 'git' && args[1] === 'fetch') args = args.map(arg => arg === `https://github.com/${REPO}.git` ? repository : arg);
      return command(args, options);
    });
    expect(await publisher.files(base, head)).toEqual([{ filename: 'runtime/skill.md' }]);
    expect(calls.some(args => args[0] === 'gh')).toBe(false);
    expect(calls.at(-1)).toContain(`${base}...${head}`);
    await expect(publisher.files('main', head)).rejects.toThrow('Invalid diff SHA');
  });
  test('real interrupted command execution still permits only trusted rollback writes', () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const script = `
        import { command, interruptCommands } from ${JSON.stringify(new globalThis.URL('./io.ts', import.meta.url).pathname)};
        import { Publisher } from ${JSON.stringify(new globalThis.URL('./github.ts', import.meta.url).pathname)};
        await interruptCommands(${JSON.stringify(signal)});
        const executed = [];
        const publisher = new Publisher(async (args, options) => {
          const output = await command([process.execPath, '-e', 'console.log("{}")'], options);
          executed.push(args);
          return output;
        });
        for (const ordinary of [() => publisher.ready(123), () => publisher.status(${JSON.stringify(SHA)}, 'success', ${JSON.stringify(URL)}, 'passed')]) {
          try { await ordinary(); throw new Error('ordinary write escaped interruption'); }
          catch (error) { if (!String(error).includes('Interrupted by')) throw error; }
        }
        await publisher.status(${JSON.stringify(SHA)}, 'failure', ${JSON.stringify(URL)}, 'withdraw');
        await publisher.draft(123);
        console.log(JSON.stringify(executed));
      `;
      const calls = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim()) as string[][];
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('state=failure'); expect(calls[1]).toContain('--undo');
    }
  });
  test('status targets the supplied exact SHA and evidence URL, never a branch', async () => {
    const calls: string[][] = []; const publisher = new Publisher(async args => { calls.push(args); return '{}'; });
    await publisher.status(SHA, 'success', URL, 'passed');
    expect(calls[0]).toContain(`repos/${REPO}/statuses/${SHA}`); expect(calls[0]).toContain('context=live-gate'); expect(calls[0]).toContain(`target_url=${URL}`);
    await expect(publisher.status('main', 'success', URL, 'passed')).rejects.toThrow('Invalid status SHA');
  });
});
