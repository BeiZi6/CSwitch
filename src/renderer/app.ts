import { requireBridge } from "./bridge.js";

type Snapshot = {
  port: number;
  currentId: string | null;
  profiles: Array<{
    id: string;
    name: string;
    provider: string;
    baseUrl: string;
    models: { sonnet: string; opus: string; haiku: string; fable: string };
    apiKeyMasked: string;
    hasKey: boolean;
  }>;
  running: boolean;
  scienceRunning: boolean;
  endpoint: string | null;
  scienceUrl: string | null;
  currentName: string | null;
  provider: string | null;
};

type Profile = Snapshot["profiles"][number];

declare global {
  interface Window {
    cswitch?: {
      listProfiles(): Promise<Snapshot>;
      saveProfile(profile: unknown): Promise<Snapshot>;
      deleteProfile(id: string): Promise<Snapshot>;
      setCurrent(id: string): Promise<Snapshot>;
      start(): Promise<Snapshot>;
      stop(): Promise<Snapshot>;
      status(): Promise<Snapshot>;
    };
  }
}

const VIEWS: Record<string, string> = {
  overview: "概览",
  profiles: "配置",
  logs: "运行日志",
  about: "关于",
};

const PROVIDERS: Record<string, { label: string; hint: string; placeholder: string }> = {
  anthropic: {
    label: "自定义 Anthropic",
    hint: "填写 Anthropic Messages 根地址。例如 https://api.example.com；请求会以 Anthropic 格式直连。",
    placeholder: "https://api.example.com",
  },
  "openai-chat": {
    label: "自定义 OpenAI Chat Completions",
    hint: "填写包含 /v1 的 Chat Completions 根地址。例如 https://api.deepseek.com/v1。",
    placeholder: "https://api.deepseek.com/v1",
  },
  "openai-responses": {
    label: "自定义 OpenAI Responses",
    hint: "填写 Responses 根地址。例如 https://api.openai.com/v1。",
    placeholder: "https://api.openai.com/v1",
  },
};

function api() {
  return requireBridge(window.cswitch);
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $(id) as HTMLInputElement | HTMLSelectElement;

let snapshot: Snapshot | null = null;
let busy = false;
const logs: Array<{ t: string; level: string; msg: string }> = [];

function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

function log(level: string, msg: string): void {
  logs.unshift({ t: nowTime(), level, msg });
  if (logs.length > 80) {
    logs.length = 80;
  }
}

function current(): Profile | undefined {
  return snapshot?.profiles.find((item) => item.id === snapshot?.currentId);
}

function byId(id: string): Profile | undefined {
  return snapshot?.profiles.find((item) => item.id === id);
}

function providerLabel(id: string): string {
  return PROVIDERS[id]?.label ?? id;
}

function modelCount(profile: Profile | undefined): number {
  if (!profile) {
    return 0;
  }
  return [profile.models.sonnet, profile.models.opus, profile.models.haiku, profile.models.fable].filter(Boolean)
    .length;
}

function showError(message: string): void {
  const box = $("error");
  box.hidden = !message;
  $("errorText").textContent = message;
}

function showAlert(message: string): void {
  const box = $("formAlert");
  box.hidden = !message;
  $("formAlertText").textContent = message;
}

function applyTheme(theme: string, announce: boolean): void {
  const light = theme === "light";
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  try {
    localStorage.setItem("cswitch.theme", light ? "light" : "dark");
  } catch {
    /* ignore */
  }
  const btn = $("themeBtn");
  btn.textContent = light ? "深色" : "浅色";
  btn.setAttribute("aria-pressed", light ? "true" : "false");
  btn.setAttribute("aria-label", light ? "切换到深色主题" : "切换到浅色主题");
  if (announce) {
    log("INFO", `已切换为${light ? "浅色" : "深色"}主题`);
    renderLogs();
  }
}

function setView(view: string): void {
  if (!VIEWS[view]) {
    view = "overview";
  }
  try {
    localStorage.setItem("cswitch.view", view);
  } catch {
    /* ignore */
  }
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))) {
    btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
  }
  for (const section of Array.from(document.querySelectorAll<HTMLElement>(".view"))) {
    section.classList.toggle("is-active", section.id === `view-${view}`);
  }
  $("crumbView").textContent = VIEWS[view];
}

function syncProviderHint(): void {
  const def = PROVIDERS[field("provider").value] ?? PROVIDERS.anthropic;
  ($("baseUrl") as HTMLInputElement).placeholder = def.placeholder;
  $("providerHint").textContent = def.hint;
}

function fillForm(profile: Profile | undefined): void {
  field("profileId").value = profile?.id ?? "";
  field("name").value = profile?.name ?? "";
  field("provider").value = profile?.provider ?? "anthropic";
  field("baseUrl").value = profile?.baseUrl ?? "";
  field("sonnet").value = profile?.models.sonnet ?? "";
  field("opus").value = profile?.models.opus ?? "";
  field("haiku").value = profile?.models.haiku ?? "";
  field("fable").value = profile?.models.fable ?? "";
  field("apiKey").value = "";
  ($("apiKey") as HTMLInputElement).placeholder = profile?.hasKey
    ? profile.apiKeyMasked
    : "必须填写";
  $("formTitle").textContent = profile ? `编辑配置 · ${profile.name}` : "新建配置";
  ($("deleteBtn") as HTMLButtonElement).disabled = !profile;
  syncProviderHint();
}

function renderLogs(): void {
  const list = $("logList");
  list.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "暂无活动。启动、保存或复制地址时会记录在这里。";
    list.append(empty);
    return;
  }
  for (const entry of logs) {
    const row = document.createElement("li");
    row.className = "log-row";
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = entry.t;
    const level = document.createElement("span");
    level.className = "log-level";
    level.textContent = entry.level;
    const msg = document.createElement("span");
    msg.className = "log-msg";
    msg.textContent = entry.msg;
    row.append(time, level, msg);
    list.append(row);
  }
}

function renderProfileList(): void {
  const list = $("profileList");
  list.replaceChildren();
  const profiles = snapshot?.profiles ?? [];
  $("profileCount").textContent = `${profiles.length} 个`;
  if (!profiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有配置。填写左侧表单并保存。";
    list.append(empty);
    return;
  }
  for (const profile of profiles) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `profile${profile.id === snapshot?.currentId ? " is-current" : ""}`;
    const nameRow = document.createElement("div");
    nameRow.className = "p-name";
    nameRow.textContent = profile.name;
    if (profile.id === snapshot?.currentId) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "当前";
      nameRow.append(badge);
    }
    const meta = document.createElement("div");
    meta.className = "p-meta";
    meta.textContent = `${providerLabel(profile.provider)} · ${profile.models.sonnet || "未映射"} · ${profile.apiKeyMasked}`;
    item.append(nameRow, meta);
    item.addEventListener("click", async () => {
      try {
        render(await api().setCurrent(profile.id));
        fillForm(profile);
        showAlert("");
        log("INFO", `切换当前配置：${profile.name}`);
        renderLogs();
      } catch (error) {
        showAlert(error instanceof Error ? error.message : String(error));
      }
    });
    list.append(item);
  }
}

function render(next: Snapshot): void {
  snapshot = next;
  const cur = current();
  const status = next.scienceRunning ? "Science 运行中" : next.running ? "网关已启动" : "已停止";
  $("runPillText").textContent = status;
  $("runPill").classList.toggle("is-on", next.running || next.scienceRunning);
  $("connText").textContent = status;
  $("conn").classList.toggle("is-on", next.running || next.scienceRunning);
  $("currentChip").textContent = `当前 · ${cur?.name ?? "—"}`;
  $("currentName").textContent = cur?.name ?? "尚未选择配置";
  $("currentMeta").textContent = cur
    ? `${providerLabel(cur.provider)} · ${cur.models.sonnet || "未映射"} · Key ${cur.apiKeyMasked}`
    : "保存配置后点启动，会打开本机 Claude Science 并走这些模型。";
  const endpoint = $("endpoint");
  endpoint.textContent = next.endpoint ?? "未启动";
  endpoint.classList.toggle("is-empty", !next.endpoint);
  const science = $("scienceUrl");
  science.textContent = next.scienceUrl ?? "未启动";
  science.classList.toggle("is-empty", !next.scienceUrl);
  const power = $("powerBtn") as HTMLButtonElement;
  power.textContent = next.running ? "停止网关" : "启动 Claude Science";
  power.disabled = busy || (!next.running && !cur);
  ($("copyBtn") as HTMLButtonElement).disabled = !next.endpoint;
  $("statProvider").textContent = cur ? providerLabel(cur.provider) : "—";
  $("statModels").textContent = cur ? `${modelCount(cur)} / 4` : "—";
  $("statPort").textContent = String(next.port);
  $("portLabel").textContent = `PORT ${next.port}`;
  const activeStep = next.running ? 3 : cur ? 2 : 1;
  for (const n of [1, 2, 3]) {
    const el = $(`step${n}`);
    el.classList.toggle("is-active", n === activeStep);
    el.classList.toggle("is-done", n < activeStep);
  }
  renderProfileList();
  renderLogs();
}

async function withBusy(fn: () => Promise<void>): Promise<void> {
  busy = true;
  ($("powerBtn") as HTMLButtonElement).disabled = true;
  try {
    await fn();
  } finally {
    busy = false;
    if (snapshot) {
      render(snapshot);
    }
  }
}

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const id = field("profileId").value;
    const name = field("name").value.trim();
    const existing = byId(id);
    const knownIds = new Set((snapshot?.profiles ?? []).map((item) => item.id));
    const saved = await api().saveProfile({
      id: id || undefined,
      name,
      provider: field("provider").value,
      baseUrl: field("baseUrl").value,
      apiKey: field("apiKey").value || (existing?.hasKey ? undefined : ""),
      models: {
        sonnet: field("sonnet").value,
        opus: field("opus").value,
        haiku: field("haiku").value,
        fable: field("fable").value,
      },
    });
    const savedId =
      id ||
      saved.profiles.find((item) => !knownIds.has(item.id))?.id ||
      saved.profiles.find((item) => item.name === name)?.id;
    const next = savedId && saved.currentId !== savedId ? await api().setCurrent(savedId) : saved;
    render(next);
    fillForm(savedId ? byId(savedId) : undefined);
    showAlert("");
    showError("");
    log("OK", `已保存并设为当前：${name}`);
    renderLogs();
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
  }
});

$("deleteBtn").addEventListener("click", async () => {
  const id = field("profileId").value;
  if (!id) {
    return;
  }
  const target = byId(id);
  try {
    let next = await api().deleteProfile(id);
    if (snapshot?.running && snapshot.currentId === id) {
      next = await api().stop();
      log("INFO", "当前配置已删除，网关已停止");
    }
    render(next);
    fillForm(current());
    showAlert("");
    log("WARN", `已删除配置：${target?.name ?? id}`);
    renderLogs();
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
  }
});

$("powerBtn").addEventListener("click", async () => {
  if (!snapshot) {
    return;
  }
  await withBusy(async () => {
    try {
      showError("");
      if (snapshot?.running) {
        ($("powerBtn") as HTMLButtonElement).textContent = "停止中…";
        render(await api().stop());
        log("INFO", "已停止网关并关闭 Science");
      } else {
        ($("powerBtn") as HTMLButtonElement).textContent = "启动中…";
        render(await api().start());
        log("OK", "Claude Science 已启动，指向本地网关");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(message);
      log("ERR", message);
      setView("overview");
    }
  });
});

$("copyBtn").addEventListener("click", async () => {
  const endpoint = snapshot?.endpoint ?? "";
  if (!endpoint.startsWith("http")) {
    return;
  }
  await navigator.clipboard.writeText(endpoint);
  const btn = $("copyBtn");
  const prev = btn.textContent;
  btn.textContent = "已复制";
  window.setTimeout(() => {
    btn.textContent = prev;
  }, 1400);
  log("OK", "已复制网关地址到剪贴板");
  renderLogs();
});

$("newBtn").addEventListener("click", () => {
  fillForm(undefined);
  showAlert("");
  $("name").focus();
});

$("clearLogs").addEventListener("click", () => {
  logs.length = 0;
  renderLogs();
});

$("provider").addEventListener("change", syncProviderHint);

$("themeBtn").addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light", true);
});

for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))) {
  btn.addEventListener("click", () => setView(btn.getAttribute("data-view") ?? "overview"));
}

let initialView = "overview";
try {
  initialView = localStorage.getItem("cswitch.view") || "overview";
} catch {
  /* ignore */
}

log("INFO", "CSwitch 控制台已就绪");
applyTheme(document.documentElement.getAttribute("data-theme") || "dark", false);
setView(initialView);
syncProviderHint();

void api()
  .status()
  .then((next) => {
    render(next);
    fillForm(current());
    log("INFO", `已载入 ${next.profiles.length} 个配置`);
    renderLogs();
  })
  .catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
