import { db } from "../db";
import { STORE_TIME_ZONE, clockInTimeZone } from "./dates";
import { getOpenPeriod, getSettings } from "./domain";
import { listOverdueReportReminders } from "./messages";
import { refreshTelegramRuntime, sendTelegramMessage } from "./telegram";
import { refreshMaxRuntime, sendMaxMessage } from "./max";

export const DAILY_REPORT_REMINDER_HOUR = 10;
const CHECK_EVERY_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

export function startDailyReportReminders(): void {
  if (timer) {
    return;
  }
  console.log(
    `Daily report reminders: ${String(DAILY_REPORT_REMINDER_HOUR).padStart(2, "0")}:00 ${STORE_TIME_ZONE}`,
  );
  timer = setInterval(() => {
    void tickDailyReportReminders();
  }, CHECK_EVERY_MS);
  void tickDailyReportReminders();
}

export function stopDailyReportReminders(): void {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
}

export async function tickDailyReportReminders(nowMs = Date.now()): Promise<void> {
  if (tickRunning) {
    return;
  }
  tickRunning = true;
  try {
    const clock = clockInTimeZone(STORE_TIME_ZONE, nowMs);
    if (clock.hour < DAILY_REPORT_REMINDER_HOUR) {
      return;
    }
    const settings = await getSettings(db);
    if (!settings) {
      return;
    }
    if (settings.dailyReportReminderSentOn === clock.date) {
      return;
    }
    const telegram = await refreshTelegramRuntime();
    const max = await refreshMaxRuntime();
    if (!telegram.botToken && !max.botToken) {
      return;
    }
    const sent = await sendDailyReportReminders(clock.date);
    await db.settings.update({
      where: { key: "default" },
      data: { dailyReportReminderSentOn: clock.date },
    });
    if (sent.sent > 0 || sent.skipped > 0) {
      console.log(
        `Daily report reminders ${clock.date}: sent ${sent.sent}, skipped ${sent.skipped}`,
      );
    }
  } catch (err) {
    console.error("Daily report reminders failed", err);
  } finally {
    tickRunning = false;
  }
}

async function sendDailyReportReminders(
  today: string,
): Promise<{ sent: number; skipped: number }> {
  const period = await getOpenPeriod(db);
  if (!period) {
    return { sent: 0, skipped: 0 };
  }
  const reminders = await listOverdueReportReminders(db, period.id, today);
  let sent = 0;
  let skipped = 0;
  for (const reminder of reminders) {
    try {
      if (reminder.telegramChatId) {
        await sendTelegramMessage(reminder.telegramChatId, reminder.text);
        sent += 1;
      }
      if (reminder.maxChatId) {
        await sendMaxMessage(reminder.maxChatId, reminder.text);
        sent += 1;
      }
    } catch (err) {
      skipped += 1;
      console.warn(
        `Daily report reminder skipped for ${reminder.collectorName}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { sent, skipped };
}
