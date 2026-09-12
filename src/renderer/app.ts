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

function api() {
  return requireBridge(window.cswitch);
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $(id) as HTMLInputElement | HTMLSelectElement;

function showError(message: string): void {
  const node = $("error");
  node.hidden = !message;
  node.textContent = message;
}

function fillForm(snapshot: Snapshot): void {
  const current = snapshot.profiles.find((item) => item.id === snapshot.currentId);
  $("currentName").textContent = snapshot.currentName ?? "尚未选择配置";
  $("currentMeta").textContent = current
    ? `${current.provider} · ${current.models.sonnet} · Key ${current.apiKeyMasked}`
    : "保存配置后点启动，会打开本机 Claude Science 并走这些模型。";
  $("endpoint").textContent = snapshot.endpoint ?? "未启动";
  $("scienceUrl").textContent = snapshot.scienceUrl ?? "未启动";
  $("runPill").textContent = snapshot.scienceRunning
    ? "Science 运行中"
    : snapshot.running
      ? "网关已启动"
      : "已停止";
  $("runPill").classList.toggle("on", snapshot.scienceRunning || snapshot.running);
  const list = $("profileList");
  list.replaceChildren();
  for (const profile of snapshot.profiles) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${profile.name} · ${profile.provider}`;
    button.classList.toggle("current", profile.id === snapshot.currentId);
    button.addEventListener("click", async () => {
      try {
        render(await api().setCurrent(profile.id));
        field("profileId").value = profile.id;
        field("name").value = profile.name;
        field("provider").value = profile.provider;
        field("baseUrl").value = profile.baseUrl;
        field("sonnet").value = profile.models.sonnet;
        field("opus").value = profile.models.opus;
        field("haiku").value = profile.models.haiku;
        field("fable").value = profile.models.fable;
        field("apiKey").value = "";
        ($("apiKey") as HTMLInputElement).placeholder = profile.apiKeyMasked;
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
      }
    });
    item.append(button);
    list.append(item);
  }
}

function render(snapshot: Snapshot): void {
  showError("");
  fillForm(snapshot);
}

async function refresh(): Promise<void> {
  render(await api().status());
}

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const current = (await api().status()).profiles.find(
      (item) => item.id === field("profileId").value,
    );
    render(
      await api().saveProfile({
        id: field("profileId").value || undefined,
        name: field("name").value,
        provider: field("provider").value,
        baseUrl: field("baseUrl").value,
        apiKey: field("apiKey").value || (current?.hasKey ? undefined : ""),
        models: {
          sonnet: field("sonnet").value,
          opus: field("opus").value,
          haiku: field("haiku").value,
          fable: field("fable").value,
        },
      }),
    );
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

$("deleteBtn").addEventListener("click", async () => {
  const id = field("profileId").value;
  if (!id) {
    return;
  }
  try {
    render(await api().deleteProfile(id));
    ($("profileForm") as HTMLFormElement).reset();
    field("profileId").value = "";
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

$("startBtn").addEventListener("click", async () => {
  try {
    render(await api().start());
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

$("stopBtn").addEventListener("click", async () => {
  try {
    render(await api().stop());
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

$("copyBtn").addEventListener("click", async () => {
  const endpoint = $("endpoint").textContent ?? "";
  if (endpoint.startsWith("http")) {
    await navigator.clipboard.writeText(endpoint);
  }
});

void refresh().catch((error) => {
  showError(error instanceof Error ? error.message : String(error));
});
