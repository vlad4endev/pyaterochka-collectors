import type { Collector, PrismaClient } from "@prisma/client";
import {
  clockInTimeZone,
  eachDateInclusive,
  STORE_TIME_ZONE,
  weekdayFromIso,
} from "./dates";
import {
  assertDate,
  assertPositiveKg,
  getOpenPeriod,
  getSettings,
  requireCollector,
  requireOpenPeriod,
} from "./domain";
import { HttpError } from "./errors";

export type MiniEntry = {
  _id: string;
  date: string;
  kg?: number;
  source: "invoice" | "manual";
  status: "pending" | "confirmed" | "rejected";
  creditedByName?: string;
  note?: string;
};

export type MiniHome = {
  telegram: { id: string; firstName: string };
  collector: {
    _id: string;
    name: string;
    dayOfWeek: number | null;
    active: boolean;
  } | null;
  period: {
    _id: string;
    startDate: string;
    endDate: string;
    rate: number;
    status: "open" | "closed";
  } | null;
  settings: {
    windowStart: number;
    windowEnd: number;
    bank: string;
    payTo: string;
    deadlineText: string;
  } | null;
  today: {
    date: string;
    weekday: number;
    hour: number;
    isMyDay: boolean;
    windowStatus: "not-today" | "before" | "open" | "after";
  };
  me: {
    kg: number;
    amountRub: number;
    paidAt: number | null;
    entries: MiniEntry[];
    gaps: Array<{ date: string }>;
  } | null;
  others: Array<{ _id: string; name: string }>;
};

export async function findCollectorByTelegram(
  db: PrismaClient,
  telegramUserId: string,
): Promise<Collector | null> {
  return await db.collector.findFirst({
    where: { telegramUserId },
  });
}

export function requireActiveCollector(collector: Collector | null): Collector {
  if (!collector) {
    throw new HttpError("Not a collector", 403);
  }
  if (!collector.active) {
    throw new HttpError("Collector is inactive", 403);
  }
  return collector;
}

function windowStatus(args: {
  isMyDay: boolean;
  hour: number;
  windowStart: number;
  windowEnd: number;
}): MiniHome["today"]["windowStatus"] {
  if (!args.isMyDay) {
    return "not-today";
  }
  if (args.hour < args.windowStart) {
    return "before";
  }
  if (args.hour >= args.windowEnd) {
    return "after";
  }
  return "open";
}

export async function getMiniHome(
  db: PrismaClient,
  telegram: { id: number; firstName: string },
  nowMs: number,
): Promise<MiniHome> {
  const telegramUserId = String(telegram.id);
  const collector = await findCollectorByTelegram(db, telegramUserId);
  const period = await getOpenPeriod(db);
  const settings = await getSettings(db);
  const clock = clockInTimeZone(STORE_TIME_ZONE, nowMs);
  const weekday = weekdayFromIso(clock.date);
  const isMyDay = Boolean(
    collector?.active && collector.dayOfWeek !== null && collector.dayOfWeek === weekday,
  );
  const today = {
    date: clock.date,
    weekday,
    hour: clock.hour,
    isMyDay,
    windowStatus: windowStatus({
      isMyDay,
      hour: clock.hour,
      windowStart: settings?.windowStart ?? 17,
      windowEnd: settings?.windowEnd ?? 21,
    }),
  };

  const others = collector
    ? (await db.collector.findMany({ where: { active: true }, take: 100, orderBy: { name: "asc" } }))
        .filter((row) => row.id !== collector.id)
        .map((row) => ({ _id: row.id, name: row.name }))
    : [];

  if (!collector || !period) {
    return {
      telegram: { id: telegramUserId, firstName: telegram.firstName },
      collector: collector
        ? {
            _id: collector.id,
            name: collector.name,
            dayOfWeek: collector.dayOfWeek,
            active: collector.active,
          }
        : null,
      period: period
        ? {
            _id: period.id,
            startDate: period.startDate,
            endDate: period.endDate,
            rate: period.rate,
            status: period.status,
          }
        : null,
      settings: settings
        ? {
            windowStart: settings.windowStart,
            windowEnd: settings.windowEnd,
            bank: settings.bank,
            payTo: settings.payTo,
            deadlineText: settings.deadlineText,
          }
        : null,
      today,
      me: null,
      others,
    };
  }

  const entries = await db.entry.findMany({
    where: { periodId: period.id, collectorId: collector.id },
    take: 200,
    orderBy: { date: "desc" },
  });
  let kg = 0;
  const itemRows: MiniEntry[] = [];
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.kg !== null) {
      kg += entry.kg;
    }
    const creditedBy = entry.creditedByCollectorId
      ? await db.collector.findUnique({ where: { id: entry.creditedByCollectorId } })
      : null;
    itemRows.push({
      _id: entry.id,
      date: entry.date,
      kg: entry.kg ?? undefined,
      source: entry.source,
      status: entry.status,
      creditedByName: creditedBy?.name,
      note: entry.note ?? undefined,
    });
  }

  const payment = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId: period.id, collectorId: collector.id } },
  });

  const gaps: Array<{ date: string }> = [];
  if (collector.active && collector.dayOfWeek !== null) {
    for (const date of eachDateInclusive(period.startDate, period.endDate)) {
      if (weekdayFromIso(date) !== collector.dayOfWeek) {
        continue;
      }
      const has = entries.some(
        (entry) =>
          entry.date === date && (entry.status === "confirmed" || entry.status === "pending"),
      );
      if (!has) {
        gaps.push({ date });
      }
    }
  }

  return {
    telegram: { id: telegramUserId, firstName: telegram.firstName },
    collector: {
      _id: collector.id,
      name: collector.name,
      dayOfWeek: collector.dayOfWeek,
      active: collector.active,
    },
    period: {
      _id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      rate: period.rate,
      status: period.status,
    },
    settings: settings
      ? {
          windowStart: settings.windowStart,
          windowEnd: settings.windowEnd,
          bank: settings.bank,
          payTo: settings.payTo,
          deadlineText: settings.deadlineText,
        }
      : null,
    today,
    me: {
      kg,
      amountRub: kg * period.rate,
      paidAt: payment?.paidAt?.getTime() ?? null,
      entries: itemRows,
      gaps,
    },
    others,
  };
}

function assertDateInPeriod(date: string, startDate: string, endDate: string): string {
  const iso = assertDate(date);
  if (iso < startDate || iso > endDate) {
    throw new HttpError("Date is outside the open period");
  }
  return iso;
}

export async function createCollectorManualEntry(
  db: PrismaClient,
  collector: Collector,
  body: { date: string; kg: number; note?: string },
): Promise<string> {
  const period = await getOpenPeriod(db);
  if (!period) {
    throw new HttpError("Period not found", 404);
  }
  await requireOpenPeriod(db, period.id);
  const date = assertDateInPeriod(body.date, period.startDate, period.endDate);
  const row = await db.entry.create({
    data: {
      periodId: period.id,
      collectorId: collector.id,
      date,
      kg: assertPositiveKg(body.kg),
      source: "manual",
      status: "pending",
      note: body.note?.trim() || undefined,
    },
  });
  return row.id;
}

export async function createCollectorCreditEntry(
  db: PrismaClient,
  collector: Collector,
  body: { collectorId: string; date: string; kg: number; note?: string },
): Promise<string> {
  if (body.collectorId === collector.id) {
    throw new HttpError("creditedByCollectorId must be a different collector");
  }
  const period = await getOpenPeriod(db);
  if (!period) {
    throw new HttpError("Period not found", 404);
  }
  await requireOpenPeriod(db, period.id);
  await requireCollector(db, body.collectorId);
  const date = assertDateInPeriod(body.date, period.startDate, period.endDate);
  const row = await db.entry.create({
    data: {
      periodId: period.id,
      collectorId: body.collectorId,
      creditedByCollectorId: collector.id,
      date,
      kg: assertPositiveKg(body.kg),
      source: "manual",
      status: "pending",
      note: body.note?.trim() || undefined,
    },
  });
  return row.id;
}

export async function createInvoiceFromPhoto(
  db: PrismaClient,
  telegramUserId: string,
  fileId: string,
  nowMs: number,
): Promise<{ collectorName: string; date: string }> {
  const collector = requireActiveCollector(await findCollectorByTelegram(db, telegramUserId));
  const period = await getOpenPeriod(db);
  if (!period) {
    throw new HttpError("Period not found", 404);
  }
  await requireOpenPeriod(db, period.id);
  const date = clockInTimeZone(STORE_TIME_ZONE, nowMs).date;
  assertDateInPeriod(date, period.startDate, period.endDate);
  await db.entry.create({
    data: {
      periodId: period.id,
      collectorId: collector.id,
      date,
      source: "invoice",
      status: "pending",
      telegramFileId: fileId,
    },
  });
  return { collectorName: collector.name, date };
}
