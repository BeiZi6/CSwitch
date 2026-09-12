import { expect, test } from "bun:test";
import { DEFAULT_GATEWAY_PORT } from "../src/gateway/types.ts";
import { emptyState } from "../src/store/profiles.ts";

test("default gateway port is shared, positive, and not CSSwitch or Science reserved", () => {
  expect(typeof DEFAULT_GATEWAY_PORT).toBe("number");
  expect(Number.isInteger(DEFAULT_GATEWAY_PORT)).toBe(true);
  expect(DEFAULT_GATEWAY_PORT).toBeGreaterThan(0);
  expect(DEFAULT_GATEWAY_PORT).not.toBe(18991);
  expect(DEFAULT_GATEWAY_PORT).not.toBe(8765);
  expect(emptyState().port).toBe(DEFAULT_GATEWAY_PORT);
});
