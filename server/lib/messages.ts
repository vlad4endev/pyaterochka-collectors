import type { PrismaClient } from "@prisma/client";
import { getDashboard } from "./dashboard";
import { requireCollector, requirePeriod, requireSettings } from "./domain";
import { HttpError } from "./errors";
import { getMiniAppUrl } from "./telegram";

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

export type ReminderKind = "report" | "payment";

export function assertReminderKind(raw: string): ReminderKind {
  if (raw === "report" || raw === "payment") {
    return raw;
  }
  throw new HttpError("Invalid reminder kind");
}

function appHint(): string[] {
  if (!getMiniAppUrl()) {
    return [];
  }
  return ["", "Открой приложение в боте — там можно внести кг."];
}

function daysWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "день";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "дня";
  }
  return "дней";
}

function formatReportReminder(name: string, dates: string[]): string {
  const listed = dates.map((date) => `• ${fmtShort(date)}`).join("\n");
  const first = dates[0] ?? "";
  const heading =
    dates.length === 1
      ? `${name}, по графику не внесён отчёт за ${fmtShort(first)}.`
      : `${name}, по графику нет отчётов за ${dates.length} ${daysWord(dates.length)}:`;
  return [
    heading,
    ...(dates.length > 1 ? ["", listed] : []),
    "",
    "Пришли фото накладной в бот или внеси кг вручную.",
    ...appHint(),
  ].join("\n");
}

function formatPaymentReminder(args: {
  name: string;
  startDate: string;
  endDate: string;
  kg: number;
  rate: number;
  amountRub: number;
  bank: string;
  payTo: string;
  deadlineText: string;
}): string {
  return [
    `${args.name}, напоминание по переводу за ${fmtShort(args.startDate)}–${fmtShort(args.endDate)}.`,
    "",
    `${args.kg} кг × ${args.rate} = ${args.amountRub} ₽ — пока не отмечен.`,
    `Карта: ${args.bank} (${args.payTo}) ${args.deadlineText}`,
    "",
    "Если уже перевели — напишите в чат, отметим.",
  ].join("\n");
}

export async function buildReminder(
  db: PrismaClient,
  periodId: string,
  collectorId: string,
  kind: ReminderKind,
): Promise<{ text: string; chatId: string | null; collectorName: string }> {
  const collector = await requireCollector(db, collectorId);
  const period = await requirePeriod(db, periodId);

  if (kind === "report") {
    const dashboard = await getDashboard(db, periodId);
    const dates = dashboard.gaps
      .filter((gap) => gap.collectorId === collectorId)
      .map((gap) => gap.date);
    if (dates.length === 0) {
      throw new HttpError("Collector has no missing reports");
    }
    return {
      text: formatReportReminder(collector.name, dates),
      chatId: collector.telegramUserId,
      collectorName: collector.name,
    };
  }

  const settings = await requireSettings(db);
  const entries = await db.entry.findMany({
    where: { periodId, collectorId, status: "confirmed" },
    take: 500,
  });
  let kg = 0;
  for (const entry of entries) {
    if (entry.kg !== null) {
      kg += entry.kg;
    }
  }
  if (kg <= 0) {
    throw new HttpError("Collector has no confirmed kg in this period");
  }
  const payment = await db.payment.findUnique({
    where: { periodId_collectorId: { periodId, collectorId } },
  });
  if (payment?.paidAt) {
    throw new HttpError("Collector already paid");
  }
  return {
    text: formatPaymentReminder({
      name: collector.name,
      startDate: period.startDate,
      endDate: period.endDate,
      kg,
      rate: period.rate,
      amountRub: kg * period.rate,
      bank: settings.bank,
      payTo: settings.payTo,
      deadlineText: settings.deadlineText,
    }),
    chatId: collector.telegramUserId,
    collectorName: collector.name,
  };
}

export type OverdueReportReminder = {
  collectorId: string;
  collectorName: string;
  chatId: string;
  dates: string[];
  text: string;
};

export async function listOverdueReportReminders(
  db: PrismaClient,
  periodId: string,
  today: string,
): Promise<OverdueReportReminder[]> {
  const dashboard = await getDashboard(db, periodId);
  const grouped = new Map<string, { name: string; dates: string[] }>();
  for (const gap of dashboard.gaps) {
    if (gap.date >= today) {
      continue;
    }
    const current = grouped.get(gap.collectorId);
    if (current) {
      current.dates.push(gap.date);
    } else {
      grouped.set(gap.collectorId, {
        name: gap.collectorName,
        dates: [gap.date],
      });
    }
  }
  if (grouped.size === 0) {
    return [];
  }
  const collectors = await db.collector.findMany({
    where: { id: { in: [...grouped.keys()] } },
    take: 100,
  });
  const byId = new Map(collectors.map((row) => [row.id, row]));
  const reminders: OverdueReportReminder[] = [];
  for (const [collectorId, row] of grouped) {
    const chatId = byId.get(collectorId)?.telegramUserId;
    if (!chatId) {
      continue;
    }
    reminders.push({
      collectorId,
      collectorName: row.name,
      chatId,
      dates: row.dates,
      text: formatReportReminder(row.name, row.dates),
    });
  }
  return reminders;
}
