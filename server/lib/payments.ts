import type { PrismaClient } from "@prisma/client";
import { requirePeriod } from "./domain";
import { HttpError } from "./errors";

export type SettlementRow = {
  collectorId: string;
  collectorName: string;
  kg: number;
  amountRub: number;
  paidAt: number | null;
  paymentId: string | null;
  hasTelegram: boolean;
};

export type PeriodSettlement = {
  periodId: string;
  startDate: string;
  endDate: string;
  rate: number;
  rows: SettlementRow[];
  totalKg: number;
  totalRub: number;
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
  const kgByCollector = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kg === null) {
      continue;
    }
    kgByCollector.set(entry.collectorId, (kgByCollector.get(entry.collectorId) ?? 0) + entry.kg);
  }
  const collectorIds = [...kgByCollector.keys()];
  const [collectors, payments] = await Promise.all([
    collectorIds.length > 0
      ? db.collector.findMany({ where: { id: { in: collectorIds } }, take: 200 })
      : Promise.resolve([]),
    db.payment.findMany({ where: { periodId }, take: 200 }),
  ]);
  const collectorById = new Map(collectors.map((collector) => [collector.id, collector]));
  const paymentByCollector = new Map(payments.map((payment) => [payment.collectorId, payment]));
  const rows: SettlementRow[] = [];
  for (const [collectorId, kg] of kgByCollector) {
    const collector = collectorById.get(collectorId);
    const payment = paymentByCollector.get(collectorId);
    rows.push({
      collectorId,
      collectorName: collector?.name ?? "Unknown",
      kg,
      amountRub: kg * period.rate,
      paidAt: payment?.paidAt?.getTime() ?? null,
      paymentId: payment?.id ?? null,
      hasTelegram: Boolean(collector?.telegramUserId),
    });
  }
  rows.sort((a, b) => a.collectorName.localeCompare(b.collectorName, "ru"));
  const totalKg = rows.reduce((sum, row) => sum + row.kg, 0);
  return {
    periodId: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    rate: period.rate,
    rows,
    totalKg,
    totalRub: totalKg * period.rate,
  };
}

export async function createPeriodSettlement(
  db: PrismaClient,
  periodId: string,
): Promise<PeriodSettlement> {
  const settlement = await getPeriodSettlement(db, periodId);
  if (settlement.rows.length === 0) {
    throw new HttpError("No confirmed kilograms in this period");
  }
  await db.$transaction(
    settlement.rows.map((row) =>
      db.payment.upsert({
        where: { periodId_collectorId: { periodId, collectorId: row.collectorId } },
        update: { amountRub: row.amountRub },
        create: {
          periodId,
          collectorId: row.collectorId,
          amountRub: row.amountRub,
        },
      }),
    ),
  );
  return await getPeriodSettlement(db, periodId);
}
