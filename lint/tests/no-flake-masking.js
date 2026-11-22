import { describe, it, test, vi } from "vitest";

test("slow", async () => {}, 30000); // @hit
test("opt", { timeout: 10000, retry: 3 }, async () => {}); // @hit
it.each([1])("each", async () => {}, 5000); // @hit
test.each([1], 5000);
vi.setConfig({ testTimeout: 20000, retry: 1 }); // @hit
describe("suite", { retry: 2 }, () => {}); // @hit
export const server = { test: { testTimeout: 1, hookTimeout: 2, retry: 1 } };
setTimeout(() => {}, 10);
test("fine", async () => {});
