import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const FORBIDDEN_PORT = 8765;

export interface ScienceLaunchSpec {
  binary: string;
  home: string;
  dataDir: string;
  gatewayUrl: string;
  sciencePort: number;
  previewPort: number;
  env: Record<string, string>;
  args: string[];
}

export interface RunningScience {
  binary: string;
  dataDir: string;
  home: string;
  port: number;
  url: string;
  child?: ChildProcess;
}

export function candidateScienceBins(
  platform: NodeJS.Platform,
  env: NodeJS.Dict<string>,
): string[] {
  const explicit = env.CSWITCH_SCIENCE_BIN || env.SCIENCE_BIN;
  const names =
    platform === "win32"
      ? ["claude-science.exe", "claude-science"]
      : ["claude-science"];
  const roots: string[] = [];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || "";
    const pf = env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    roots.push(
      join(local, "Programs", "Claude Science"),
      join(local, "Programs", "Claude Science", "resources", "bin"),
      join(local, "Claude Science"),
      join(local, "Claude Science", "resources", "bin"),
      join(local, "Anthropic", "Claude Science"),
      join(local, "Anthropic", "Claude Science", "resources", "bin"),
      join(pf, "Claude Science"),
      join(pf, "Claude Science", "resources", "bin"),
      join(pf86, "Claude Science"),
      join(pf86, "Claude Science", "resources", "bin"),
    );
  } else if (platform === "darwin") {
    roots.push(
      "/Applications/Claude Science.app/Contents/Resources/bin",
      "/Applications/Claude Science.app/Contents/MacOS",
    );
  } else {
    roots.push("/usr/local/bin", "/usr/bin", join(env.HOME || homedir(), ".local", "bin"));
  }
  const out: string[] = [];
  if (explicit) {
    out.push(explicit);
  }
  for (const root of roots) {
    for (const name of names) {
      out.push(join(root, name));
    }
  }
  return out;
}

export function resolveScienceBinary(
  platform: NodeJS.Platform,
  env: NodeJS.Dict<string>,
  exists: (path: string) => boolean = existsSync,
): string {
  const candidates = candidateScienceBins(platform, env);
  const found = candidates.find((path) => path && exists(path));
  if (!found) {
    throw new Error(
      "找不到本机 Claude Science。请安装后重试，或设置 CSWITCH_SCIENCE_BIN 指向 claude-science 可执行文件。",
    );
  }
  return found;
}

export function assertIsolatedDataDir(dataDir: string, realHome: string): void {
  const isolated = resolve(dataDir);
  const real = resolve(join(realHome, ".claude-science"));
  if (isolated.toLowerCase() === real.toLowerCase()) {
    throw new Error("拒绝：CSwitch 不能使用真实 ~/.claude-science 作为 data-dir");
  }
}

export function buildScienceLaunch(input: {
  binary: string;
  sandboxHome: string;
  realHome: string;
  gatewayUrl: string;
  sciencePort: number;
  previewPort: number;
  platform: NodeJS.Platform;
}): ScienceLaunchSpec {
  if (input.sciencePort === FORBIDDEN_PORT || input.previewPort === FORBIDDEN_PORT) {
    throw new Error("拒绝使用保留端口 8765");
  }
  const dataDir = join(input.sandboxHome, ".claude-science");
  assertIsolatedDataDir(dataDir, input.realHome);
  const pathValue =
    input.platform === "win32"
      ? "C:\\Windows\\System32;C:\\Windows"
      : "/usr/bin:/bin:/usr/sbin:/sbin";
  const env: Record<string, string> = {
    HOME: input.sandboxHome,
    USERPROFILE: input.sandboxHome,
    APPDATA: join(input.sandboxHome, "AppData", "Roaming"),
    LOCALAPPDATA: join(input.sandboxHome, "AppData", "Local"),
    PATH: pathValue,
    TMP: join(input.sandboxHome, "tmp"),
    TEMP: join(input.sandboxHome, "tmp"),
    TMPDIR: join(input.sandboxHome, "tmp"),
    LANG: "en_US.UTF-8",
    ANTHROPIC_BASE_URL: input.gatewayUrl,
  };
  return {
    binary: input.binary,
    home: input.sandboxHome,
    dataDir,
    gatewayUrl: input.gatewayUrl,
    sciencePort: input.sciencePort,
    previewPort: input.previewPort,
    env,
    args: [
      "serve",
      "--data-dir",
      dataDir,
      "--host",
      "127.0.0.1",
      "--port",
      String(input.sciencePort),
      "--sandbox-port",
      String(input.previewPort),
      "--no-auto-update",
      "--detached",
    ],
  };
}

export function firstHttpUrl(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const token = line.trim().split(/\s+/)[0];
    if (token?.startsWith("http://") || token?.startsWith("https://")) {
      return token;
    }
  }
  return undefined;
}

async function runScience(
  spec: ScienceLaunchSpec,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(spec.binary, args, {
      env: spec.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude Science 命令超时"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

export async function startScience(spec: ScienceLaunchSpec): Promise<RunningScience> {
  const launched = await runScience(spec, spec.args, 20_000);
  if (launched.code !== 0 && launched.code !== null) {
    throw new Error("启动 Claude Science 失败");
  }
  const deadline = Date.now() + 25_000;
  let url = `http://127.0.0.1:${spec.sciencePort}`;
  while (Date.now() < deadline) {
    try {
      const probed = await runScience(spec, ["url", "--data-dir", spec.dataDir], 5_000);
      const found = firstHttpUrl(probed.stdout);
      if (found) {
        url = found;
        break;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return {
    binary: spec.binary,
    dataDir: spec.dataDir,
    home: spec.home,
    port: spec.sciencePort,
    url,
  };
}

export async function stopScience(running: RunningScience): Promise<void> {
  const spec: ScienceLaunchSpec = {
    binary: running.binary,
    home: running.home,
    dataDir: running.dataDir,
    gatewayUrl: "",
    sciencePort: running.port,
    previewPort: running.port,
    env: {
      HOME: running.home,
      USERPROFILE: running.home,
      PATH: process.platform === "win32" ? "C:\\Windows\\System32;C:\\Windows" : "/usr/bin:/bin",
    },
    args: [],
  };
  await runScience(spec, ["stop", "--data-dir", running.dataDir], 10_000).catch(() => undefined);
  running.child?.kill();
}
