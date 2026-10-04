import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import type { Command } from './io.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-doctor-'))); roots.push(root);
  return root;
}
for (const candidate of [false, true]) {
  test(`doctor is capabilities-only (candidate=${candidate})`, async () => {
    const root = await fixture(), calls: string[][] = [];
    const run: Command = async args => {
      calls.push(args);
      if (args.includes('--version')) return 'version';
      if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    };
    await doctor(root, run, 'darwin', candidate);
    expect(calls.every(args => args.includes('--version') || args.includes('--help'))).toBe(true);
    expect(calls.some(args => args.includes('auth') || args.includes('login') || args.includes('status'))).toBe(false);
    expect(calls.some(args => args[0] === 'gh')).toBe(!candidate);
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
  });
}
test('doctor records blocked capability checks', async () => {
  const root = await fixture();
  await expect(doctor(root, async () => { throw new Error('Missing binary'); }, 'darwin')).rejects.toThrow('Missing binary');
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
});
test('doctor refuses non-Mac live verification before commands', async () => {
  const root = await fixture(), calls: string[][] = [];
  await expect(doctor(root, async args => { calls.push(args); return ''; }, 'linux')).rejects.toThrow('operator Mac');
  expect(calls).toEqual([]);
});
