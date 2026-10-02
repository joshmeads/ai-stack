import { expect, test } from 'bun:test';
import { parse } from './cli.ts';
test('CLI strictly validates run inputs and permits read-only child doctor', () => {
  expect(parse(['doctor', '--output', '/fresh/probe']).mode).toBe('doctor');
  expect(parse(['run', '--pr', '123', '--self-test', '--output', '/fresh/run'])).toEqual({ mode: 'run', output: '/fresh/run', pr: 123, selfTest: true });
  for (const args of [[], ['wat'], ['run', '--pr', '0', '--output', '/tmp/a'], ['run', '--pr', '1.5', '--output', '/tmp/a'], ['doctor', '--pr', '1', '--output', '/tmp/a'], ['doctor', '--output', '/tmp/a', '--output', '/tmp/b'], ['run', '--pr', '1'], ['doctor', '--output', '--self-test'], ['doctor', '--output', '/tmp/a', '--publish']]) expect(() => parse(args)).toThrow();
});
