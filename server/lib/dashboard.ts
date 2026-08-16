import type { PrismaClient } from "@prisma/client";
import { eachDateInclusive, weekdayFromIso } from "./dates";
import { requirePeriod } from "./domain";

export async function getDashboard(db: PrismaClient, periodId: string) {
  const period = await requirePeriod(db, periodId);
  const collectors = await db.collector.findMany({ take: 100 });
  const entries = await db.entry.findMany({
    where: { periodId },
    take: 500,
  });

  let confirmedKg = 0;
  let pendingCount = 0;
  for (const entry of entries) {
    if (entry.status === "confirmed" && entry.kg !== null) {
      confirmedKg += entry.kg;
    }
    if (entry.status === "pending") {
      pendingCount += 1;
    }
  }

  const expectedKg = period.rate > 0 ? period.storeTotalRub / period.rate : 0;
  const percent =
    expectedKg > 0 ? Math.min(100, Math.round((confirmedKg / expectedKg) * 100)) : 0;

  const dates = eachDateInclusive(period.startDate, period.endDate);
  const gaps: Array<{ collectorId: string; collectorName: string; date: string }> = [];
  const calendar = [];

  for (const date of dates) {
    const weekday = weekdayFromIso(date);
    const scheduled = collectors.filter(
      (collector) => collector.active && collector.dayOfWeek === weekday,
    );
    const dayEntries = entries.filter((entry) => entry.date === date);
    const people: Array<{
      collectorId: string;
      name: string;
      status: "confirmed" | "pending" | "scheduled";
    }> = [];

    for (const collector of scheduled) {
      const own = dayEntries.filter(
        (entry) =>
          entry.collectorId === collector.id &&
          (entry.status === "confirmed" || entry.status === "pending"),
      );
      if (own.some((entry) => entry.status === "confirmed")) {
        people.push({ collectorId: collector.id, name: collector.name, status: "confirmed" });
      } else if (own.some((entry) => entry.status === "pending")) {
        people.push({ collectorId: collector.id, name: collector.name, status: "pending" });
      } else {
        people.push({ collectorId: collector.id, name: collector.name, status: "scheduled" });
        gaps.push({ collectorId: collector.id, collectorName: collector.name, date });
      }
    }

    for (const entry of dayEntries) {
      if (entry.status === "rejected") {
        continue;
      }
      const already = people.some((person) => person.collectorId === entry.collectorId);
      if (already) {
        continue;
      }
      const collector = collectors.find((row) => row.id === entry.collectorId);
      people.push({
        collectorId: entry.collectorId,
        name: collector?.name ?? "Unknown",
        status: entry.status === "confirmed" ? "confirmed" : "pending",
      });
    }

    let status: "filled" | "review" | "gap" | "empty" = "empty";
    if (people.some((person) => person.status === "confirmed")) {
      status = "filled";
    } else if (people.some((person) => person.status === "pending")) {
      status = "review";
    } else if (people.some((person) => person.status === "scheduled")) {
      status = "gap";
    }

    calendar.push({ date, weekday, status, people });
  }

  return {
    periodId: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    rate: period.rate,
    storeTotalRub: period.storeTotalRub,
    status: period.status,
    confirmedKg,
    confirmedRub: confirmedKg * period.rate,
    expectedKg,
    expectedRub: period.storeTotalRub,
    percent,
    pendingCount,
    gaps,
    calendar,
  };
}
