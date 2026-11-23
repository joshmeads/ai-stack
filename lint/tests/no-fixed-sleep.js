import { setTimeout as sleep } from "node:timers/promises";
import { describe, it, test } from "vitest";

test("sleeps", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100)); // @hit
  await new Promise((r) => globalThis.setTimeout(() => r(), 50)); // @hit
  await new Promise((r) => setTimeout(() => done(), 50));
  await sleep(10); // @hit
  await Bun.sleep(5); // @hit
  await scheduler.wait(5); // @hit
  await fetchData();
});

function helper() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

async function notATest() {
  await sleep(10);
}

it("wrapped", async () => {
  await act(async () => {
    await sleep(1); // @hit
  });
  await other(async () => {
    await sleep(1);
  });
});

describe("suite", () => {
  beforeEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5)); // @hit
  });
});
