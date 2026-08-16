const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(iso: string): string {
  if (!DATE_RE.test(iso)) {
    throw new Error("Invalid date, expected YYYY-MM-DD");
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }
  return iso;
}

export function weekdayFromIso(iso: string): number {
  assertDate(iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function formatUtcYmd(utcMs: number): string {
  const dt = new Date(utcMs);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcMsFromIso(iso: string): number {
  assertDate(iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

export function eachDateInclusive(startDate: string, endDate: string): string[] {
  const startMs = utcMsFromIso(startDate);
  const endMs = utcMsFromIso(endDate);
  if (startMs > endMs) {
    throw new Error("startDate must be on or before endDate");
  }
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    dates.push(formatUtcYmd(ms));
  }
  return dates;
}

export function assertDayOfWeek(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error("dayOfWeek must be 0-6 (Sunday-Saturday) or null");
  }
  return value;
}

export function addDaysIso(iso: string, days: number): string {
  return formatUtcYmd(utcMsFromIso(iso) + days * 86_400_000);
}

export function mondayOfWeek(iso: string): string {
  const weekday = weekdayFromIso(iso);
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDaysIso(iso, -daysFromMonday);
}

export function currentMoscowWeek(nowMs: number): { startDate: string; endDate: string } {
  const { date } = clockInTimeZone(STORE_TIME_ZONE, nowMs);
  const startDate = mondayOfWeek(date);
  return { startDate, endDate: addDaysIso(startDate, 6) };
}

export const STORE_TIME_ZONE = "Europe/Moscow";

export function clockInTimeZone(
  timeZone: string,
  nowMs: number,
): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour");
  if (!year || !month || !day || hour === undefined) {
    throw new Error("Failed to format clock");
  }
  return { date: `${year}-${month}-${day}`, hour: Number(hour) };
}
