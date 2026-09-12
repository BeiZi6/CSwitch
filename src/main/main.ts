import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomSecret } from "../gateway/auth.js";
import { listenGateway, scienceBaseUrl, type RunningGateway } from "../gateway/server.js";
import {
  buildScienceLaunch,
  resolveScienceBinary,
  startScience,
  stopScience,
  type RunningScience,
} from "../science/launch.js";
import {
  currentProfile,
  deleteProfile,
  loadState,
  publicProfile,
  saveState,
  upsertProfile,
  validateProfile,
  type StoredState,
} from "../store/profiles.js";
import type { Profile } from "../gateway/types.js";

let windowRef: BrowserWindow | undefined;
let running: RunningGateway | undefined;
let science: RunningScience | undefined;
let authSecret = randomSecret();

function dataRoot(): string {
  return join(app.getPath("userData"), "cswitch");
}

function readState(): StoredState {
  const state = loadState(dataRoot());
  return {
    ...state,
    profiles: state.profiles.map(decryptProfile),
  };
}

function persist(state: StoredState): void {
  saveState(dataRoot(), {
    ...state,
    profiles: state.profiles.map(encryptProfile),
  });
}

function encryptProfile(profile: Profile): Profile {
  if (!safeStorage.isEncryptionAvailable() || !profile.apiKey) {
    return profile;
  }
  return {
    ...profile,
    apiKey: `enc:${safeStorage.encryptString(profile.apiKey).toString("base64")}`,
  };
}

function decryptProfile(profile: Profile): Profile {
  if (!profile.apiKey.startsWith("enc:")) {
    return profile;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ...profile, apiKey: "" };
  }
  try {
    const buf = Buffer.from(profile.apiKey.slice(4), "base64");
    return { ...profile, apiKey: safeStorage.decryptString(buf) };
  } catch {
    return { ...profile, apiKey: "" };
  }
}

function snapshot(state = readState()) {
  const current = currentProfile(state);
  return {
    port: state.port,
    currentId: state.currentId,
    profiles: state.profiles.map(publicProfile),
    running: Boolean(running),
    scienceRunning: Boolean(science),
    endpoint: running ? scienceBaseUrl(running.port, running.authSecret) : null,
    scienceUrl: science?.url ?? null,
    currentName: current?.name ?? null,
    provider: current?.provider ?? null,
  };
}

async function createWindow(): Promise<void> {
  windowRef = new BrowserWindow({
    width: 920,
    height: 650,
    minWidth: 760,
    minHeight: 520,
    title: "CSwitch",
    backgroundColor: "#eee7dc",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.removeMenu();
  await windowRef.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc(): void {
  ipcMain.handle("profiles:list", () => snapshot());
  ipcMain.handle("profiles:save", (_event, input: unknown) => {
    const raw = input as Parameters<typeof validateProfile>[0];
    const state = readState();
    const existing = raw.id ? state.profiles.find((item) => item.id === raw.id) : undefined;
    const profile = validateProfile({
      ...raw,
      apiKey: (raw.apiKey ?? "").trim() || existing?.apiKey || "",
    });
    const next = upsertProfile(state, profile);
    persist(next);
    return snapshot(next);
  });
  ipcMain.handle("profiles:delete", (_event, id: string) => {
    const next = deleteProfile(readState(), id);
    persist(next);
    return snapshot(next);
  });
  ipcMain.handle("profiles:current", (_event, id: string) => {
    const state = readState();
    if (!state.profiles.some((item) => item.id === id)) {
      throw new Error("配置不存在");
    }
    const next = { ...state, currentId: id };
    persist(next);
    return snapshot(next);
  });
  ipcMain.handle("gateway:start", async () => {
    const state = readState();
    const profile = currentProfile(state);
    if (!profile) {
      throw new Error("请先选择一个配置");
    }
    const binary = resolveScienceBinary(process.platform, process.env);
    if (science) {
      await stopScience(science);
      science = undefined;
    }
    if (running) {
      await running.close();
      running = undefined;
    }
    authSecret = randomSecret();
    running = await listenGateway({
      port: state.port,
      authSecret,
      profile,
    });
    const sandboxHome = join(dataRoot(), "sandbox", "home");
    mkdirSync(join(sandboxHome, "tmp"), { recursive: true });
    const previewPort = state.sciencePort === 8763 ? 8992 : state.sciencePort + 2;
    try {
      const spec = buildScienceLaunch({
        binary,
        sandboxHome,
        realHome: homedir(),
        gatewayUrl: scienceBaseUrl(running.port, running.authSecret),
        sciencePort: state.sciencePort,
        previewPort,
        platform: process.platform,
      });
      science = await startScience(spec);
      await shell.openExternal(science.url);
    } catch (error) {
      await running.close();
      running = undefined;
      throw error;
    }
    return snapshot(state);
  });
  ipcMain.handle("gateway:stop", async () => {
    if (science) {
      await stopScience(science);
      science = undefined;
    }
    if (running) {
      await running.close();
      running = undefined;
    }
    return snapshot();
  });
  ipcMain.handle("gateway:status", () => snapshot());
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on("second-instance", () => {
    windowRef?.show();
    windowRef?.focus();
  });
  app.whenReady().then(async () => {
    registerIpc();
    await createWindow();
  });
  app.on("before-quit", () => {
    if (science) {
      void stopScience(science);
    }
    void running?.close();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
