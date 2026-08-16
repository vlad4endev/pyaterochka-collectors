export const DAY_NAMES = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const;

export function fmtShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

export function dayNumber(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function weekdayFromIso(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function dayName(iso: string): string {
  return DAY_NAMES[weekdayFromIso(iso)] ?? iso;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function isoWeek(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function periodLabel(startDate: string, endDate: string): string {
  const startWeek = isoWeek(startDate);
  const endWeek = isoWeek(endDate);
  const weeks =
    startWeek === endWeek
      ? `${startWeek} неделя`
      : `${startWeek}–${endWeek} неделя`;
  return `${weeks} · ${fmtShort(startDate)}–${fmtShort(endDate)}`;
}

export function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysLocal(iso: string, days: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(year, month - 1, day + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function mondayPad(weekday: number): number {
  return weekday === 0 ? 6 : weekday - 1;
}

export function formatKg(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatRub(value: number): string {
  return String(Math.round(value));
}

const ERROR_RU: Record<string, string> = {
  "Invalid password": "Неверный пароль",
  "Not authenticated": "Нужно войти заново",
  "Session expired": "Сессия истекла, войдите снова",
  "ADMIN_PASSWORD is not configured": "Пароль админки не задан на сервере",
  "An open period already exists": "Уже есть открытый период — сначала закройте его",
  "Period is already closed": "Период уже закрыт",
  "Period is closed": "Период закрыт",
  "Period not found": "Период не найден",
  "Entry not found": "Запись не найдена",
  "Entry is not pending review": "Запись уже обработана",
  "Collector not found": "Участник не найден",
  "Settings not found": "Сначала сохраните настройки",
  "Name is required": "Укажите имя",
  "Bank, payTo and deadlineText are required": "Заполните банк, карту и дедлайн",
  "windowStart must be before windowEnd": "Начало окна должно быть раньше конца",
  "Collector has no confirmed kg in this period": "У участника нет подтверждённых кг",
  "BOT_TOKEN is not configured": "Токен бота не задан на сервере",
  "Invalid Telegram initData": "Открой приложение из Telegram-бота",
  "Telegram initData expired": "Сессия Telegram истекла — закрой и открой приложение снова",
  "Not a collector": "Тебя нет в списке участников",
  "Collector is inactive": "Ты скрыт в списке участников",
  "Date is outside the open period": "Дата не входит в текущий период",
  "creditedByCollectorId must be a different collector": "Засчитать можно только за другого участника",
};

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Неизвестная ошибка";
  return ERROR_RU[raw] ?? raw;
}
