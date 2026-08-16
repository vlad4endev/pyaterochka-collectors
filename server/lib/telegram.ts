import { createHmac } from "node:crypto";
import { db } from "../db";
import { getSettings } from "./domain";
import { HttpError, timingSafeEqualString } from "./errors";
import {
  assertTelegramProxyConfig,
  createTelegramProxyAgent,
  parseTelegramProxyUrl,
  probeTelegramApi,
  telegramFetch,
  type TelegramPathError,
  type TelegramProxyAgent,
  type TelegramProxyConfig,
} from "./telegramProxy";

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export type TelegramUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
};

export type TelegramRuntime = {
  botToken: string | null;
  miniAppUrl: string | null;
  botUsername: string | null;
  botRunning: boolean;
  proxy: TelegramProxyConfig | null;
  proxySource: "database" | "env" | null;
  proxyAgent: TelegramProxyAgent | null;
};

export type TelegramPathCheck = {
  ok: boolean;
  via: "proxy" | "direct";
  latencyMs: number;
  error: TelegramPathError | null;
  checkedAt: number;
};

export type TelegramStatus = {
  botTokenSet: boolean;
  botTokenSource: "database" | "env" | null;
  botUsername: string | null;
  botRunning: boolean;
  miniAppUrl: string | null;
  groupChatId: string | null;
  groupChatTitle: string | null;
  proxyConfigured: boolean;
  proxySource: "database" | "env" | null;
  proxyType: "http" | "socks5" | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPasswordSet: boolean;
  pathCheck: TelegramPathCheck | null;
};

let runtime: TelegramRuntime = {
  botToken: null,
  miniAppUrl: null,
  botUsername: null,
  botRunning: false,
  proxy: null,
  proxySource: null,
  proxyAgent: null,
};

export function patchTelegramRuntime(partial: Partial<TelegramRuntime>): void {
  runtime = { ...runtime, ...partial };
}

export function normalizeMiniAppUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim().replace(/\/$/, "") ?? "";
  if (!url) {
    return null;
  }
  if (!url.startsWith("https://")) {
    return null;
  }
  return url;
}

export function assertMiniAppUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed.startsWith("https://")) {
    throw new HttpError("MINIAPP_URL must be an https URL");
  }
  try {
    new URL(trimmed);
  } catch {
    throw new HttpError("MINIAPP_URL must be an https URL");
  }
  return trimmed;
}

export function assertGroupChatId(raw: string): string {
  const trimmed = raw.trim();
  if (!/^-?\d{5,20}$/.test(trimmed)) {
    throw new HttpError("Invalid group chat ID");
  }
  return trimmed;
}

function proxyFromSettings(settings: {
  proxyType: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
} | null): TelegramProxyConfig | null {
  if (!settings?.proxyType || !settings.proxyHost || settings.proxyPort == null) {
    return null;
  }
  try {
    return assertTelegramProxyConfig({
      type: settings.proxyType,
      host: settings.proxyHost,
      port: settings.proxyPort,
      username: settings.proxyUsername,
      password: settings.proxyPassword,
    });
  } catch {
    return null;
  }
}

function resolveProxy(settings: {
  proxyType: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
} | null): { proxy: TelegramProxyConfig | null; source: "database" | "env" | null } {
  const fromDb = proxyFromSettings(settings);
  if (fromDb) {
    return { proxy: fromDb, source: "database" };
  }
  const env = process.env.TELEGRAM_PROXY?.trim();
  if (env) {
    try {
      return { proxy: parseTelegramProxyUrl(env), source: "env" };
    } catch {
      return { proxy: null, source: null };
    }
  }
  return { proxy: null, source: null };
}

export async function refreshTelegramRuntime(): Promise<TelegramRuntime> {
  const settings = await getSettings(db);
  const botToken = settings?.botToken?.trim() || process.env.BOT_TOKEN?.trim() || null;
  const miniAppUrl = normalizeMiniAppUrl(
    settings?.miniAppUrl?.trim() || process.env.MINIAPP_URL?.trim() || "",
  );
  const { proxy, source } = resolveProxy(settings);
  runtime = {
    ...runtime,
    botToken,
    miniAppUrl,
    botUsername: botToken ? runtime.botUsername : null,
    botRunning: botToken ? runtime.botRunning : false,
    proxy,
    proxySource: source,
    proxyAgent: proxy ? createTelegramProxyAgent(proxy) : null,
  };
  return runtime;
}

export function getTelegramProxyAgent(): TelegramProxyAgent | null {
  return runtime.proxyAgent;
}

let lastPathCheck: TelegramPathCheck | null = null;
let lastPathCheckKey: string | null = null;

function currentPathKey(): string {
  const proxy = runtime.proxy;
  if (!proxy) {
    return "direct";
  }
  return `${proxy.type}:${proxy.host}:${proxy.port}:${proxy.username ?? ""}`;
}

export async function checkTelegramPath(): Promise<TelegramPathCheck> {
  await refreshTelegramRuntime();
  const probe = await probeTelegramApi(runtime.proxyAgent, runtime.botToken);
  lastPathCheck = {
    ok: probe.ok,
    via: runtime.proxy ? "proxy" : "direct",
    latencyMs: probe.latencyMs,
    error: probe.error,
    checkedAt: Date.now(),
  };
  lastPathCheckKey = currentPathKey();
  return lastPathCheck;
}

function cachedPathCheck(): TelegramPathCheck | null {
  if (!lastPathCheck || lastPathCheckKey !== currentPathKey()) {
    return null;
  }
  return lastPathCheck;
}

export async function telegramApiFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return await telegramFetch(url, init, runtime.proxyAgent);
}

export async function getBotToken(): Promise<string> {
  if (!runtime.botToken) {
    await refreshTelegramRuntime();
  }
  if (!runtime.botToken) {
    throw new HttpError("BOT_TOKEN is not configured", 500);
  }
  return runtime.botToken;
}

export function getMiniAppUrl(): string | null {
  return runtime.miniAppUrl;
}

export async function fetchBotIdentity(token: string): Promise<{ username: string; id: number }> {
  await refreshTelegramRuntime();
  const response = await telegramApiFetch(`https://api.telegram.org/bot${token}/getMe`);
  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("result" in payload) ||
    typeof payload.result !== "object" ||
    payload.result === null ||
    !("username" in payload.result) ||
    typeof payload.result.username !== "string" ||
    !("id" in payload.result) ||
    typeof payload.result.id !== "number"
  ) {
    throw new HttpError("Invalid bot token");
  }
  return { username: payload.result.username, id: payload.result.id };
}

export async function fetchChatTitle(token: string, chatId: string): Promise<string | null> {
  await refreshTelegramRuntime();
  const response = await telegramApiFetch(`https://api.telegram.org/bot${token}/getChat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("result" in payload) ||
    typeof payload.result !== "object" ||
    payload.result === null
  ) {
    throw new HttpError("Chat not found");
  }
  const result = payload.result;
  if ("title" in result && typeof result.title === "string") {
    return result.title;
  }
  if ("username" in result && typeof result.username === "string") {
    return `@${result.username}`;
  }
  return null;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = await getBotToken();
  const response = await telegramApiFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true
  ) {
    const description =
      typeof payload === "object" &&
      payload !== null &&
      "description" in payload &&
      typeof payload.description === "string"
        ? payload.description.toLowerCase()
        : "";
    if (
      description.includes("can't initiate conversation") ||
      description.includes("bot was blocked")
    ) {
      throw new HttpError("Collector has not started the bot");
    }
    throw new HttpError("Failed to send Telegram message", 503);
  }
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  await refreshTelegramRuntime();
  const settings = await getSettings(db);
  const dbToken = settings?.botToken?.trim() || null;
  const envToken = process.env.BOT_TOKEN?.trim() || null;
  return {
    botTokenSet: Boolean(runtime.botToken),
    botTokenSource: dbToken ? "database" : envToken ? "env" : null,
    botUsername: runtime.botUsername,
    botRunning: runtime.botRunning,
    miniAppUrl: runtime.miniAppUrl,
    groupChatId: settings?.groupChatId ?? null,
    groupChatTitle: settings?.groupChatTitle ?? null,
    proxyConfigured: Boolean(runtime.proxy),
    proxySource: runtime.proxySource,
    proxyType: runtime.proxy?.type ?? null,
    proxyHost: runtime.proxy?.host ?? null,
    proxyPort: runtime.proxy?.port ?? null,
    proxyUsername: runtime.proxy?.username ?? null,
    proxyPasswordSet: Boolean(runtime.proxy?.password),
    pathCheck: cachedPathCheck(),
  };
}

export function verifyTelegramInitData(
  initData: string | undefined,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): TelegramUser {
  if (!initData) {
    throw new HttpError("Not authenticated", 401);
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new HttpError("Invalid Telegram initData", 401);
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!timingSafeEqualString(computed, hash.toLowerCase())) {
    throw new HttpError("Invalid Telegram initData", 401);
  }
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSec - authDate > INIT_DATA_MAX_AGE_SEC) {
    throw new HttpError("Telegram initData expired", 401);
  }
  const rawUser = params.get("user");
  if (!rawUser) {
    throw new HttpError("Invalid Telegram initData", 401);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    throw new HttpError("Invalid Telegram initData", 401);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("id" in parsed) ||
    typeof parsed.id !== "number" ||
    !("first_name" in parsed) ||
    typeof parsed.first_name !== "string"
  ) {
    throw new HttpError("Invalid Telegram initData", 401);
  }
  const lastName =
    "last_name" in parsed && typeof parsed.last_name === "string"
      ? parsed.last_name
      : undefined;
  const username =
    "username" in parsed && typeof parsed.username === "string"
      ? parsed.username
      : undefined;
  return {
    id: parsed.id,
    firstName: parsed.first_name,
    lastName,
    username,
  };
}
