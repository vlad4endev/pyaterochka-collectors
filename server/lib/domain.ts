import type { Collector, Period, PrismaClient, Settings } from "@prisma/client";
import { assertDate, assertDayOfWeek } from "./dates";
import { HttpError } from "./errors";

export async function getOpenPeriod(db: PrismaClient): Promise<Period | null> {
  return await db.period.findFirst({ where: { status: "open" } });
}

export async function requirePeriod(db: PrismaClient, periodId: string): Promise<Period> {
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period) {
    throw new HttpError("Period not found", 404);
  }
  return period;
}

export async function requireOpenPeriod(db: PrismaClient, periodId: string): Promise<Period> {
  const period = await requirePeriod(db, periodId);
  if (period.status !== "open") {
    throw new HttpError("Period is closed");
  }
  return period;
}

export async function requireCollector(
  db: PrismaClient,
  collectorId: string,
): Promise<Collector> {
  const collector = await db.collector.findUnique({ where: { id: collectorId } });
  if (!collector) {
    throw new HttpError("Collector not found", 404);
  }
  return collector;
}

export async function getSettings(db: PrismaClient): Promise<Settings | null> {
  return await db.settings.findUnique({ where: { key: "default" } });
}

export async function requireSettings(db: PrismaClient): Promise<Settings> {
  const settings = await getSettings(db);
  if (!settings) {
    throw new HttpError("Settings not found", 404);
  }
  return settings;
}

type SettingsPatch = {
  bank?: string;
  payTo?: string;
  deadlineText?: string;
  windowStart?: number;
  windowEnd?: number;
  botToken?: string | null;
  miniAppUrl?: string | null;
  groupChatId?: string | null;
  groupChatTitle?: string | null;
};

export async function patchDefaultSettings(
  db: PrismaClient,
  data: SettingsPatch,
): Promise<Settings> {
  const existing = await getSettings(db);
  if (!existing) {
    return await db.settings.create({
      data: {
        key: "default",
        bank: data.bank ?? "—",
        payTo: data.payTo ?? "—",
        deadlineText: data.deadlineText ?? "—",
        windowStart: data.windowStart ?? 17,
        windowEnd: data.windowEnd ?? 21,
        botToken: data.botToken,
        miniAppUrl: data.miniAppUrl,
        groupChatId: data.groupChatId,
        groupChatTitle: data.groupChatTitle,
      },
    });
  }
  return await db.settings.update({
    where: { key: "default" },
    data,
  });
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1) {
    throw new HttpError("Name is required");
  }
  if (trimmed.length > 80) {
    throw new HttpError("Name must be at most 80 characters");
  }
  return trimmed;
}

export function normalizeOptionalTelegram(
  telegramUserId: string | undefined,
): string | undefined {
  if (telegramUserId === undefined) {
    return undefined;
  }
  const trimmed = telegramUserId.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function assertPositiveKg(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new HttpError("kg must be greater than 0");
  }
  return kg;
}

export function assertRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new HttpError("rate must be greater than 0");
  }
  return rate;
}

export function assertStoreTotal(storeTotalRub: number): number {
  if (!Number.isFinite(storeTotalRub) || storeTotalRub < 0) {
    throw new HttpError("storeTotalRub must be 0 or greater");
  }
  return storeTotalRub;
}

export function assertWindowHour(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new HttpError(`${label} must be an hour 0-23`);
  }
  return value;
}

export function assertPeriodDates(startDate: string, endDate: string): void {
  assertDate(startDate);
  assertDate(endDate);
  if (startDate > endDate) {
    throw new HttpError("startDate must be on or before endDate");
  }
}

export { assertDate, assertDayOfWeek };
