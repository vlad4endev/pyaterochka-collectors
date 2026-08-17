import type { Collector, Entry, Period, Settings } from "@prisma/client";
import { isPeriodEditable, periodKind } from "./domain";

export function collectorDto(row: Collector) {
  return {
    _id: row.id,
    _creationTime: row.createdAt.getTime(),
    name: row.name,
    dayOfWeek: row.dayOfWeek,
    phone: row.phone ?? undefined,
    telegramUserId: row.telegramUserId ?? undefined,
    maxUserId: row.maxUserId ?? undefined,
    active: row.active,
  };
}

export function periodDto(row: Period) {
  const kind = periodKind(row);
  return {
    _id: row.id,
    _creationTime: row.createdAt.getTime(),
    startDate: row.startDate,
    endDate: row.endDate,
    storeTotalRub: row.storeTotalRub,
    rate: row.rate,
    status: row.status,
    settledAt: row.settledAt?.getTime() ?? null,
    kind,
    editable: isPeriodEditable(row),
  };
}

export function settingsDto(row: Settings) {
  return {
    _id: row.id,
    _creationTime: row.createdAt.getTime(),
    key: "default" as const,
    bank: row.bank,
    payTo: row.payTo,
    deadlineText: row.deadlineText,
    kgRateRub: row.kgRateRub,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    groupChatId: row.groupChatId ?? undefined,
  };
}

export function pendingDto(row: Entry, collectorName: string) {
  return {
    _id: row.id,
    _creationTime: row.createdAt.getTime(),
    periodId: row.periodId,
    collectorId: row.collectorId,
    collectorName,
    date: row.date,
    kg: row.kg ?? undefined,
    source: row.source,
    status: "pending" as const,
    telegramFileId: row.telegramFileId ?? undefined,
    creditedByCollectorId: row.creditedByCollectorId ?? undefined,
    note: row.note ?? undefined,
    confirmedAt: row.confirmedAt?.getTime(),
  };
}
