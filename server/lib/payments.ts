import type { PrismaClient } from "@prisma/client";
import { getDashboard } from "./dashboard";
import { KG_RATE_RUB, entryPayeeId, requireCollector, requirePeriod } from "./domain";
import { HttpError } from "./errors";

export type SettlementRow = {
  collectorId: string;
  collectorName: string;
  kg: number;
  amountRub: number;
  paidAt: number | null;
  paymentId: string | null;
  hasTelegram: boolean;
  hasMax: boolean;
};

export type MissingReport = {
  collectorId: string;
  collectorName: string;
  dates: string[];
};

export type SettlementMismatch = {
  collectedKg: number;
  collectedRub: number;
  storeKg: number;
  storeRub: number;
  diffKg: number;
  diffRub: number;
  missing: MissingReport[];
  pending: MissingReport[];
};

export type PeriodSettlement = {
  periodId: string;
  startDate: string;
  endDate: string;
  rate: number;
  settled: boolean;
  storeTotalRub: number;
  rows: SettlementRow[];
  totalKg: number;
  totalRub: number;
  missing: MissingReport[];
  pending: MissingReport[];
};

export async function getPeriodSettlement(
  db: PrismaClient,
  periodId: string,
): Promise<PeriodSettlement> {
  const period = await requirePeriod(db, periodId);
  const entries = await db.entry.findMany({
    where: { periodId, status: "confirmed" },
    take: 500,
  });
  const liveKgByCollector = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kg === null) {
      continue;
    }
    const payeeId = entryPayeeId(entry);
    liveKgByCollector.set(payeeId, (liveKgByCollector.get(payeeId) ?? 0) + entry.kg);
  }
  const payments = await db.payment.findMany({ where: { periodId }, take: 200 });
  const collectorIds = new Set<string>([
    ...liveKgByCollector.keys(),
    ...payments.map((payment) => payment.collectorId),
  ]);
  const collectors =
    collectorIds.size > 0
      ? await db.collector.findMany({ where: { id: { in: [...collectorIds] } }, take: 200 })
      : [];
  const collectorById = new Map(collectors.map((collector) => [collector.id, collector]));
  const paymentByCollector = new Map(payments.map((payment) => [payment.collectorId, payment]));
  const rows: SettlementRow[] = [];
  for (const collectorId of collectorIds) {
    const collector = collectorById.get(collectorId);
    const payment = paymentByCollector.get(collectorId);
    const liveKg = liveKgByCollector.get(collectorId) ?? 0;
    const frozen = Boolean(payment?.paidAt);
    const kg = frozen ? payment?.kg ?? liveKg : liveKg;
    if (kg <= 0 && !frozen) {
      continue;
    }
    rows.push({
      collectorId,
      collectorName: collector?.name ?? "Unknown",
      kg,
      amountRub: frozen ? (payment?.amountRub ?? kg * KG_RATE_RUB) : kg * KG_RATE_RUB,
      paidAt: payment?.paidAt?.getTime() ?? null,
      paymentId: payment?.id ?? null,
      hasTelegram: Boolean(collector?.telegramUserId),
      hasMax: Boolean(collector?.maxUserId),
    });
  }
  rows.sort((a, b) => a.collectorName.localeCompare(b.collectorName, "ru"));
  const totalKg = rows.reduce((sum, row) => sum + row.kg, 0);
  const totalRub = rows.reduce((sum, row) => sum + row.amountRub, 0);
  const { missing, pending } = period.settledAt
    ? { missing: [], pending: [] }
    : await listMissingAndPending(db, periodId);
  return {
    periodId: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    rate: KG_RATE_RUB,
    settled: Boolean(period.settledAt),
    storeTotalRub: period.storeTotalRub,
    rows,
    totalKg,
    totalRub,
    missing,
    pending,
  };
}

export async function syncUnpaidCollectorPayment(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
): Promise<void> {
  const existing = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId, collectorId } },
  });
  if (!existing || existing.paidAt) {
    return;
  }
  const kg = await sumConfirmedKgForPayee(db, periodId, collectorId);
  await db.payment.update({
    where: { id: existing.id },
    data: { kg, amountRub: kg * KG_RATE_RUB },
  });
}

export async function sumConfirmedKgForPayee(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
): Promise<number> {
  const entries = await db.entry.findMany({
    where: {
      periodId,
      status: "confirmed",
      OR: [{ collectorId, creditedByCollectorId: null }, { creditedByCollectorId: collectorId }],
    },
    take: 500,
  });
  let kg = 0;
  for (const entry of entries) {
    if (entry.kg !== null) {
      kg += entry.kg;
    }
  }
  return kg;
}

async function listMissingAndPending(
  db: PrismaClient,
  periodId: string,
): Promise<{ missing: MissingReport[]; pending: MissingReport[] }> {
  const dashboard = await getDashboard(db, periodId);
  const missingMap = new Map<string, MissingReport>();
  for (const gap of dashboard.gaps) {
    const current = missingMap.get(gap.collectorId);
    if (current) {
      current.dates.push(gap.date);
    } else {
      missingMap.set(gap.collectorId, {
        collectorId: gap.collectorId,
        collectorName: gap.collectorName,
        dates: [gap.date],
      });
    }
  }
  const pendingEntries = await db.entry.findMany({
    where: { periodId, status: "pending" },
    take: 200,
  });
  const pendingCollectorIds = [...new Set(pendingEntries.map((entry) => entry.collectorId))];
  const pendingCollectors =
    pendingCollectorIds.length > 0
      ? await db.collector.findMany({
          where: { id: { in: pendingCollectorIds } },
          take: 200,
        })
      : [];
  const pendingNameById = new Map(pendingCollectors.map((row) => [row.id, row.name]));
  const pendingMap = new Map<string, MissingReport>();
  for (const entry of pendingEntries) {
    const current = pendingMap.get(entry.collectorId);
    if (current) {
      if (!current.dates.includes(entry.date)) {
        current.dates.push(entry.date);
      }
      continue;
    }
    pendingMap.set(entry.collectorId, {
      collectorId: entry.collectorId,
      collectorName: pendingNameById.get(entry.collectorId) ?? "Unknown",
      dates: [entry.date],
    });
  }
  const byName = (left: MissingReport, right: MissingReport) =>
    left.collectorName.localeCompare(right.collectorName, "ru");
  return {
    missing: [...missingMap.values()].sort(byName),
    pending: [...pendingMap.values()].sort(byName),
  };
}

async function throwSettlementMismatch(
  db: PrismaClient,
  periodId: string,
  settlement: PeriodSettlement,
  store: { kg: number; totalRub: number },
): Promise<never> {
  const { missing, pending } = await listMissingAndPending(db, periodId);
  const mismatch: SettlementMismatch = {
    collectedKg: settlement.totalKg,
    collectedRub: settlement.totalRub,
    storeKg: store.kg,
    storeRub: store.totalRub,
    diffKg: store.kg - settlement.totalKg,
    diffRub: store.totalRub - settlement.totalRub,
    missing,
    pending,
  };
  throw new HttpError("Settlement does not match store invoice", 409, { mismatch });
}

function kgLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sameKg(left: number, right: number): boolean {
  return Math.round(left * 10) === Math.round(right * 10);
}

function sameRub(left: number, right: number): boolean {
  return Math.round(left) === Math.round(right);
}

export async function createPeriodSettlement(
  db: PrismaClient,
  periodId: string,
  store: { kg: number; totalRub: number },
): Promise<PeriodSettlement> {
  const period = await requirePeriod(db, periodId);
  if (period.settledAt) {
    throw new HttpError("Previous period is already settled", 409);
  }
  if (!Number.isFinite(store.kg) || store.kg <= 0) {
    throw new HttpError("kg must be greater than 0");
  }
  if (!Number.isFinite(store.totalRub) || store.totalRub <= 0) {
    throw new HttpError("storeTotalRub must be greater than 0");
  }
  const expectedRub = store.kg * KG_RATE_RUB;
  if (!sameRub(expectedRub, store.totalRub)) {
    throw new HttpError(
      `Store invoice mismatch: ${kgLabel(store.kg)} kg × ${KG_RATE_RUB} = ${Math.round(expectedRub)}, got ${Math.round(store.totalRub)}`,
      409,
    );
  }
  const settlement = await getPeriodSettlement(db, periodId);
  if (settlement.rows.length === 0) {
    await throwSettlementMismatch(db, periodId, settlement, store);
  }
  if (!sameKg(settlement.totalKg, store.kg) || !sameRub(settlement.totalRub, store.totalRub)) {
    await throwSettlementMismatch(db, periodId, settlement, store);
  }
  await db.period.update({
    where: { id: periodId },
    data: { storeTotalRub: store.totalRub, rate: KG_RATE_RUB },
  });
  const unpaid = settlement.rows.filter((row) => !row.paidAt);
  if (unpaid.length === 0) {
    await settlePeriodIfFullyPaid(db, periodId);
    return await getPeriodSettlement(db, periodId);
  }
  await db.$transaction(
    unpaid.map((row) =>
      db.payment.upsert({
        where: { periodId_collectorId: { periodId, collectorId: row.collectorId } },
        update: { kg: row.kg, amountRub: row.amountRub },
        create: {
          periodId,
          collectorId: row.collectorId,
          kg: row.kg,
          amountRub: row.amountRub,
        },
      }),
    ),
  );
  return await getPeriodSettlement(db, periodId);
}

export async function markCollectorPaid(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
): Promise<{ settlement: PeriodSettlement; periodClosed: boolean }> {
  const period = await requirePeriod(db, periodId);
  if (period.settledAt) {
    throw new HttpError("Previous period is already settled", 409);
  }
  await requireCollector(db, collectorId);
  const existing = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId, collectorId } },
  });
  if (existing?.paidAt) {
    throw new HttpError("Collector already paid");
  }
  const kg = await sumConfirmedKgForPayee(db, periodId, collectorId);
  const amountRub = kg * KG_RATE_RUB;
  if (kg <= 0) {
    throw new HttpError("Collector has no confirmed kg in this period");
  }
  await db.payment.upsert({
    where: { periodId_collectorId: { periodId, collectorId } },
    update: { kg, amountRub, paidAt: new Date() },
    create: { periodId, collectorId, kg, amountRub, paidAt: new Date() },
  });
  const periodClosed = await settlePeriodIfFullyPaid(db, periodId);
  return { settlement: await getPeriodSettlement(db, periodId), periodClosed };
}

export async function settlePeriodIfFullyPaid(
  db: PrismaClient,
  periodId: string,
): Promise<boolean> {
  const settlement = await getPeriodSettlement(db, periodId);
  if (settlement.rows.length === 0 || settlement.rows.some((row) => !row.paidAt)) {
    return false;
  }
  await db.period.update({
    where: { id: periodId },
    data: { settledAt: new Date(), status: "closed" },
  });
  return true;
}
