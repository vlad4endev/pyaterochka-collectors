import { apiRequest } from "./http";

export type Period = {
  _id: string;
  _creationTime: number;
  startDate: string;
  endDate: string;
  storeTotalRub: number;
  rate: number;
  status: "open" | "closed";
};

export type Collector = {
  _id: string;
  _creationTime: number;
  name: string;
  dayOfWeek: number | null;
  telegramUserId?: string;
  active: boolean;
};

export type PendingEntry = {
  _id: string;
  collectorId: string;
  collectorName: string;
  date: string;
  kg?: number;
  telegramFileId?: string;
};

export type HistoryRow = {
  _id: string;
  date: string;
  kg: number;
  source: "invoice" | "manual";
  collectorId: string;
  collectorName: string;
  creditedByCollectorId?: string;
  creditedByName?: string;
  note?: string;
};

export type PaymentRow = {
  collectorId: string;
  collectorName: string;
  kg: number;
  amountRub: number;
  paidAt: number | null;
  paymentId: string | null;
  hasTelegram: boolean;
};

export type Settings = {
  _id: string;
  bank: string;
  payTo: string;
  deadlineText: string;
  windowStart: number;
  windowEnd: number;
  groupChatId?: string;
};

export type TelegramStatus = {
  botTokenSet: boolean;
  botTokenSource: "database" | "env" | null;
  botUsername: string | null;
  botRunning: boolean;
  miniAppUrl: string | null;
  groupChatId: string | null;
  groupChatTitle: string | null;
};

export type MiniEntry = {
  _id: string;
  date: string;
  kg?: number;
  source: "invoice" | "manual";
  status: "pending" | "confirmed" | "rejected";
  creditedByName?: string;
  note?: string;
};

export type MiniHome = {
  telegram: { id: string; firstName: string };
  collector: {
    _id: string;
    name: string;
    dayOfWeek: number | null;
    active: boolean;
  } | null;
  period: {
    _id: string;
    startDate: string;
    endDate: string;
    rate: number;
    status: "open" | "closed";
  } | null;
  settings: {
    windowStart: number;
    windowEnd: number;
    bank: string;
    payTo: string;
    deadlineText: string;
  } | null;
  today: {
    date: string;
    weekday: number;
    hour: number;
    isMyDay: boolean;
    windowStatus: "not-today" | "before" | "open" | "after";
  };
  me: {
    kg: number;
    amountRub: number;
    paidAt: number | null;
    entries: MiniEntry[];
    gaps: Array<{ date: string }>;
  } | null;
  others: Array<{ _id: string; name: string }>;
};

export type Dashboard = {
  periodId: string;
  startDate: string;
  endDate: string;
  rate: number;
  storeTotalRub: number;
  status: "open" | "closed";
  confirmedKg: number;
  confirmedRub: number;
  expectedKg: number;
  expectedRub: number;
  percent: number;
  pendingCount: number;
  gaps: Array<{
    collectorId: string;
    collectorName: string;
    date: string;
    hasTelegram: boolean;
  }>;
  calendar: Array<{
    date: string;
    weekday: number;
    status: "filled" | "review" | "gap" | "empty";
    people: Array<{
      collectorId: string;
      name: string;
      status: "confirmed" | "pending" | "scheduled";
    }>;
  }>;
};

export const api = {
  login: (password: string) =>
    apiRequest<{ sessionToken: string; expiresAt: number }>("/auth/login", {
      method: "POST",
      body: { password },
    }),
  logout: (token: string) =>
    apiRequest<null>("/auth/logout", { method: "POST", token }),
  me: (token: string) => apiRequest<{ expiresAt: number }>("/auth/me", { token }),
  collectors: {
    list: (token: string) => apiRequest<Collector[]>("/collectors", { token }),
    create: (
      token: string,
      body: {
        name: string;
        dayOfWeek: number | null;
        telegramUserId?: string;
        active?: boolean;
      },
    ) => apiRequest<string>("/collectors", { method: "POST", token, body }),
    update: (
      token: string,
      id: string,
      body: {
        name?: string;
        dayOfWeek?: number | null;
        telegramUserId?: string;
        active?: boolean;
      },
    ) => apiRequest<null>(`/collectors/${id}`, { method: "PATCH", token, body }),
  },
  periods: {
    list: (token: string) => apiRequest<Period[]>("/periods", { token }),
    create: (
      token: string,
      body: { startDate: string; endDate: string; storeTotalRub: number; rate: number },
    ) => apiRequest<string>("/periods", { method: "POST", token, body }),
    close: (token: string, id: string) =>
      apiRequest<null>(`/periods/${id}/close`, { method: "POST", token }),
  },
  dashboard: (token: string, periodId: string) =>
    apiRequest<Dashboard>(`/dashboard/${periodId}`, { token }),
  entries: {
    listPending: (token: string, periodId: string) =>
      apiRequest<PendingEntry[]>(`/entries/pending?periodId=${encodeURIComponent(periodId)}`, {
        token,
      }),
    confirm: (token: string, entryId: string, kg: number) =>
      apiRequest<null>(`/entries/${entryId}/confirm`, { method: "POST", token, body: { kg } }),
    reject: (token: string, entryId: string, note?: string) =>
      apiRequest<null>(`/entries/${entryId}/reject`, { method: "POST", token, body: { note } }),
    createManual: (
      token: string,
      body: { periodId: string; collectorId: string; date: string; kg: number; note?: string },
    ) => apiRequest<string>("/entries/manual", { method: "POST", token, body }),
    createCredit: (
      token: string,
      body: {
        periodId: string;
        collectorId: string;
        creditedByCollectorId: string;
        date: string;
        kg: number;
        note?: string;
      },
    ) => apiRequest<string>("/entries/credit", { method: "POST", token, body }),
  },
  history: (token: string, periodId: string) =>
    apiRequest<HistoryRow[]>(`/history?periodId=${encodeURIComponent(periodId)}`, { token }),
  payments: {
    list: (token: string, periodId: string) =>
      apiRequest<PaymentRow[]>(`/payments?periodId=${encodeURIComponent(periodId)}`, { token }),
    markPaid: (token: string, periodId: string, collectorId: string) =>
      apiRequest<string>("/payments/mark-paid", {
        method: "POST",
        token,
        body: { periodId, collectorId },
      }),
  },
  settings: {
    get: (token: string) => apiRequest<Settings | null>("/settings", { token }),
    update: (
      token: string,
      body: {
        bank: string;
        payTo: string;
        deadlineText: string;
        windowStart: number;
        windowEnd: number;
        groupChatId?: string;
      },
    ) => apiRequest<null>("/settings", { method: "PUT", token, body }),
  },
  telegram: {
    get: (token: string) => apiRequest<TelegramStatus>("/telegram", { token }),
    saveBot: (
      token: string,
      body: { botToken?: string; miniAppUrl?: string },
    ) => apiRequest<TelegramStatus>("/telegram/bot", { method: "PUT", token, body }),
    clearBot: (token: string) =>
      apiRequest<TelegramStatus>("/telegram/bot/clear", { method: "POST", token }),
    linkChat: (token: string, groupChatId: string) =>
      apiRequest<TelegramStatus>("/telegram/chat", {
        method: "PUT",
        token,
        body: { groupChatId },
      }),
    unlinkChat: (token: string) =>
      apiRequest<TelegramStatus>("/telegram/chat/unlink", { method: "POST", token }),
    test: (token: string) =>
      apiRequest<null>("/telegram/test", { method: "POST", token }),
  },
  summary: (token: string, periodId: string) =>
    apiRequest<{ text: string; totalKg: number; totalRub: number }>(
      `/messages/summary?periodId=${encodeURIComponent(periodId)}`,
      { token },
    ),
  sendSummary: (token: string, periodId: string) =>
    apiRequest<null>("/messages/summary/send", {
      method: "POST",
      token,
      body: { periodId },
    }),
  reminderPreview: (
    token: string,
    periodId: string,
    collectorId: string,
    kind: "report" | "payment",
  ) =>
    apiRequest<{ text: string; canSend: boolean }>(
      `/messages/remind?periodId=${encodeURIComponent(periodId)}&collectorId=${encodeURIComponent(collectorId)}&kind=${kind}`,
      { token },
    ),
  sendReminder: (
    token: string,
    periodId: string,
    collectorId: string,
    kind: "report" | "payment",
  ) =>
    apiRequest<null>("/messages/remind", {
      method: "POST",
      token,
      body: { periodId, collectorId, kind },
    }),
  miniapp: {
    home: (initData: string) =>
      apiRequest<MiniHome>("/miniapp/home", { telegramInitData: initData }),
    createManual: (
      initData: string,
      body: { date: string; kg: number; note?: string },
    ) =>
      apiRequest<string>("/miniapp/entries/manual", {
        method: "POST",
        telegramInitData: initData,
        body,
      }),
    createCredit: (
      initData: string,
      body: { collectorId: string; date: string; kg: number; note?: string },
    ) =>
      apiRequest<string>("/miniapp/entries/credit", {
        method: "POST",
        telegramInitData: initData,
        body,
      }),
  },
};
