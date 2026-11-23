import { test, vi } from "vitest";

vi.useFakeTimers();

test("fake timers move time", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
});
