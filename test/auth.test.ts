import { expect, test } from "bun:test";
import { stripPathSecret } from "../src/gateway/auth.ts";

test("path secret strips prefix or forbids", () => {
  expect(stripPathSecret("/v1/models", undefined)).toEqual({ ok: true, path: "/v1/models" });
  expect(stripPathSecret("/s/v1/models", "s")).toEqual({ ok: true, path: "/v1/models" });
  expect(stripPathSecret("/s", "s")).toEqual({ ok: true, path: "/" });
  expect(stripPathSecret("/bad/v1/models", "s")).toEqual({ ok: false });
});
