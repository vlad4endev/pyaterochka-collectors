import { createHmac } from "node:crypto";
import { db } from "../db";
import { getSettings } from "./domain";
import { HttpError, timingSafeEqualString } from "./errors";
import { ensureMaxTrustedCa } from "./maxTls";
import { assertGroupChatId, assertMiniAppUrl, getMiniAppUrl, refreshTelegramRuntime } from "./telegram";

export { assertGroupChatId, assertMiniAppUrl, getMiniAppUrl };

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
const MAX_API_V2 = "https://platform-api2.max.ru";
const MAX_API_LEGACY = "https://platform-api.max.ru";

let apiBaseUrl: string | null = null;
let apiBaseUrlPromise: Promise<string> | null = null;

export async function resolveMaxApiBaseUrl(): Promise<string> {
  if (apiBaseUrl) {
    return apiBaseUrl;
  }
  if (!apiBaseUrlPromise) {
    apiBaseUrlPromise = probeMaxApiBaseUrl();
  }
  return await apiBaseUrlPromise;
}

async function probeMaxApiBaseUrl(): Promise<string> {
  ensureMaxTrustedCa();
  try {
    const response = await fetch(`${MAX_API_V2}/me`);
    await response.arrayBuffer().catch(() => undefined);
    apiBaseUrl = MAX_API_V2;
    return apiBaseUrl;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`MAX API: ${MAX_API_V2} is unreachable (${detail}), using ${MAX_API_LEGACY}`);
    apiBaseUrl = MAX_API_LEGACY;
    return apiBaseUrl;
  }
}

export type MaxUser = {
  id: number;
  firstName: string;
  username?: string;
};

export type MaxRuntime = {
  botToken: string | null;
  botUsername: string | null;
  botName: string | null;
  botRunning: boolean;
};

export type MaxStatus = {
  botTokenSet: boolean;
  botTokenSource: "database" | "env" | null;
  botUsername: string | null;
  botName: string | null;
  botRunning: boolean;
  miniAppUrl: string | null;
  groupChatId: string | null;
  groupChatTitle: string | null;
};

let runtime: MaxRuntime = {
  botToken: null,
  botUsername: null,
  botName: null,
  botRunning: false,
};

export function patchMaxRuntime(partial: Partial<MaxRuntime>): void {
  runtime = { ...runtime, ...partial };
}

export async function refreshMaxRuntime(): Promise<MaxRuntime> {
  await refreshTelegramRuntime();
  const settings = await getSettings(db);
  const botToken = settings?.maxBotToken?.trim() || process.env.MAX_BOT_TOKEN?.trim() || null;
  runtime = {
    ...runtime,
    botToken,
    botUsername: botToken ? runtime.botUsername : null,
    botName: botToken ? runtime.botName : null,
    botRunning: botToken ? runtime.botRunning : false,
  };
  return runtime;
}

export async function getMaxBotToken(): Promise<string> {
  if (!runtime.botToken) {
    await refreshMaxRuntime();
  }
  if (!runtime.botToken) {
    throw new HttpError("MAX_BOT_TOKEN is not configured", 500);
  }
  return runtime.botToken;
}

export function getMaxBotUsername(): string | null {
  return runtime.botUsername;
}

export function maxMiniAppLink(username: string | null): string | null {
  if (!username) {
    return null;
  }
  return `https://max.ru/${username}?startapp`;
}

async function maxFetch(
  token: string,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const baseUrl = await resolveMaxApiBaseUrl();
  return await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: token,
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });
}

function maxErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export async function fetchMaxBotIdentity(
  token: string,
): Promise<{ username: string | null; name: string; id: number }> {
  let response: Response;
  try {
    response = await maxFetch(token, "/me");
  } catch (err) {
    console.error("MAX API /me failed", err);
    throw new HttpError("Failed to reach MAX API", 503);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    throw new HttpError("Invalid MAX bot token");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError("Invalid MAX bot token");
  }
  if ("is_bot" in payload && payload.is_bot === false) {
    throw new HttpError("Invalid MAX bot token");
  }
  const id = asMaxUserId(
    "user_id" in payload ? payload.user_id : "id" in payload ? payload.id : undefined,
  );
  if (id == null) {
    throw new HttpError("Invalid MAX bot token");
  }
  const username =
    "username" in payload && typeof payload.username === "string" && payload.username.trim()
      ? payload.username.replace(/^@/, "")
      : null;
  const name =
    "name" in payload && typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : "first_name" in payload && typeof payload.first_name === "string" && payload.first_name.trim()
        ? payload.first_name.trim()
        : username ?? "бот";
  return { username, name, id };
}

export async function fetchMaxChatTitle(token: string, chatId: string): Promise<string | null> {
  const response = await maxFetch(token, `/chats/${encodeURIComponent(chatId)}`);
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError("Chat not found");
  }
  if ("code" in payload || response.status >= 400) {
    throw new HttpError("Chat not found");
  }
  if ("title" in payload && typeof payload.title === "string" && payload.title.trim()) {
    return payload.title;
  }
  if ("link" in payload && typeof payload.link === "string" && payload.link.trim()) {
    return payload.link;
  }
  return null;
}

export async function unsubscribeMaxWebhooks(token: string): Promise<void> {
  const response = await maxFetch(token, "/subscriptions");
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || !("subscriptions" in payload)) {
    return;
  }
  const list = payload.subscriptions;
  if (!Array.isArray(list) || list.length === 0) {
    return;
  }
  for (const item of list) {
    if (typeof item !== "object" || item === null || !("url" in item) || typeof item.url !== "string") {
      continue;
    }
    const url = item.url.trim();
    if (!url) {
      continue;
    }
    console.warn(`MAX API: removing webhook ${url} so long polling can receive /start`);
    await maxFetch(token, `/subscriptions?url=${encodeURIComponent(url)}`, { method: "DELETE" });
  }
}

export async function sendMaxMessage(chatId: string, text: string): Promise<void> {
  const token = await getMaxBotToken();
  const id = Number(chatId);
  if (!Number.isFinite(id)) {
    throw new HttpError("Invalid group chat ID");
  }
  const asUser = id > 0;
  const query = asUser ? `user_id=${id}` : `chat_id=${id}`;
  const response = await maxFetch(token, `/messages?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || (typeof payload === "object" && payload !== null && "code" in payload)) {
    const description = maxErrorMessage(payload, "").toLowerCase();
    if (
      description.includes("dialog") ||
      description.includes("not found") ||
      description.includes("denied") ||
      description.includes("access")
    ) {
      throw new HttpError("Collector has not started the MAX bot");
    }
    throw new HttpError("Failed to send MAX message", 503);
  }
}

export async function getMaxStatus(): Promise<MaxStatus> {
  await refreshMaxRuntime();
  const settings = await getSettings(db);
  const dbToken = settings?.maxBotToken?.trim() || null;
  const envToken = process.env.MAX_BOT_TOKEN?.trim() || null;
  return {
    botTokenSet: Boolean(runtime.botToken),
    botTokenSource: dbToken ? "database" : envToken ? "env" : null,
    botUsername: runtime.botUsername,
    botName: runtime.botName,
    botRunning: runtime.botRunning,
    miniAppUrl: getMiniAppUrl(),
    groupChatId: settings?.maxGroupChatId ?? null,
    groupChatTitle: settings?.maxGroupChatTitle ?? null,
  };
}

function asMaxUserId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function verifyMaxInitData(
  initData: string | undefined,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): MaxUser {
  if (!initData) {
    throw new HttpError("Not authenticated", 401);
  }
  const pairs: Array<[string, string]> = [];
  for (const part of initData.split("&")) {
    if (!part) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq < 1) {
      throw new HttpError("Invalid MAX initData", 401);
    }
    const key = part.slice(0, eq);
    const raw = part.slice(eq + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      throw new HttpError("Invalid MAX initData", 401);
    }
    pairs.push([key, value]);
  }
  const hashCount = pairs.filter(([key]) => key === "hash").length;
  if (hashCount !== 1) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  const hash = pairs.find(([key]) => key === "hash")?.[1];
  if (!hash) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  const launchParams = pairs
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(launchParams).digest("hex");
  if (!timingSafeEqualString(computed, hash.toLowerCase())) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  const authDate = Number(pairs.find(([key]) => key === "auth_date")?.[1]);
  if (!Number.isFinite(authDate) || nowSec - authDate > INIT_DATA_MAX_AGE_SEC) {
    throw new HttpError("MAX initData expired", 401);
  }
  const rawUser = pairs.find(([key]) => key === "user")?.[1];
  if (!rawUser) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    throw new HttpError("Invalid MAX initData", 401);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null
  ) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  const id = asMaxUserId(
    "id" in parsed
      ? parsed.id
      : "user_id" in parsed
        ? parsed.user_id
        : undefined,
  );
  const firstName =
    "first_name" in parsed && typeof parsed.first_name === "string"
      ? parsed.first_name
      : "name" in parsed && typeof parsed.name === "string"
        ? parsed.name
        : null;
  if (id == null || !firstName) {
    throw new HttpError("Invalid MAX initData", 401);
  }
  const username =
    "username" in parsed && typeof parsed.username === "string" ? parsed.username : undefined;
  return {
    id,
    firstName,
    username,
  };
}
