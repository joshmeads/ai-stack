import { expect, test, vi } from "vitest";

vi.mock("./api"); // @hit
jest.doMock("./db"); // @hit
vi.stubGlobal("fetch", () => {}); // @hit
const spy = vi.spyOn(console, "log");
spy.mockImplementation(() => {}); // @hit
vi.spyOn(api, "get").mockResolvedValue({}); // @hit
const fn = vi.fn();
const impl = vi.fn(() => 1); // @hit
mockIPC(() => {}); // @hit
vi.useFakeTimers();
test("observes", () => {
  expect(spy).toHaveBeenCalled();
});
