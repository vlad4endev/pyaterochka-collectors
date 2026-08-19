import type { PrismaClient } from "@prisma/client";
import { clockInTimeZone, STORE_TIME_ZONE } from "./dates";
import { assertPositiveKg, parseKgInput } from "./domain";
import { HttpError } from "./errors";
import {
  ASK_TOTAL_KG_TEXT,
  NEED_NUMBER_KG_TEXT,
  formatAcceptedReport,
} from "./messages";
import {
  findCollectorByPlatform,
  requireActiveCollector,
  submitCollectorReport,
  type MiniAppPlatform,
} from "./miniapp";

type Draft = {
  photoRef: string;
  at: number;
};

const drafts = new Map<string, Draft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

function draftKey(platform: MiniAppPlatform, userId: string): string {
  return `${platform}:${userId}`;
}

function getDraft(platform: MiniAppPlatform, userId: string): Draft | undefined {
  const key = draftKey(platform, userId);
  const draft = drafts.get(key);
  if (!draft) {
    return undefined;
  }
  if (Date.now() - draft.at > DRAFT_TTL_MS) {
    drafts.delete(key);
    return undefined;
  }
  return draft;
}

function clearDraft(platform: MiniAppPlatform, userId: string): void {
  drafts.delete(draftKey(platform, userId));
}

export function parseKgMessage(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutUnit = trimmed.replace(/\s*кг\.?\s*$/i, "").trim();
  return parseKgInput(withoutUnit);
}

export async function submitTodayCollectorReport(
  db: PrismaClient,
  platform: MiniAppPlatform,
  userId: string,
  body: { kg: number; photoRef?: string },
  nowMs = Date.now(),
): Promise<{ collectorName: string; date: string; kg: number }> {
  const collector = requireActiveCollector(await findCollectorByPlatform(db, platform, userId));
  const date = clockInTimeZone(STORE_TIME_ZONE, nowMs).date;
  const kg = assertPositiveKg(body.kg);
  await submitCollectorReport(db, collector, {
    date,
    kg,
    photoRef: body.photoRef,
  });
  return { collectorName: collector.name, date, kg };
}

export type BotIntakeOk =
  | { kind: "ask-kg" }
  | { kind: "need-number" }
  | { kind: "not-kg" }
  | { kind: "submitted"; collectorName: string; date: string; kg: number };

export async function intakeBotPhoto(
  db: PrismaClient,
  args: {
    platform: MiniAppPlatform;
    userId: string;
    photoRef: string;
    caption?: string;
    nowMs?: number;
  },
): Promise<BotIntakeOk> {
  requireActiveCollector(await findCollectorByPlatform(db, args.platform, args.userId));
  const kg = args.caption ? parseKgMessage(args.caption) : undefined;
  if (kg === undefined) {
    drafts.set(draftKey(args.platform, args.userId), {
      photoRef: args.photoRef,
      at: Date.now(),
    });
    return { kind: "ask-kg" };
  }
  clearDraft(args.platform, args.userId);
  const submitted = await submitTodayCollectorReport(
    db,
    args.platform,
    args.userId,
    { kg, photoRef: args.photoRef },
    args.nowMs,
  );
  return { kind: "submitted", ...submitted };
}

export async function intakeBotText(
  db: PrismaClient,
  args: {
    platform: MiniAppPlatform;
    userId: string;
    text: string;
    nowMs?: number;
  },
): Promise<BotIntakeOk> {
  const kg = parseKgMessage(args.text);
  const draft = getDraft(args.platform, args.userId);
  if (kg === undefined) {
    return draft ? { kind: "need-number" } : { kind: "not-kg" };
  }
  clearDraft(args.platform, args.userId);
  const submitted = await submitTodayCollectorReport(
    db,
    args.platform,
    args.userId,
    { kg, photoRef: draft?.photoRef },
    args.nowMs,
  );
  return { kind: "submitted", ...submitted };
}

export function botIntakeReply(result: BotIntakeOk): string | null {
  if (result.kind === "ask-kg") {
    return ASK_TOTAL_KG_TEXT;
  }
  if (result.kind === "need-number") {
    return NEED_NUMBER_KG_TEXT;
  }
  if (result.kind === "submitted") {
    return formatAcceptedReport(result.date, result.kg);
  }
  return null;
}

export function collectorSubmitErrorText(
  err: unknown,
  args: { id: string; idLabel: string },
): string {
  const message = err instanceof HttpError ? err.message : null;
  if (message === "Not a collector") {
    return `Тебя нет в списке участников. Покажи организатору свой ${args.idLabel}: ${args.id}`;
  }
  if (message === "Collector is inactive") {
    return "Ты скрыт в списке участников — напиши организатору.";
  }
  if (message === "Period not found" || message === "Period is closed") {
    return "Сейчас нет открытого периода — подожди организатора.";
  }
  if (message === "Date is outside the open period") {
    return "Сегодняшняя дата не входит в текущий период.";
  }
  if (message === "Date is in the future") {
    return "Нельзя внести за день, который ещё не наступил.";
  }
  if (message === "kg must be greater than 0") {
    return ASK_TOTAL_KG_TEXT;
  }
  if (message === "This day was already submitted by another collector") {
    const name =
      err instanceof HttpError &&
      typeof err.details?.collectorName === "string" &&
      err.details.collectorName.trim().length > 0
        ? err.details.collectorName.trim()
        : undefined;
    return name
      ? `За этот день уже внёс ${name}. Вторая сдача от другого участника не принимается.`
      : "За этот день уже внёс другой участник.";
  }
  if (message === "Entry is pending review" || message === "Entry already has kilograms") {
    return "За этот день уже есть сдача — она на проверке или уже принята.";
  }
  return "Не удалось принять. Попробуй ещё раз или открой приложение.";
}
