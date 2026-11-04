export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export const sec = (s) => round(s * 1000);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ActionTimeout extends Error {
  constructor(message, stopped = false) {
    super(message);
    this.stopped = stopped;
  }
}

export class RunAborted extends Error {}

export function withTimeout(promise, ms, what, flag) {
  if (!(ms > 0)) return promise;
  let timer;
  const limit = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new ActionTimeout(`${what} did not finish within ${ms}ms (raise ${flag}, 0 waits forever)`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
