import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const existing = await db.settings.findUnique({ where: { key: "default" } });
  if (existing) {
    throw new Error("Database already seeded");
  }

  await db.settings.create({
    data: {
      key: "default",
      bank: "Demo Bank",
      payTo: "00000000000",
      deadlineText: "до 16:00 воскресенья",
      kgRateRub: 20,
      windowStart: 17,
      windowEnd: 21,
    },
  });

  const anna = await db.collector.create({
    data: { name: "Иванова Анна", dayOfWeek: 6, telegramUserId: "100001", active: true },
  });
  const igor = await db.collector.create({
    data: { name: "Петров Игорь", dayOfWeek: 2, active: true },
  });
  const sidorovy = await db.collector.create({
    data: { name: "Сидоровы", dayOfWeek: 3, active: true },
  });
  const maria = await db.collector.create({
    data: { name: "Козлова Мария", dayOfWeek: null, active: true },
  });
  await db.collector.create({ data: { name: "Волковы", dayOfWeek: null, active: true } });
  await db.collector.create({
    data: { name: "Новикова Елена", dayOfWeek: null, active: true },
  });
  const orlovy = await db.collector.create({
    data: { name: "Орловы", dayOfWeek: 4, active: true },
  });
  await db.collector.create({
    data: { name: "Смирнова Татьяна", dayOfWeek: null, active: true },
  });

  const period = await db.period.create({
    data: {
      startDate: "2026-08-03",
      endDate: "2026-08-16",
      storeTotalRub: 8000,
      rate: 20,
      status: "open",
    },
  });

  await db.entry.createMany({
    data: [
      {
        periodId: period.id,
        collectorId: anna.id,
        date: "2026-08-01",
        kg: 26,
        source: "invoice",
        status: "confirmed",
        confirmedAt: new Date(Date.UTC(2026, 7, 1)),
      },
      {
        periodId: period.id,
        collectorId: anna.id,
        date: "2026-08-08",
        kg: 30,
        source: "manual",
        status: "confirmed",
        note: "без накладной, всё как обычно",
        confirmedAt: new Date(Date.UTC(2026, 7, 8)),
      },
      {
        periodId: period.id,
        collectorId: igor.id,
        date: "2026-08-04",
        kg: 41,
        source: "invoice",
        status: "confirmed",
        confirmedAt: new Date(Date.UTC(2026, 7, 4)),
      },
      {
        periodId: period.id,
        collectorId: sidorovy.id,
        date: "2026-08-05",
        kg: 45,
        source: "invoice",
        status: "confirmed",
        confirmedAt: new Date(Date.UTC(2026, 7, 5)),
      },
      {
        periodId: period.id,
        collectorId: orlovy.id,
        date: "2026-08-06",
        kg: 20,
        source: "manual",
        status: "confirmed",
        creditedByCollectorId: anna.id,
        confirmedAt: new Date(Date.UTC(2026, 7, 6)),
      },
      {
        periodId: period.id,
        collectorId: anna.id,
        date: "2026-08-09",
        source: "invoice",
        status: "pending",
      },
      {
        periodId: period.id,
        collectorId: maria.id,
        date: "2026-08-07",
        kg: 18,
        source: "invoice",
        status: "pending",
      },
    ],
  });

  console.log(`Seeded period ${period.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
