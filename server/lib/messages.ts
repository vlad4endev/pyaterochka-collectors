import type { PrismaClient } from "@prisma/client";
import { requirePeriod, requireSettings } from "./domain";

function fmtShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

export async function buildSummary(db: PrismaClient, periodId: string) {
  const period = await requirePeriod(db, periodId);
  const settings = await requireSettings(db);
  const entries = await db.entry.findMany({
    where: { periodId, status: "confirmed" },
    take: 500,
  });
  const totals = new Map<string, { name: string; kg: number }>();
  for (const entry of entries) {
    if (entry.kg === null) {
      continue;
    }
    const current = totals.get(entry.collectorId);
    if (current) {
      current.kg += entry.kg;
    } else {
      const collector = await db.collector.findUnique({ where: { id: entry.collectorId } });
      totals.set(entry.collectorId, {
        name: collector?.name ?? "Unknown",
        kg: entry.kg,
      });
    }
  }
  const rows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const totalKg = rows.reduce((sum, row) => sum + row.kg, 0);
  const totalRub = totalKg * period.rate;
  const lines = [
    "⚠️ ПОДСЧИТАНО ЗА 2 НЕДЕЛИ",
    "",
    `💳 Оплата с ${fmtShort(period.startDate)} по ${fmtShort(period.endDate)}. ${totalRub} руб. = общий вес: ${totalKg} кг`,
    "",
  ];
  for (const row of rows) {
    lines.push(`▫️ ${row.name} - ${row.kg}*${period.rate} = ${row.kg * period.rate} руб`);
  }
  lines.push(
    "",
    `Переводить мне на карту ${settings.bank}🏦 (${settings.payTo}) ${settings.deadlineText}`,
    "ОГРОМНАЯ ПРОСЬБА ПЕРЕЧИСЛИТЬ ВСЕ ВОВРЕМЯ И ОТМЕТЬТЕ ТЕ КТО ПЕРЕВЕЛ ТУТ В ЧАТЕ",
  );
  return { text: lines.join("\n"), totalKg, totalRub };
}
