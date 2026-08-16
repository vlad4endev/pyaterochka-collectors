import { createHmac } from "node:crypto";
import { HttpError, timingSafeEqualString } from "./errors";

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export type TelegramUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
};

export function getBotToken(): string {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    throw new HttpError("BOT_TOKEN is not configured", 500);
  }
  return token;
}

export function getMiniAppUrl(): string | null {
  const url = process.env.MINIAPP_URL?.trim().replace(/\/$/, "") ?? "";
  if (!url) {
    return null;
  }
  if (!url.startsWith("https://")) {
    console.warn("MINIAPP_URL must be an https URL — Mini App button is skipped");
    return null;
  }
  return url;
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
