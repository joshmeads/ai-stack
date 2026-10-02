import { describe, expect, test } from 'bun:test';
import data from '../features/registry.json';
import { requiredFeatures, validateRegistry } from './core.ts';
import { Publisher } from './github.ts';
import { evidence, verify } from './verify.ts';
import { HARNESSES, REPO, type Driver, type GitHub, type Pull, type Receipt } from './types.ts';
const SHA = 'a'.repeat(40), BASE = 'b'.repeat(40), NEXT = 'c'.repeat(40), HASH = 'd'.repeat(64);
const URL = `https://github.com/${REPO}/pull/123#issuecomment-1`;
function fixture(runtime = false, selfTest = false) {
  const calls: string[] = [], saved: Receipt[] = [];
  const pull: Pull = { number: 123, head: { sha: SHA }, base: { sha: BASE }, draft: true, state: 'open', headRepo: REPO };
  let hook: (call: string) => void = () => {};
  const mark = (call: string) => { calls.push(call); hook(call); };
  const github: GitHub = {
    async pull() { mark('pull'); return structuredClone(pull); },
    async files() { mark('files'); return [{ filename: runtime ? 'plugins/pstack/skills/architect/SKILL.md' : 'README.md' }]; },
    async comment(_pr, body) { mark('comment'); expect(body).toContain(SHA); return URL; },
    async status(sha, state, target) { mark(`status:${state}:${sha}`); expect(target).toBe(URL); },
    async ready() { mark('ready'); pull.draft = false; }, async draft() { mark('draft'); pull.draft = true; },
  };
  const driver: Driver = {
    async prepare(r) { mark('prepare'); return HARNESSES.map(harness => ({ harness, sha: r.sha, cliVersion: 'test', pluginVersion: '1.5.0', treeHash: HASH, location: `/isolated/${harness}/plugin`, home: `/isolated/${harness}` })); },
    async exercise(r) { mark('exercise'); return HARNESSES.flatMap(harness => requiredFeatures(r).map(feature => ({ harness, feature, surface: 'native surface', action: 'invoke', observed: 'fixture changed', reviewer: 'operator' as const, transcript: 'retained.log', transcriptHash: HASH, artifacts: [{ path: 'fixture.json', sha256: HASH }] }))); },
  };
  const options = { pr: 123, root: '/tmp/evidence', selfTest, registry: validateRegistry(data), github, driver, persist: async (r: Receipt) => { saved.push(structuredClone(r)); } };
  return { options, calls, saved, pull, hook: (fn: typeof hook) => { hook = fn; } };
}

describe('exact-head publication state machine', () => {
  test('docs-only publishes no-runtime evidence without either harness, then readies', async () => {
    const f = fixture(), receipt = await verify(f.options);
    expect(receipt.status).toBe('success'); expect(receipt.sha).toBe(SHA);
    expect(evidence(receipt)).toContain('no runtime change');
    expect(f.calls).not.toContain('prepare'); expect(f.calls).not.toContain('exercise');
    expect(f.calls.indexOf('comment')).toBeLessThan(f.calls.indexOf(`status:success:${SHA}`));
    expect(f.calls.indexOf(`status:success:${SHA}`)).toBeLessThan(f.calls.indexOf('ready'));
  });
  test('all changed surfaces and explicit project self-test run in both harnesses', async () => {
    const f = fixture(true, true), r = await verify(f.options);
    expect(r.observations).toHaveLength(4); expect(f.calls).toContain('prepare'); expect(f.calls).toContain('exercise');
    expect(evidence(r)).toContain('operator reviewed'); expect(evidence(r)).toContain(HASH);
  });
  test('already-ready PR is never toggled ready', async () => {
    const f = fixture(); f.pull.draft = false; await verify(f.options); expect(f.calls).not.toContain('ready');
  });
  test('closed or foreign PR never enters publication', async () => {
    for (const field of ['state', 'headRepo'] as const) {
      const f = fixture(); f.pull[field] = 'other';
      await expect(verify(f.options)).rejects.toThrow('open same-repository'); expect(f.calls).toEqual(['pull']);
    }
  });
  test('head movement during classify, prepare, exercise, or comment aborts without success or readiness', async () => {
    for (const boundary of ['files', 'prepare', 'exercise', 'comment']) {
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
  test('ambiguous success-write and ready-write failures are compensated', async () => {
    for (const boundary of [`status:success:${SHA}`, 'ready']) {
      const f = fixture(); f.hook(call => { if (call === boundary) throw new Error('response lost'); });
      await expect(verify(f.options)).rejects.toThrow('response lost');
      expect(f.calls).toContain(`status:failure:${SHA}`);
      if (boundary === 'ready') expect(f.calls).toContain('draft');
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
  test('pagination must match complete PR file count', async () => {
    for (const result of [[], [[{ filename: 'README.md' }, { filename: 'README.md' }]], {}]) {
      const publisher = new Publisher(async args => JSON.stringify(args.some(a => a.includes('/files?')) ? result : { changed_files: 2 }));
      await expect(publisher.files(123)).rejects.toThrow();
    }
    const publisher = new Publisher(async args => JSON.stringify(args.some(a => a.includes('/files?')) ? [[{ filename: 'docs/new.md', previous_filename: 'plugins/pstack/skills/architect/SKILL.md' }], [{ filename: 'README.md' }]] : { changed_files: 2 }));
    expect(await publisher.files(123)).toHaveLength(2);
    await expect(new Publisher(async () => JSON.stringify({ changed_files: 3001 })).files(123)).rejects.toThrow('completely enumerated');
  });
  test('status targets the supplied exact SHA and evidence URL, never a branch', async () => {
    const calls: string[][] = []; const publisher = new Publisher(async args => { calls.push(args); return '{}'; });
    await publisher.status(SHA, 'success', URL, 'passed');
    expect(calls[0]).toContain(`repos/${REPO}/statuses/${SHA}`); expect(calls[0]).toContain('context=live-gate'); expect(calls[0]).toContain(`target_url=${URL}`);
    await expect(publisher.status('main', 'success', URL, 'passed')).rejects.toThrow('Invalid status SHA');
  });
});
