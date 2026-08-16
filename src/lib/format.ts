export const DAY_NAMES = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const;

export const DAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

export function fmtShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const MONTH_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
] as const;

export function fmtHuman(iso: string): string {
  const month = MONTH_SHORT[Number(iso.slice(5, 7)) - 1];
  return `${Number(iso.slice(8, 10))} ${month ?? iso.slice(5, 7)}`;
}

export function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
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
  "Failed to open the current week": "Не удалось открыть текущую неделю",
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
  "Settlement does not match store invoice": "Итог участников не совпадает со счётом магазина",
  "Previous period is already settled": "Прошлая неделя уже закрыта — все оплатили",
  "Period is already settled": "Период уже закрыт — все оплатили, кг менять нельзя",
  "Date is outside the period": "Дата не входит в этот период",
  "Previous period not found": "Прошлой недели в системе ещё нет — нечего считать",
  "BOT_TOKEN is not configured": "Токен бота не задан — откройте раздел Telegram в админке",
  "Invalid bot token": "Неверный токен бота — проверьте у @BotFather",
  "MINIAPP_URL must be an https URL": "URL мини-приложения должен начинаться с https://",
  "Invalid group chat ID": "Укажите Chat ID группы, например -1001234567890",
  "Chat not found": "Бот не видит этот чат — добавьте его в группу и проверьте ID",
  "Group chat is not linked": "Сначала привяжите группу в разделе Telegram",
  "Failed to send Telegram message": "Не удалось отправить сообщение в Telegram",
  "Collector has no Telegram ID": "У участника нет Telegram ID — укажите его в разделе Участники",
  "Collector has not started the bot": "Участник ещё не нажал /start у бота — бот не может написать первым",
  "Collector has no missing reports": "У этого участника нет пропусков в этом периоде",
  "Collector already paid": "Перевод уже отмечен",
  "Invalid reminder kind": "Неизвестный тип напоминания",
  "periodId and collectorId are required": "Не хватает периода или участника",
  "Invalid Telegram initData": "Открой приложение из Telegram-бота",
  "Telegram initData expired": "Сессия Telegram истекла — закрой и открой приложение снова",
  "Not a collector": "Тебя нет в списке участников",
  "Collector is inactive": "Ты скрыт в списке участников",
  "Date is outside the open period": "Дата не входит в текущий период",
  "Date is in the future": "Нельзя внести за день, который ещё не наступил",
  "creditedByCollectorId must be a different collector": "Засчитать можно только за другого участника",
  "kg must be greater than 0": "Укажите килограммы больше нуля",
  "storeTotalRub must be greater than 0": "Укажите сумму из счёта магазина",
  "Add kilograms or a photo": "Укажи кг или загрузи фото ведомости",
  "Photo is too large": "Фото слишком большое — до 8 МБ",
  "Unsupported photo type": "Нужно фото: JPG, PNG или HEIC",
  "Photo not found": "Фото не найдено",
};

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Неизвестная ошибка";
  const storeMismatch = raw.match(
    /^Store invoice mismatch: (.+) kg × (\d+) = (.+), got (.+)$/,
  );
  if (storeMismatch) {
    return `В счёте магазина кг и сумма не сходятся: ${storeMismatch[1]} кг × ${storeMismatch[2]} = ${storeMismatch[3]} ₽, указано ${storeMismatch[4]} ₽`;
  }
  return ERROR_RU[raw] ?? raw;
}
