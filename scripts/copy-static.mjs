import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererDest = join(root, "dist", "renderer");
mkdirSync(rendererDest, { recursive: true });
cpSync(join(root, "src", "renderer", "index.html"), join(rendererDest, "index.html"));
cpSync(join(root, "src", "renderer", "styles.css"), join(rendererDest, "styles.css"));
cpSync(join(root, "assets", "icon.png"), join(rendererDest, "icon.png"));
const mainDest = join(root, "dist", "main");
mkdirSync(mainDest, { recursive: true });
cpSync(join(root, "src", "main", "preload.cjs"), join(mainDest, "preload.cjs"));
