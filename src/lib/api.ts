import { apiRequest } from "./http";

export type MiniAppPlatform = "telegram" | "max";

function miniAuth(platform: MiniAppPlatform, initData: string) {
  return platform === "max"
    ? { maxInitData: initData }
    : { telegramInitData: initData };
}

export type Period = {
  _id: string;
  _creationTime: number;
  startDate: string;
  endDate: string;
  storeTotalRub: number;
  rate: number;
  status: "open" | "closed";
  settledAt: number | null;
  kind: "current" | "previous" | "past" | "future";
  editable: boolean;
};

export type Collector = {
  _id: string;
  _creationTime: number;
  name: string;
  dayOfWeek: number | null;
  telegramUserId?: string;
  maxUserId?: string;
  active: boolean;
};

export type PendingEntry = {
  _id: string;
  collectorId: string;
  collectorName: string;
  date: string;
  kg?: number;
  telegramFileId?: string;
  creditedByName?: string;
  hasPhoto?: boolean;
};

export type HistoryRow = {
  _id: string;
  date: string;
  kg: number | null;
  source: "invoice" | "manual";
  status?: "confirmed" | "skipped";
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
  hasMax: boolean;
};

export type MissingReport = {
  collectorId: string;
  collectorName: string;
  dates: string[];
};

export type SettlementMismatch = {
  collectedKg: number;
  collectedRub: number;
  storeKg: number;
  storeRub: number;
  diffKg: number;
  diffRub: number;
  missing: MissingReport[];
  pending: MissingReport[];
};

export type InvoiceSkip = {
  collectorName: string;
  reason: string;
};

export type Settlement = {
  periodId: string;
  startDate: string;
  endDate: string;
  rate: number;
  settled: boolean;
  storeTotalRub?: number;
  rows: PaymentRow[];
  totalKg: number;
  totalRub: number;
  missing?: MissingReport[];
  pending?: MissingReport[];
  text?: string;
  invoices?: {
    sent: number;
    skipped: InvoiceSkip[];
  };
};

export type MarkPaidResult = {
  settlement: Settlement;
  periodClosed: boolean;
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

export type TelegramPathCheck = {
  ok: boolean;
  via: "proxy" | "direct";
  latencyMs: number;
  error: "timeout" | "refused" | "host_not_found" | "auth" | "reset" | "unreachable" | null;
  checkedAt: number;
};

export type TelegramStatus = {
  botTokenSet: boolean;
  botTokenSource: "database" | "env" | null;
  botUsername: string | null;
  botRunning: boolean;
  miniAppUrl: string | null;
  groupChatId: string | null;
  groupChatTitle: string | null;
  proxyConfigured: boolean;
  proxySource: "database" | "env" | null;
  proxyType: "http" | "socks5" | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPasswordSet: boolean;
  pathCheck: TelegramPathCheck | null;
};

export type MaxStatus = {
  botTokenSet: boolean;
  botTokenSource: "database" | "env" | null;
  botUsername: string | null;
  botName: string | null;
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
  status: "pending" | "confirmed" | "rejected" | "skipped";
  creditedByName?: string;
  creditedForName?: string;
  hasPhoto: boolean;
  note?: string;
};

export type MiniPerson = {
  _id: string;
  name: string;
  dayOfWeek: number | null;
};

export type MiniHome = {
  platform: "telegram" | "max";
  user: { id: string; firstName: string };
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
  days: Array<{
    date: string;
    weekday: number;
    scheduled: MiniPerson[];
  }>;
  me: {
    kg: number;
    amountRub: number;
    paidAt: number | null;
    entries: MiniEntry[];
    gaps: Array<{ date: string }>;
  } | null;
  others: MiniPerson[];
};

export type Dashboard = {
  periodId: string;
  startDate: string;
  endDate: string;
  rate: number;
  storeTotalRub: number;
  status: "open" | "closed";
  settled: boolean;
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
    hasMax: boolean;
  }>;
  calendar: Array<{
    date: string;
    weekday: number;
    status: "filled" | "review" | "gap" | "empty";
    people: Array<{
      collectorId: string;
      name: string;
      status: "confirmed" | "pending" | "scheduled" | "skipped";
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
        maxUserId?: string;
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
        maxUserId?: string;
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
    update: (
      token: string,
      id: string,
      body: { startDate?: string; endDate?: string; storeTotalRub?: number; rate?: number },
    ) => apiRequest<null>(`/periods/${id}`, { method: "PATCH", token, body }),
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
    skip: (
      token: string,
      body: { periodId: string; collectorId: string; date: string },
    ) => apiRequest<string>("/entries/skip", { method: "POST", token, body }),
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
    calculate: (token: string, body: { storeKg: number; storeTotalRub: number }) =>
      apiRequest<Settlement>("/payments/calculate", {
        method: "POST",
        token,
        body,
      }),
    preview: (token: string) =>
      apiRequest<Settlement | null>("/payments/settlement/preview", { token }),
    current: (token: string) =>
      apiRequest<Settlement | null>("/payments/settlement", { token }),
    markPaid: (token: string, periodId: string, collectorId: string) =>
      apiRequest<MarkPaidResult>("/payments/mark-paid", {
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
    saveProxy: (
      token: string,
      body: {
        type: "http" | "socks5" | "none";
        host?: string;
        port?: number | "";
        username?: string;
        password?: string;
      },
    ) => apiRequest<TelegramStatus>("/telegram/proxy", { method: "PUT", token, body }),
    checkPath: (token: string) =>
      apiRequest<TelegramStatus>("/telegram/proxy/check", { method: "POST", token }),
    test: (token: string) =>
      apiRequest<null>("/telegram/test", { method: "POST", token }),
  },
  max: {
    get: (token: string) => apiRequest<MaxStatus>("/max", { token }),
    saveBot: (
      token: string,
      body: { botToken?: string; miniAppUrl?: string },
    ) => apiRequest<MaxStatus>("/max/bot", { method: "PUT", token, body }),
    clearBot: (token: string) =>
      apiRequest<MaxStatus>("/max/bot/clear", { method: "POST", token }),
    checkBot: (token: string, botToken?: string) =>
      apiRequest<{ ok: true; name: string; username: string | null }>("/max/bot/check", {
        method: "POST",
        token,
        body: botToken ? { botToken } : {},
      }),
    linkChat: (token: string, groupChatId: string) =>
      apiRequest<MaxStatus>("/max/chat", {
        method: "PUT",
        token,
        body: { groupChatId },
      }),
    unlinkChat: (token: string) =>
      apiRequest<MaxStatus>("/max/chat/unlink", { method: "POST", token }),
    test: (token: string) => apiRequest<null>("/max/test", { method: "POST", token }),
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
    home: (initData: string, platform: MiniAppPlatform = "telegram") =>
      apiRequest<MiniHome>("/miniapp/home", miniAuth(platform, initData)),
    createEntry: (
      initData: string,
      body: {
        date: string;
        kg?: number;
        collectorId?: string;
        note?: string;
        photo?: File;
      },
      platform: MiniAppPlatform = "telegram",
    ) => {
      const auth = miniAuth(platform, initData);
      if (body.photo) {
        const form = new FormData();
        form.append("date", body.date);
        if (body.kg !== undefined) {
          form.append("kg", String(body.kg));
        }
        if (body.collectorId) {
          form.append("collectorId", body.collectorId);
        }
        if (body.note) {
          form.append("note", body.note);
        }
        form.append("photo", body.photo);
        return apiRequest<string>("/miniapp/entries", {
          method: "POST",
          ...auth,
          body: form,
        });
      }
      return apiRequest<string>("/miniapp/entries", {
        method: "POST",
        ...auth,
        body: {
          date: body.date,
          kg: body.kg,
          collectorId: body.collectorId,
          note: body.note,
        },
      });
    },
    skip: (initData: string, date: string, platform: MiniAppPlatform = "telegram") =>
      apiRequest<string>("/miniapp/entries/skip", {
        method: "POST",
        ...miniAuth(platform, initData),
        body: { date },
      }),
  },
};
