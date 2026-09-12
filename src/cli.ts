import { randomSecret } from "./gateway/auth.js";
import { listenGateway, scienceBaseUrl } from "./gateway/server.js";
import { validateProfile } from "./store/profiles.js";
import { DEFAULT_GATEWAY_PORT, type ProviderKind } from "./gateway/types.js";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const provider = (arg("--provider") ?? "anthropic") as ProviderKind;
const port = Number(arg("--port") ?? process.env.CSWITCH_PORT ?? String(DEFAULT_GATEWAY_PORT));
const authSecret = arg("--auth-token") ?? process.env.CSWITCH_AUTH_TOKEN ?? randomSecret();
const profile = validateProfile({
  name: "cli",
  provider,
  baseUrl: arg("--base-url") ?? process.env.CSWITCH_BASE_URL ?? "",
  apiKey: arg("--api-key") ?? process.env.CSWITCH_API_KEY ?? "",
  models: {
    sonnet: arg("--model") ?? process.env.CSWITCH_MODEL ?? "default",
    opus: arg("--model-opus") ?? process.env.CSWITCH_MODEL_OPUS ?? "",
    haiku: arg("--model-haiku") ?? process.env.CSWITCH_MODEL_HAIKU ?? "",
    fable: arg("--model-fable") ?? process.env.CSWITCH_MODEL_FABLE ?? "",
  },
});

const running = await listenGateway({ port, authSecret, profile });
const url = scienceBaseUrl(running.port, running.authSecret);
process.stdout.write(`CSwitch gateway listening\nANTHROPIC_BASE_URL=${url}\n`);
