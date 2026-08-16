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
  KG_RATE_RUB,
  entryPayeeId,
} from "./domain";
import { HttpError } from "./errors";

export type MiniEntry = {
  _id: string;
  date: string;
  kg?: number;
  source: "invoice" | "manual";
  status: "pending" | "confirmed" | "rejected";
  creditedByName?: string;
  creditedForName?: string;
  hasPhoto: boolean;
  note?: string;
};

export type MiniPerson = {
  _id: string;
  name: string;
  dayOfWeek: number | null;
};

export type MiniDay = {
  date: string;
  weekday: number;
  scheduled: MiniPerson[];
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
  days: MiniDay[];
  me: {
    kg: number;
    amountRub: number;
    paidAt: number | null;
    entries: MiniEntry[];
    gaps: Array<{ date: string }>;
  } | null;
  others: MiniPerson[];
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

function toPerson(row: Collector): MiniPerson {
  return { _id: row.id, name: row.name, dayOfWeek: row.dayOfWeek };
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

  const collectors = await db.collector.findMany({
    take: 100,
    orderBy: { name: "asc" },
  });
  const active = collectors.filter((row) => row.active);
  const others = collector
    ? active.filter((row) => row.id !== collector.id).map(toPerson)
    : [];
  const days: MiniDay[] = period
    ? eachDateInclusive(period.startDate, period.endDate)
        .filter((date) => date <= clock.date)
        .map((date) => {
          const dayWeekday = weekdayFromIso(date);
          return {
            date,
            weekday: dayWeekday,
            scheduled: active
              .filter((row) => row.dayOfWeek === dayWeekday)
              .map(toPerson),
          };
        })
        .reverse()
    : [];

  const base = {
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
          rate: KG_RATE_RUB,
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
    days,
    others,
  };

  if (!collector || !period) {
    return { ...base, me: null };
  }

  const entries = await db.entry.findMany({
    where: {
      periodId: period.id,
      OR: [{ collectorId: collector.id }, { creditedByCollectorId: collector.id }],
    },
    take: 200,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const byId = new Map(collectors.map((row) => [row.id, row]));
  let kg = 0;
  const itemRows: MiniEntry[] = [];
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.kg !== null) {
      const payeeId = entryPayeeId(entry);
      if (payeeId === collector.id) {
        kg += entry.kg;
      }
    }
    const creditedBy = entry.creditedByCollectorId
      ? byId.get(entry.creditedByCollectorId)
      : undefined;
    const creditedFor =
      entry.creditedByCollectorId === collector.id && entry.collectorId !== collector.id
        ? byId.get(entry.collectorId)
        : undefined;
    itemRows.push({
      _id: entry.id,
      date: entry.date,
      kg: entry.kg ?? undefined,
      source: entry.source,
      status: entry.status,
      creditedByName:
        entry.collectorId === collector.id ? creditedBy?.name : undefined,
      creditedForName: creditedFor?.name,
      hasPhoto: Boolean(entry.telegramFileId),
      note: entry.note ?? undefined,
    });
  }

  const payment = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId: period.id, collectorId: collector.id } },
  });

  const myEntries = entries.filter((entry) => entry.collectorId === collector.id);
  const gaps: Array<{ date: string }> = [];
  if (collector.active && collector.dayOfWeek !== null) {
    for (const date of eachDateInclusive(period.startDate, period.endDate)) {
      if (date > clock.date) {
        continue;
      }
      if (weekdayFromIso(date) !== collector.dayOfWeek) {
        continue;
      }
      const has = myEntries.some(
        (entry) =>
          entry.date === date && (entry.status === "confirmed" || entry.status === "pending"),
      );
      if (!has) {
        gaps.push({ date });
      }
    }
  }

  return {
    ...base,
    me: {
      kg,
      amountRub: kg * KG_RATE_RUB,
      paidAt: payment?.paidAt?.getTime() ?? null,
      entries: itemRows,
      gaps,
    },
  };
}

function assertDateInPeriod(date: string, startDate: string, endDate: string): string {
  const iso = assertDate(date);
  if (iso < startDate || iso > endDate) {
    throw new HttpError("Date is outside the open period");
  }
  return iso;
}

function assertDateOpenForSubmit(
  date: string,
  startDate: string,
  endDate: string,
  today: string,
): string {
  const iso = assertDateInPeriod(date, startDate, endDate);
  if (iso > today) {
    throw new HttpError("Date is in the future");
  }
  return iso;
}

export async function createCollectorManualEntry(
  db: PrismaClient,
  collector: Collector,
  body: { date: string; kg: number; note?: string },
): Promise<string> {
  return await submitCollectorReport(db, collector, {
    date: body.date,
    kg: body.kg,
    note: body.note,
  });
}

export async function createCollectorCreditEntry(
  db: PrismaClient,
  collector: Collector,
  body: { collectorId: string; date: string; kg: number; note?: string },
): Promise<string> {
  return await submitCollectorReport(db, collector, {
    date: body.date,
    kg: body.kg,
    note: body.note,
    forCollectorId: body.collectorId,
  });
}

export async function submitCollectorReport(
  db: PrismaClient,
  collector: Collector,
  body: {
    date: string;
    kg?: number;
    note?: string;
    forCollectorId?: string;
    photoRef?: string;
  },
): Promise<string> {
  const period = await getOpenPeriod(db);
  if (!period) {
    throw new HttpError("Period not found", 404);
  }
  await requireOpenPeriod(db, period.id);
  const today = clockInTimeZone(STORE_TIME_ZONE, Date.now()).date;
  const date = assertDateOpenForSubmit(body.date, period.startDate, period.endDate, today);
  const kgRaw = body.kg;
  const kg =
    kgRaw === undefined || kgRaw === null || Number.isNaN(kgRaw) || kgRaw <= 0
      ? undefined
      : assertPositiveKg(kgRaw);
  if (!kg && !body.photoRef) {
    throw new HttpError("Add kilograms or a photo");
  }

  const forCollectorId = body.forCollectorId?.trim() || undefined;
  if (forCollectorId && forCollectorId !== collector.id) {
    const target = await requireCollector(db, forCollectorId);
    if (target.dayOfWeek !== weekdayFromIso(date)) {
      throw new HttpError("Collector is not scheduled on this date");
    }
  }
  const targetId = forCollectorId && forCollectorId !== collector.id ? forCollectorId : collector.id;
  const creditedByCollectorId = targetId === collector.id ? undefined : collector.id;

  const row = await db.entry.create({
    data: {
      periodId: period.id,
      collectorId: targetId,
      creditedByCollectorId,
      date,
      kg,
      source: body.photoRef ? "invoice" : "manual",
      status: "pending",
      telegramFileId: body.photoRef,
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
