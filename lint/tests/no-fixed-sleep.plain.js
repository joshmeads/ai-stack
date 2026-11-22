import { test } from "vitest";

test("helpers that are not timers/promises", async () => {
  await sleep(10);
  await delay(5);
  await new Promise((resolve) => setTimeout(resolve, 1)); // @hit
});
