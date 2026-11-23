import { expect, test, vi } from "vitest";

test("polls", async () => {
  const fn = vi.fn();
  const requests = [];
  await expect.poll(() => fn.mock.calls.length).toBe(1); // @hit
  await expect.poll(() => requests.length).toBe(2); // @hit
  await expect.poll(() => requests).toHaveLength(2); // @hit
  await expect.poll(() => ref.current.length).toBe(1);
  await expect.poll(() => fetchStatus()).toBe("ok");
  await vi.waitFor(() => expect(fn).toHaveBeenCalled()); // @hit
  await vi.waitFor(() => { expect(requests).toHaveLength(1); }); // @hit
  await vi.waitFor(() => expect(fn.mock.calls.length).toBe(1)); // @hit
  await vi.waitFor(() => expect(screen.getByText("x")).toBeTruthy());
  await vi.waitFor(() => fn.mock.calls.length); // @hit
});
