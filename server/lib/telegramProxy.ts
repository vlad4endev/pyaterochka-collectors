import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpError } from "./errors";

export type TelegramProxyType = "http" | "socks5";

export type TelegramProxyConfig = {
  type: TelegramProxyType;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
};

export type TelegramProxyAgent = HttpsProxyAgent<string> | SocksProxyAgent;

const HOST_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$|^\[?[0-9a-fA-F:]+\]?$/;

export function assertTelegramProxyConfig(input: {
  type: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}): TelegramProxyConfig {
  if (input.type !== "http" && input.type !== "socks5") {
    throw new HttpError("Proxy type must be http or socks5");
  }
  const host = input.host.trim();
  if (!host || host.includes("://") || /\s/.test(host) || !HOST_RE.test(host)) {
    throw new HttpError("Invalid proxy host");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new HttpError("Invalid proxy port");
  }
  const username = input.username?.trim() || null;
  const password = username ? (input.password ?? "") : null;
  return {
    type: input.type,
    host,
    port: input.port,
    username,
    password,
  };
}

export function parseTelegramProxyUrl(raw: string): TelegramProxyConfig {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new HttpError("Invalid Telegram proxy URL");
  }
  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  let type: TelegramProxyType;
  if (protocol === "http" || protocol === "https") {
    type = "http";
  } else if (protocol === "socks" || protocol === "socks5" || protocol === "socks5h") {
    type = "socks5";
  } else {
    throw new HttpError("Proxy type must be http or socks5");
  }
  const port = parsed.port
    ? Number(parsed.port)
    : type === "socks5"
      ? 1080
      : 8080;
  return assertTelegramProxyConfig({
    type,
    host: parsed.hostname,
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
  });
}

export function buildProxyUrl(config: TelegramProxyConfig): string {
  const scheme = config.type === "socks5" ? "socks5h" : "http";
  const auth =
    config.username != null && config.username.length > 0
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? "")}@`
      : "";
  const host =
    config.host.includes(":") && !config.host.startsWith("[") ? `[${config.host}]` : config.host;
  return `${scheme}://${auth}${host}:${config.port}`;
}

export function createTelegramProxyAgent(config: TelegramProxyConfig): TelegramProxyAgent {
  const url = buildProxyUrl(config);
  if (config.type === "socks5") {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

export type TelegramPathError =
  | "timeout"
  | "refused"
  | "host_not_found"
  | "auth"
  | "reset"
  | "unreachable";

export type TelegramPathProbe = {
  ok: boolean;
  latencyMs: number;
  error: TelegramPathError | null;
};

function classifyNetworkError(err: unknown): TelegramPathError {
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string"
      ? err.code
      : "";
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }
  if (code === "ECONNREFUSED" || message.includes("econnrefused")) {
    return "refused";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || message.includes("enotfound")) {
    return "host_not_found";
  }
  if (
    code === "ECONNRESET" ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  ) {
    return "reset";
  }
  if (
    message.includes("407") ||
    message.includes("authentication") ||
    message.includes("authenti")
  ) {
    return "auth";
  }
  return "unreachable";
}

export async function telegramFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined,
  agent: TelegramProxyAgent | null,
): Promise<{ ok: boolean; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer> }> {
  try {
    return await fetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      timeout: 15000,
      ...(agent ? { agent } : {}),
    });
  } catch {
    throw new HttpError("Cannot reach Telegram API. Check proxy settings", 503);
  }
}

export async function probeTelegramApi(
  agent: TelegramProxyAgent | null,
  botToken: string | null,
): Promise<TelegramPathProbe> {
  const started = Date.now();
  const url = botToken
    ? `https://api.telegram.org/bot${botToken}/getMe`
    : "https://api.telegram.org/";
  try {
    const response = await fetch(url, {
      timeout: 8000,
      ...(agent ? { agent } : {}),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 407) {
      return { ok: false, latencyMs, error: "auth" };
    }
    if (botToken) {
      const payload: unknown = await response.json().catch(() => null);
      if (typeof payload === "object" && payload !== null && "ok" in payload) {
        return { ok: true, latencyMs, error: null };
      }
      return { ok: false, latencyMs, error: "unreachable" };
    }
    return { ok: true, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: classifyNetworkError(err),
    };
  }
}
