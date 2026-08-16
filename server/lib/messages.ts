import type { PrismaClient } from "@prisma/client";
import { getDashboard } from "./dashboard";
import { KG_RATE_RUB, requireCollector, requirePeriod, requireSettings } from "./domain";
import { eachDateInclusive } from "./dates";
import { HttpError } from "./errors";
import { getPeriodSettlement, sumConfirmedKgForPayee } from "./payments";
import { getMiniAppUrl, sendTelegramMessage } from "./telegram";
import { sendMaxMessage } from "./max";

function fmtShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

export type GreetingCollectorStatus = "active" | "inactive" | "unknown";

export const MINI_APP_BUTTON = "ВНЕСТИ";

export function buildGreetingText(args: {
  helloName: string;
  hasApp: boolean;
  status: GreetingCollectorStatus;
  idLabel: string;
  id: string;
}): string {
  const lines = [
    `Привет, ${args.helloName}!`,
    "",
    "Это бот сборщиков «Пятёрка на бульваре».",
  ];
  if (args.hasApp) {
    lines.push(
      "",
      `Нажми «${MINI_APP_BUTTON}» — откроется приложение: сумма за период, кг и фото ведомости.`,
    );
  }
  if (args.status === "active" && !args.hasApp) {
    lines.push("", "Пришли фото ведомости сюда в чат — оно уйдёт на проверку.");
  } else if (args.status === "unknown") {
    lines.push(
      "",
      `Если тебя ещё нет в списке, покажи организатору свой ${args.idLabel}: ${args.id}`,
    );
  } else {
    lines.push("", "Ты скрыт в списке участников — напиши организатору.");
  }
  return lines.join("\n");
}

export async function buildSummary(db: PrismaClient, periodId: string) {
  const settings = await requireSettings(db);
  const settlement = await getPeriodSettlement(db, periodId);
  const { startDate, endDate, rate, rows, totalKg, totalRub } = settlement;
  const dayCount = eachDateInclusive(startDate, endDate).length;
  const spanLabel = dayCount <= 7 ? "ЗА НЕДЕЛЮ" : dayCount <= 14 ? "ЗА 2 НЕДЕЛИ" : `ЗА ${dayCount} ДНЕЙ`;
  const lines = [
    `⚠️ ПОДСЧИТАНО ${spanLabel}`,
    "",
    `💳 Оплата с ${fmtShort(startDate)} по ${fmtShort(endDate)}. ${totalRub} руб. = общий вес: ${totalKg} кг`,
    "",
  ];
  for (const row of rows) {
    lines.push(`▫️ ${row.collectorName} - ${row.kg}*${rate} = ${row.kg * rate} руб`);
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
      ? `${name}, по графику нет отчёта за ${fmtShort(first)}.`
      : `${name}, по графику нет отчётов за ${dates.length} ${daysWord(dates.length)}:`;
  const action = getMiniAppUrl()
    ? `Нажми «${MINI_APP_BUTTON}»: внеси кг и фото ведомости или отметь «Не брал», если не забирал.`
    : "Пришли фото ведомости сюда в чат. Если не забирал — напиши организатору.";
  return [heading, ...(dates.length > 1 ? ["", listed] : []), "", action].join("\n");
}

function formatInvoice(args: {
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
    `${args.name}, выставлен счёт за ${fmtShort(args.startDate)}–${fmtShort(args.endDate)}.`,
    "",
    `${args.kg} кг × ${args.rate} = ${args.amountRub} ₽`,
    "",
    `Переводить на карту ${args.bank} (${args.payTo})`,
    args.deadlineText,
  ].join("\n");
}

export type InvoiceSendResult = {
  sent: number;
  skipped: Array<{ collectorName: string; reason: string }>;
};

export async function sendSettlementInvoices(
  db: PrismaClient,
  periodId: string,
): Promise<InvoiceSendResult> {
  const settlement = await getPeriodSettlement(db, periodId);
  const skipped: InvoiceSendResult["skipped"] = [];
  let sent = 0;
  let settings: Awaited<ReturnType<typeof requireSettings>>;
  try {
    settings = await requireSettings(db);
  } catch (err) {
    const reason = err instanceof HttpError ? err.message : "Settings not found";
    for (const row of settlement.rows) {
      if (!row.paidAt) {
        skipped.push({ collectorName: row.collectorName, reason });
      }
    }
    return { sent, skipped };
  }
  for (const row of settlement.rows) {
    if (row.paidAt) {
      continue;
    }
    const collector = await requireCollector(db, row.collectorId);
    if (!collector.telegramUserId && !collector.maxUserId) {
      skipped.push({ collectorName: row.collectorName, reason: "Collector has no messenger ID" });
      continue;
    }
    const text = formatInvoice({
      name: collector.name,
      startDate: settlement.startDate,
      endDate: settlement.endDate,
      kg: row.kg,
      rate: settlement.rate,
      amountRub: row.amountRub,
      bank: settings.bank,
      payTo: settings.payTo,
      deadlineText: settings.deadlineText,
    });
    try {
      if (collector.telegramUserId) {
        await sendTelegramMessage(collector.telegramUserId, text);
      }
      if (collector.maxUserId) {
        await sendMaxMessage(collector.maxUserId, text);
      }
      sent += 1;
    } catch (err) {
      skipped.push({
        collectorName: row.collectorName,
        reason: err instanceof HttpError ? err.message : "Failed to send message",
      });
    }
  }
  return { sent, skipped };
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
): Promise<{
  text: string;
  telegramChatId: string | null;
  maxChatId: string | null;
  collectorName: string;
}> {
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
      telegramChatId: collector.telegramUserId,
      maxChatId: collector.maxUserId,
      collectorName: collector.name,
    };
  }

  const settings = await requireSettings(db);
  const kg = await sumConfirmedKgForPayee(db, periodId, collectorId);
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
      rate: KG_RATE_RUB,
      amountRub: kg * KG_RATE_RUB,
      bank: settings.bank,
      payTo: settings.payTo,
      deadlineText: settings.deadlineText,
    }),
    telegramChatId: collector.telegramUserId,
    maxChatId: collector.maxUserId,
    collectorName: collector.name,
  };
}

export type OverdueReportReminder = {
  collectorId: string;
  collectorName: string;
  telegramChatId: string | null;
  maxChatId: string | null;
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
    const collector = byId.get(collectorId);
    if (!collector?.telegramUserId && !collector?.maxUserId) {
      continue;
    }
    reminders.push({
      collectorId,
      collectorName: row.name,
      telegramChatId: collector.telegramUserId,
      maxChatId: collector.maxUserId,
      dates: row.dates,
      text: formatReportReminder(row.name, row.dates),
    });
  }
  return reminders;
}
