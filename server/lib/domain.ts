import type { Collector, Period, PrismaClient, Settings } from "@prisma/client";
import { assertDate, assertDayOfWeek, currentMoscowWeek, previousMoscowWeek } from "./dates";
import { HttpError } from "./errors";

export async function getOpenPeriod(db: PrismaClient, nowMs = Date.now()): Promise<Period | null> {
  await ensureCurrentWeekPeriod(db, nowMs);
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

export async function requireUnsettledPeriod(db: PrismaClient, periodId: string): Promise<Period> {
  const period = await requirePeriod(db, periodId);
  if (period.settledAt) {
    throw new HttpError("Period is already settled", 409);
  }
  return period;
}

export async function requireCollectorUnpaid(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
): Promise<Collector> {
  const collector = await requireCollector(db, collectorId);
  const payment = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId, collectorId } },
  });
  if (payment?.paidAt) {
    throw new HttpError("Collector already paid");
  }
  return collector;
}

export function assertDateInPeriod(date: string, startDate: string, endDate: string): string {
  const iso = assertDate(date);
  if (iso < startDate || iso > endDate) {
    throw new HttpError("Date is outside the period");
  }
  return iso;
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
  maxBotToken?: string | null;
  maxGroupChatId?: string | null;
  maxGroupChatTitle?: string | null;
  proxyType?: string | null;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
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
        maxBotToken: data.maxBotToken,
        maxGroupChatId: data.maxGroupChatId,
        maxGroupChatTitle: data.maxGroupChatTitle,
        proxyType: data.proxyType,
        proxyHost: data.proxyHost,
        proxyPort: data.proxyPort,
        proxyUsername: data.proxyUsername,
        proxyPassword: data.proxyPassword,
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
  return normalizeOptionalMessengerId(telegramUserId);
}

export function normalizeOptionalMessengerId(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
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

export type PeriodKind = "current" | "previous" | "past" | "future";

export function periodKind(
  period: { startDate: string; endDate: string },
  nowMs = Date.now(),
): PeriodKind {
  const current = currentMoscowWeek(nowMs);
  const previous = previousMoscowWeek(nowMs);
  if (period.startDate > current.endDate) {
    return "future";
  }
  if (period.endDate >= current.startDate && period.startDate <= current.endDate) {
    return "current";
  }
  if (period.endDate >= previous.startDate && period.startDate <= previous.endDate) {
    return "previous";
  }
  return "past";
}

export function isPeriodEditable(
  period: { startDate: string; endDate: string; settledAt: Date | null },
  nowMs = Date.now(),
): boolean {
  if (period.settledAt) {
    return false;
  }
  const kind = periodKind(period, nowMs);
  return kind === "current" || kind === "previous";
}

export async function requireEditablePeriod(
  db: PrismaClient,
  periodId: string,
  nowMs = Date.now(),
): Promise<Period> {
  const period = await requirePeriod(db, periodId);
  if (period.settledAt) {
    throw new HttpError("Period is already settled", 409);
  }
  const kind = periodKind(period, nowMs);
  if (kind === "future") {
    throw new HttpError("Cannot change a future period");
  }
  if (kind !== "current" && kind !== "previous") {
    throw new HttpError("Can only change the current and previous week");
  }
  return period;
}

export async function patchPeriod(
  db: PrismaClient,
  periodId: string,
  patch: {
    startDate?: string;
    endDate?: string;
    storeTotalRub?: number;
    rate?: number;
  },
  nowMs = Date.now(),
): Promise<Period> {
  const period = await requireEditablePeriod(db, periodId, nowMs);
  const startDate = patch.startDate ?? period.startDate;
  const endDate = patch.endDate ?? period.endDate;
  assertPeriodDates(startDate, endDate);

  const current = currentMoscowWeek(nowMs);
  if (endDate > current.endDate) {
    throw new HttpError("Cannot change a future period");
  }

  const nextKind = periodKind({ startDate, endDate }, nowMs);
  if (nextKind === "future") {
    throw new HttpError("Cannot change a future period");
  }
  if (nextKind !== "current" && nextKind !== "previous") {
    throw new HttpError("Can only change the current and previous week");
  }

  if (startDate !== period.startDate || endDate !== period.endDate) {
    if (startDate !== period.startDate) {
      const sameStart = await db.period.findUnique({ where: { startDate } });
      if (sameStart) {
        throw new HttpError("A period already starts on this date", 409);
      }
    }
    const overlap = await db.period.findFirst({
      where: {
        id: { not: period.id },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      throw new HttpError("Period dates overlap another week", 409);
    }
    const stray = await db.entry.findFirst({
      where: {
        periodId: period.id,
        OR: [{ date: { lt: startDate } }, { date: { gt: endDate } }],
      },
    });
    if (stray) {
      throw new HttpError("Period has entries outside the new dates");
    }
  }

  return await db.period.update({
    where: { id: period.id },
    data: {
      startDate,
      endDate,
      ...(patch.storeTotalRub !== undefined
        ? { storeTotalRub: assertStoreTotal(patch.storeTotalRub) }
        : {}),
      ...(patch.rate !== undefined ? { rate: assertRate(patch.rate) } : {}),
    },
  });
}

export { assertDate, assertDayOfWeek, currentMoscowWeek, previousMoscowWeek };

export const KG_RATE_RUB = 20;

export function entryPayeeId(entry: {
  collectorId: string;
  creditedByCollectorId: string | null;
}): string {
  return entry.creditedByCollectorId ?? entry.collectorId;
}
const DEFAULT_WEEK_STORE_TOTAL = 8000;

export async function requirePreviousWeekPeriod(
  db: PrismaClient,
  nowMs = Date.now(),
): Promise<Period> {
  const { startDate, endDate } = previousMoscowWeek(nowMs);
  const byStart = await db.period.findUnique({ where: { startDate } });
  if (byStart) {
    return byStart;
  }
  const covering = await db.period.findFirst({
    where: { startDate: { lte: startDate }, endDate: { gte: endDate } },
    orderBy: { startDate: "desc" },
  });
  if (covering) {
    return covering;
  }
  throw new HttpError("Previous period not found", 404);
}

export async function ensureCurrentWeekPeriod(
  db: PrismaClient,
  nowMs = Date.now(),
): Promise<Period> {
  const { startDate, endDate } = currentMoscowWeek(nowMs);
  const sameWeek = await db.period.findUnique({ where: { startDate } });
  if (sameWeek) {
    return sameWeek;
  }

  const open = await db.period.findFirst({ where: { status: "open" } });
  if (open) {
    if (open.startDate <= startDate && open.endDate >= endDate) {
      return open;
    }
    if (open.endDate >= startDate) {
      return open;
    }
    await db.period.update({ where: { id: open.id }, data: { status: "closed" } });
  }

  const last = await db.period.findFirst({ orderBy: { startDate: "desc" } });
  try {
    return await db.period.create({
      data: {
        startDate,
        endDate,
        storeTotalRub: last?.storeTotalRub ?? DEFAULT_WEEK_STORE_TOTAL,
        rate: KG_RATE_RUB,
        status: "open",
      },
    });
  } catch {
    const raced = await db.period.findUnique({ where: { startDate } });
    if (raced) {
      return raced;
    }
    throw new HttpError("Failed to open the current week", 500);
  }
}
