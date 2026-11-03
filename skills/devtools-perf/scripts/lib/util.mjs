export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export const sec = (s) => round(s * 1000);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An action ran past --action-timeout. stopped says whether cdt knows the
// work ended (a killed `run` process group); otherwise it may still be
// running on a target and would land in later steps' numbers.
export class ActionTimeout extends Error {
  constructor(message, stopped = false) {
    super(message);
    this.stopped = stopped;
  }
}

// The run cannot go on measuring honestly (an action that may still be
// running). Ends the run like a lost target.
export class RunAborted extends Error {}

// Rejects with ActionTimeout after ms, naming the limit and its flag.
// ms <= 0 waits forever.
export function withTimeout(promise, ms, what, flag) {
  if (!(ms > 0)) return promise;
  let timer;
  const limit = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new ActionTimeout(`${what} did not finish within ${ms}ms (raise ${flag}, 0 waits forever)`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
