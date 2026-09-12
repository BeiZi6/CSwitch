import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "dist", "renderer");
mkdirSync(dest, { recursive: true });
cpSync(join(root, "src", "renderer", "index.html"), join(dest, "index.html"));
cpSync(join(root, "src", "renderer", "styles.css"), join(dest, "styles.css"));
cpSync(join(root, "assets", "icon.png"), join(dest, "icon.png"));
