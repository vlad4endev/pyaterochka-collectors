import type { Collector, Period, PrismaClient } from "@prisma/client";
import {
  clockInTimeZone,
  eachDateInclusive,
  STORE_TIME_ZONE,
  weekdayFromIso,
} from "./dates";
import {
  assertDate,
  assertDateInPeriod as requireDateInPeriod,
  assertPositiveKg,
  getOpenPeriod,
  getSettings,
  isPeriodEditable,
  parseKgInput,
  requireCollector,
  requireCollectorUnpaid,
  requireUnsettledPeriod,
  entryPayeeId,
} from "./domain";
import { HttpError } from "./errors";
import { syncUnpaidCollectorPayment } from "./payments";

export type MiniEntry = {
  _id: string;
  date: string;
  kg?: number;
  source: "invoice" | "manual";
  status: "pending" | "confirmed" | "rejected" | "skipped";
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
  takenBy: MiniPerson | null;
};

export type MiniAppPlatform = "telegram" | "max";

export type MiniHome = {
  platform: MiniAppPlatform;
  user: { id: string; firstName: string };
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

export async function findCollectorByMax(
  db: PrismaClient,
  maxUserId: string,
): Promise<Collector | null> {
  return await db.collector.findFirst({
    where: { maxUserId },
  });
}

export async function findCollectorByPlatform(
  db: PrismaClient,
  platform: MiniAppPlatform,
  userId: string,
): Promise<Collector | null> {
  return platform === "max"
    ? await findCollectorByMax(db, userId)
    : await findCollectorByTelegram(db, userId);
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

export async function assertDateFreeForSubmitter(
  db: Pick<PrismaClient, "entry" | "collector">,
  periodId: string,
  date: string,
  submitterId: string,
  excludeEntryId?: string,
): Promise<void> {
  const existing = await db.entry.findMany({
    where: {
      periodId,
      date,
      status: { in: ["pending", "confirmed"] },
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
    take: 50,
  });
  const other = existing.find((entry) => entryPayeeId(entry) !== submitterId);
  if (!other) {
    return;
  }
  const who = await db.collector.findUnique({ where: { id: entryPayeeId(other) } });
  throw new HttpError("This day was already submitted by another collector", 409, {
    collectorName: who?.name,
  });
}

export async function getMiniHome(
  db: PrismaClient,
  account: { id: string; firstName: string; platform: MiniAppPlatform },
  nowMs: number,
): Promise<MiniHome> {
  const userId = account.id;
  const collector = await findCollectorByPlatform(db, account.platform, userId);
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
  const byId = new Map(collectors.map((row) => [row.id, row]));
  const editablePeriods = await listEditablePeriods(db, nowMs);
  const occupied = editablePeriods.length
    ? await db.entry.findMany({
        where: {
          periodId: { in: editablePeriods.map((row) => row.id) },
          status: { in: ["pending", "confirmed"] },
        },
        take: 400,
      })
    : [];
  const takenById = new Map<string, string>();
  for (const entry of occupied) {
    if (!takenById.has(entry.date)) {
      takenById.set(entry.date, entryPayeeId(entry));
    }
  }
  const active = collectors.filter((row) => row.active);
  const others = collector
    ? active.filter((row) => row.id !== collector.id).map(toPerson)
    : [];
  const openDates = [
    ...new Set(
      editablePeriods.flatMap((row) =>
        eachDateInclusive(row.startDate, row.endDate).filter((date) => date <= clock.date),
      ),
    ),
  ].sort((a, b) => (a < b ? 1 : -1));
  const days: MiniDay[] = openDates.map((date) => {
    const dayWeekday = weekdayFromIso(date);
    const takenId = takenById.get(date);
    const taken = takenId ? byId.get(takenId) : undefined;
    return {
      date,
      weekday: dayWeekday,
      scheduled: active
        .filter((row) => row.dayOfWeek === dayWeekday)
        .map(toPerson),
      takenBy: taken ? toPerson(taken) : null,
    };
  });

  const identity = { id: userId, firstName: account.firstName };
  const base = {
    platform: account.platform,
    user: identity,
    telegram: identity,
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
    days,
    others,
  };

  if (!collector || !period) {
    return { ...base, me: null };
  }

  const entries = await db.entry.findMany({
    where: {
      periodId: { in: editablePeriods.map((row) => row.id) },
      OR: [{ collectorId: collector.id }, { creditedByCollectorId: collector.id }],
    },
    take: 400,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  let kg = 0;
  const itemRows: MiniEntry[] = [];
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.kg !== null) {
      const payeeId = entryPayeeId(entry);
      if (payeeId === collector.id && entry.periodId === period.id) {
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
    for (const date of openDates) {
      if (weekdayFromIso(date) !== collector.dayOfWeek) {
        continue;
      }
      const has = myEntries.some(
        (entry) =>
          entry.date === date &&
          (entry.status === "confirmed" ||
            entry.status === "pending" ||
            entry.status === "skipped"),
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
      amountRub: kg * (period?.rate ?? 0),
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

async function listEditablePeriods(
  db: PrismaClient,
  nowMs: number,
): Promise<Period[]> {
  const rows = await db.period.findMany({
    where: { settledAt: null },
    orderBy: { startDate: "asc" },
  });
  return rows.filter((period) => isPeriodEditable(period, nowMs));
}

async function periodForCollectorDate(
  db: PrismaClient,
  dateRaw: string,
  nowMs = Date.now(),
): Promise<{ period: Period; date: string }> {
  const today = clockInTimeZone(STORE_TIME_ZONE, nowMs).date;
  const date = assertDate(dateRaw);
  if (date > today) {
    throw new HttpError("Date is in the future");
  }
  const period = await db.period.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: "desc" },
  });
  if (!period || period.settledAt || !isPeriodEditable(period, nowMs)) {
    throw new HttpError("Date is outside the open period");
  }
  return { period, date };
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
  const { period, date } = await periodForCollectorDate(db, body.date);
  const parsedKg = parseKgInput(body.kg);
  if (parsedKg === undefined) {
    throw new HttpError("kg must be greater than 0");
  }
  const kg = assertPositiveKg(parsedKg);

  const forCollectorId = body.forCollectorId?.trim() || undefined;
  if (forCollectorId && forCollectorId !== collector.id) {
    const target = await requireCollector(db, forCollectorId);
    if (target.dayOfWeek !== weekdayFromIso(date)) {
      throw new HttpError("Collector is not scheduled on this date");
    }
  }
  const targetId = forCollectorId && forCollectorId !== collector.id ? forCollectorId : collector.id;
  const creditedByCollectorId = targetId === collector.id ? undefined : collector.id;

  const row = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Period" WHERE id = ${period.id} FOR UPDATE`;
    await assertDateFreeForSubmitter(tx, period.id, date, collector.id);
    return await tx.entry.create({
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
  });
  return row.id;
}

export async function skipCollectorDay(
  db: PrismaClient,
  period: Period,
  collector: Collector,
  dateRaw: string,
): Promise<string> {
  const today = clockInTimeZone(STORE_TIME_ZONE, Date.now()).date;
  const date = assertDateOpenForSubmit(dateRaw, period.startDate, period.endDate, today);
  if (collector.dayOfWeek !== weekdayFromIso(date)) {
    throw new HttpError("Collector is not scheduled on this date");
  }
  const existing = await db.entry.findMany({
    where: { periodId: period.id, collectorId: collector.id, date },
    take: 20,
  });
  const skipped = existing.find((entry) => entry.status === "skipped");
  if (skipped) {
    return skipped.id;
  }
  if (existing.some((entry) => entry.status === "pending")) {
    throw new HttpError("Entry is pending review");
  }
  if (existing.some((entry) => entry.status === "confirmed")) {
    throw new HttpError("Entry already has kilograms");
  }
  const row = await db.entry.create({
    data: {
      periodId: period.id,
      collectorId: collector.id,
      date,
      source: "manual",
      status: "skipped",
      note: "Не брал",
    },
  });
  return row.id;
}

export async function skipOwnScheduledDay(
  db: PrismaClient,
  collector: Collector,
  date: string,
): Promise<string> {
  const { period } = await periodForCollectorDate(db, date);
  return await skipCollectorDay(db, period, collector, date);
}

export async function skipCollectorDayInPeriod(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
  date: string,
): Promise<string> {
  const period = await requireUnsettledPeriod(db, periodId);
  const collector = await requireCollector(db, collectorId);
  return await skipCollectorDay(db, period, collector, date);
}

export async function updatePeriodEntry(
  db: PrismaClient,
  entryId: string,
  patch: {
    collectorId?: string;
    creditedByCollectorId?: string | null;
    date?: string;
    kg?: number;
    note?: string | null;
  },
): Promise<void> {
  const entry = await db.entry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new HttpError("Entry not found", 404);
  }
  if (entry.status !== "confirmed" && entry.status !== "skipped") {
    throw new HttpError("Entry cannot be edited");
  }
  const period = await requireUnsettledPeriod(db, entry.periodId);
  const oldPayeeId = entryPayeeId(entry);
  if (entry.status === "confirmed") {
    await requireCollectorUnpaid(db, entry.periodId, oldPayeeId);
  }

  const collectorId = patch.collectorId ?? entry.collectorId;
  await requireCollector(db, collectorId);

  let creditedByCollectorId =
    patch.creditedByCollectorId === undefined
      ? entry.creditedByCollectorId
      : patch.creditedByCollectorId;
  if (creditedByCollectorId === collectorId) {
    creditedByCollectorId = null;
  }
  if (creditedByCollectorId) {
    await requireCollector(db, creditedByCollectorId);
  }

  const date = requireDateInPeriod(patch.date ?? entry.date, period.startDate, period.endDate);
  const nextPayeeId = creditedByCollectorId ?? collectorId;
  if (nextPayeeId !== oldPayeeId) {
    await requireCollectorUnpaid(db, entry.periodId, nextPayeeId);
  }

  let kg = entry.kg;
  let status = entry.status;
  let confirmedAt = entry.confirmedAt;
  if (patch.kg !== undefined) {
    const parsed = parseKgInput(patch.kg);
    if (parsed === undefined) {
      throw new HttpError("kg must be greater than 0");
    }
    kg = assertPositiveKg(parsed);
    status = "confirmed";
    if (entry.status === "skipped") {
      confirmedAt = new Date();
    }
  } else if (entry.status === "confirmed" && (entry.kg === null || entry.kg <= 0)) {
    throw new HttpError("kg must be greater than 0");
  }

  if (status === "confirmed") {
    await assertDateFreeForSubmitter(db, period.id, date, nextPayeeId, entry.id);
  }

  const note =
    patch.note === undefined
      ? entry.note
      : patch.note === null || patch.note.trim().length === 0
        ? null
        : patch.note.trim();

  await db.entry.update({
    where: { id: entry.id },
    data: {
      collectorId,
      creditedByCollectorId,
      date,
      kg,
      status,
      confirmedAt,
      note,
    },
  });

  if (oldPayeeId !== nextPayeeId || entry.status === "confirmed" || status === "confirmed") {
    await syncUnpaidCollectorPayment(db, period.id, oldPayeeId);
    if (nextPayeeId !== oldPayeeId) {
      await syncUnpaidCollectorPayment(db, period.id, nextPayeeId);
    }
  }
}

export async function deletePeriodEntry(db: PrismaClient, entryId: string): Promise<void> {
  const entry = await db.entry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new HttpError("Entry not found", 404);
  }
  if (entry.status !== "confirmed" && entry.status !== "skipped") {
    throw new HttpError("Entry cannot be edited");
  }
  await requireUnsettledPeriod(db, entry.periodId);
  const payeeId = entryPayeeId(entry);
  if (entry.status === "confirmed") {
    await requireCollectorUnpaid(db, entry.periodId, payeeId);
  }
  await db.entry.delete({ where: { id: entry.id } });
  if (entry.status === "confirmed") {
    await syncUnpaidCollectorPayment(db, entry.periodId, payeeId);
  }
}
