import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("renderer ships the new console shell without inline scripts", () => {
  const html = readFileSync(join(root, "src/renderer/index.html"), "utf8");
  expect(html).not.toMatch(/<script>/);
  expect(html).toContain('src="./theme.js"');
  expect(html).toContain('src="./app.js"');
  expect(html).toContain('id="powerBtn"');
  expect(html).toContain('id="cs-brand"');
  expect(html).toContain("v0.1.6");
});

test("renderer styles bind the dark brand canvas", () => {
  const css = readFileSync(join(root, "src/renderer/styles.css"), "utf8");
  expect(css).toContain("--bg:           #1f2228");
  expect(css).toContain("--font-display:");
});
