import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AdminSession, Collector } from "@prisma/client";
import { db } from "./db";
import { getDashboard } from "./lib/dashboard";
import {
  assertDate,
  assertDayOfWeek,
  assertPeriodDates,
  assertPositiveKg,
  assertRate,
  assertStoreTotal,
  assertWindowHour,
  getOpenPeriod,
  getSettings,
  patchDefaultSettings,
  normalizeName,
  normalizeOptionalTelegram,
  requireCollector,
  requireOpenPeriod,
  requirePeriod,
} from "./lib/domain";
import { collectorDto, pendingDto, periodDto, settingsDto } from "./lib/dto";
import {
  getAdminPassword,
  HttpError,
  randomSessionToken,
  timingSafeEqualString,
} from "./lib/errors";
import { assertReminderKind, buildReminder, buildSummary } from "./lib/messages";
import {
  createCollectorCreditEntry,
  createCollectorManualEntry,
  getMiniHome,
  requireActiveCollector,
} from "./lib/miniapp";
import { restartBot } from "./bot";
import {
  assertGroupChatId,
  assertMiniAppUrl,
  fetchBotIdentity,
  fetchChatTitle,
  getBotToken,
  getTelegramStatus,
  sendTelegramMessage,
  verifyTelegramInitData,
} from "./lib/telegram";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Variables = { session: AdminSession };

type MiniVariables = {
  telegramUserId: string;
  firstName: string;
  collector: Collector | null;
};

export const app = new Hono<{ Variables: Variables }>();

app.use("*", cors());

app.get("/health", async (c) => {
  await db.$queryRaw`SELECT 1`;
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }
  const message = err instanceof Error ? err.message : "Internal error";
  console.error(err);
  return c.json({ error: message }, 400);
});

async function requireSession(c: { req: { header: (name: string) => string | undefined } }) {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    throw new HttpError("Not authenticated", 401);
  }
  const session = await db.adminSession.findUnique({ where: { token } });
  if (!session) {
    throw new HttpError("Not authenticated", 401);
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.adminSession.delete({ where: { id: session.id } });
    throw new HttpError("Session expired", 401);
  }
  return session;
}

const authed = new Hono<{ Variables: Variables }>();
authed.use("*", async (c, next) => {
  const session = await requireSession(c);
  c.set("session", session);
  await next();
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();
  const password = body.password ?? "";
  if (!timingSafeEqualString(password, getAdminPassword())) {
    throw new HttpError("Invalid password", 401);
  }
  const token = randomSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.adminSession.create({ data: { token, expiresAt } });
  return c.json({ sessionToken: token, expiresAt: expiresAt.getTime() });
});

authed.post("/auth/logout", async (c) => {
  await db.adminSession.delete({ where: { id: c.get("session").id } });
  return c.json(null);
});

authed.get("/auth/me", (c) => {
  return c.json({ expiresAt: c.get("session").expiresAt.getTime() });
});

authed.get("/collectors", async (c) => {
  const rows = await db.collector.findMany({ take: 100, orderBy: { createdAt: "asc" } });
  return c.json(rows.map(collectorDto));
});

authed.post("/collectors", async (c) => {
  const body = await c.req.json<{
    name?: string;
    dayOfWeek?: number | null;
    telegramUserId?: string;
    active?: boolean;
  }>();
  const row = await db.collector.create({
    data: {
      name: normalizeName(body.name ?? ""),
      dayOfWeek: assertDayOfWeek(body.dayOfWeek ?? null),
      telegramUserId: normalizeOptionalTelegram(body.telegramUserId),
      active: body.active ?? true,
    },
  });
  return c.json(row.id);
});

authed.patch("/collectors/:id", async (c) => {
  const id = c.req.param("id");
  await requireCollector(db, id);
  const body = await c.req.json<{
    name?: string;
    dayOfWeek?: number | null;
    telegramUserId?: string;
    active?: boolean;
  }>();
  await db.collector.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: normalizeName(body.name) } : {}),
      ...(body.dayOfWeek !== undefined ? { dayOfWeek: assertDayOfWeek(body.dayOfWeek) } : {}),
      ...(body.telegramUserId !== undefined
        ? { telegramUserId: normalizeOptionalTelegram(body.telegramUserId) ?? null }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  });
  return c.json(null);
});

authed.get("/periods", async (c) => {
  const rows = await db.period.findMany({ orderBy: { startDate: "desc" }, take: 100 });
  return c.json(rows.map(periodDto));
});

authed.get("/periods/open", async (c) => {
  const row = await getOpenPeriod(db);
  return c.json(row ? periodDto(row) : null);
});

authed.post("/periods", async (c) => {
  const body = await c.req.json<{
    startDate?: string;
    endDate?: string;
    storeTotalRub?: number;
    rate?: number;
  }>();
  assertPeriodDates(body.startDate ?? "", body.endDate ?? "");
  const existing = await getOpenPeriod(db);
  if (existing) {
    throw new HttpError("An open period already exists", 409);
  }
  const row = await db.period.create({
    data: {
      startDate: body.startDate ?? "",
      endDate: body.endDate ?? "",
      storeTotalRub: assertStoreTotal(body.storeTotalRub ?? 0),
      rate: assertRate(body.rate ?? 0),
      status: "open",
    },
  });
  return c.json(row.id);
});

authed.post("/periods/:id/close", async (c) => {
  const id = c.req.param("id");
  const period = await requirePeriod(db, id);
  if (period.status === "closed") {
    throw new HttpError("Period is already closed");
  }
  await db.period.update({ where: { id }, data: { status: "closed" } });
  return c.json(null);
});

authed.get("/dashboard/:periodId", async (c) => {
  return c.json(await getDashboard(db, c.req.param("periodId")));
});

authed.get("/entries/pending", async (c) => {
  const periodId = c.req.query("periodId");
  if (!periodId) {
    throw new HttpError("periodId is required");
  }
  const rows = await db.entry.findMany({
    where: { periodId, status: "pending" },
    take: 200,
    orderBy: { date: "asc" },
  });
  const items = [];
  for (const row of rows) {
    const collector = await db.collector.findUnique({ where: { id: row.collectorId } });
    items.push(pendingDto(row, collector?.name ?? "Unknown"));
  }
  return c.json(items);
});

authed.post("/entries/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ kg?: number }>();
  const entry = await db.entry.findUnique({ where: { id } });
  if (!entry) {
    throw new HttpError("Entry not found", 404);
  }
  if (entry.status !== "pending") {
    throw new HttpError("Entry is not pending review");
  }
  await requireOpenPeriod(db, entry.periodId);
  await db.entry.update({
    where: { id },
    data: {
      kg: assertPositiveKg(body.kg ?? 0),
      status: "confirmed",
      confirmedAt: new Date(),
    },
  });
  return c.json(null);
});

authed.post("/entries/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ note?: string }>().catch(() => ({ note: undefined }));
  const entry = await db.entry.findUnique({ where: { id } });
  if (!entry) {
    throw new HttpError("Entry not found", 404);
  }
  if (entry.status !== "pending") {
    throw new HttpError("Entry is not pending review");
  }
  await requireOpenPeriod(db, entry.periodId);
  await db.entry.update({
    where: { id },
    data: { status: "rejected", note: body.note },
  });
  return c.json(null);
});

authed.post("/entries/manual", async (c) => {
  const body = await c.req.json<{
    periodId?: string;
    collectorId?: string;
    date?: string;
    kg?: number;
    note?: string;
  }>();
  const periodId = body.periodId ?? "";
  const collectorId = body.collectorId ?? "";
  await requireOpenPeriod(db, periodId);
  await requireCollector(db, collectorId);
  assertDate(body.date ?? "");
  const row = await db.entry.create({
    data: {
      periodId,
      collectorId,
      date: body.date ?? "",
      kg: assertPositiveKg(body.kg ?? 0),
      source: "manual",
      status: "confirmed",
      note: body.note,
      confirmedAt: new Date(),
    },
  });
  return c.json(row.id);
});

authed.post("/entries/credit", async (c) => {
  const body = await c.req.json<{
    periodId?: string;
    collectorId?: string;
    creditedByCollectorId?: string;
    date?: string;
    kg?: number;
    note?: string;
  }>();
  const periodId = body.periodId ?? "";
  const collectorId = body.collectorId ?? "";
  const creditedByCollectorId = body.creditedByCollectorId ?? "";
  if (collectorId === creditedByCollectorId) {
    throw new HttpError("creditedByCollectorId must be a different collector");
  }
  await requireOpenPeriod(db, periodId);
  await requireCollector(db, collectorId);
  await requireCollector(db, creditedByCollectorId);
  assertDate(body.date ?? "");
  const row = await db.entry.create({
    data: {
      periodId,
      collectorId,
      creditedByCollectorId,
      date: body.date ?? "",
      kg: assertPositiveKg(body.kg ?? 0),
      source: "manual",
      status: "confirmed",
      note: body.note,
      confirmedAt: new Date(),
    },
  });
  return c.json(row.id);
});

authed.get("/history", async (c) => {
  const periodId = c.req.query("periodId");
  if (!periodId) {
    throw new HttpError("periodId is required");
  }
  const rows = await db.entry.findMany({
    where: { periodId, status: "confirmed" },
    take: 500,
  });
  const items = [];
  for (const row of rows) {
    if (row.kg === null) {
      continue;
    }
    const collector = await db.collector.findUnique({ where: { id: row.collectorId } });
    const creditedBy = row.creditedByCollectorId
      ? await db.collector.findUnique({ where: { id: row.creditedByCollectorId } })
      : null;
    items.push({
      _id: row.id,
      date: row.date,
      kg: row.kg,
      source: row.source,
      collectorId: row.collectorId,
      collectorName: collector?.name ?? "Unknown",
      creditedByCollectorId: row.creditedByCollectorId ?? undefined,
      creditedByName: creditedBy?.name,
      note: row.note ?? undefined,
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return c.json(items);
});

authed.get("/payments", async (c) => {
  const periodId = c.req.query("periodId");
  if (!periodId) {
    throw new HttpError("periodId is required");
  }
  const period = await requirePeriod(db, periodId);
  const entries = await db.entry.findMany({
    where: { periodId, status: "confirmed" },
    take: 500,
  });
  const kgByCollector = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kg === null) {
      continue;
    }
    kgByCollector.set(entry.collectorId, (kgByCollector.get(entry.collectorId) ?? 0) + entry.kg);
  }
  const payments = await db.payment.findMany({ where: { periodId }, take: 200 });
  const paymentByCollector = new Map(payments.map((payment) => [payment.collectorId, payment]));
  const rows = [];
  for (const [collectorId, kg] of kgByCollector) {
    const collector = await db.collector.findUnique({ where: { id: collectorId } });
    const payment = paymentByCollector.get(collectorId);
    rows.push({
      collectorId,
      collectorName: collector?.name ?? "Unknown",
      kg,
      amountRub: kg * period.rate,
      paidAt: payment?.paidAt?.getTime() ?? null,
      paymentId: payment?.id ?? null,
      hasTelegram: Boolean(collector?.telegramUserId),
    });
  }
  rows.sort((a, b) => a.collectorName.localeCompare(b.collectorName, "ru"));
  return c.json(rows);
});

authed.post("/payments/mark-paid", async (c) => {
  const body = await c.req.json<{ periodId?: string; collectorId?: string }>();
  const periodId = body.periodId ?? "";
  const collectorId = body.collectorId ?? "";
  const period = await requirePeriod(db, periodId);
  await requireCollector(db, collectorId);
  const entries = await db.entry.findMany({
    where: { periodId, status: "confirmed", collectorId },
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
  const amountRub = kg * period.rate;
  const row = await db.payment.upsert({
    where: { periodId_collectorId: { periodId, collectorId } },
    update: { amountRub, paidAt: new Date() },
    create: { periodId, collectorId, amountRub, paidAt: new Date() },
  });
  return c.json(row.id);
});

authed.get("/settings", async (c) => {
  const row = await getSettings(db);
  return c.json(row ? settingsDto(row) : null);
});

authed.put("/settings", async (c) => {
  const body = await c.req.json<{
    bank?: string;
    payTo?: string;
    deadlineText?: string;
    windowStart?: number;
    windowEnd?: number;
    groupChatId?: string;
  }>();
  const bank = (body.bank ?? "").trim();
  const payTo = (body.payTo ?? "").trim();
  const deadlineText = (body.deadlineText ?? "").trim();
  if (bank.length < 1 || payTo.length < 1 || deadlineText.length < 1) {
    throw new HttpError("Bank, payTo and deadlineText are required");
  }
  const windowStart = assertWindowHour(body.windowStart ?? 0, "windowStart");
  const windowEnd = assertWindowHour(body.windowEnd ?? 0, "windowEnd");
  if (windowStart >= windowEnd) {
    throw new HttpError("windowStart must be before windowEnd");
  }
  const groupChatId =
    body.groupChatId !== undefined ? body.groupChatId.trim() || null : undefined;
  await db.settings.upsert({
    where: { key: "default" },
    update: {
      bank,
      payTo,
      deadlineText,
      windowStart,
      windowEnd,
      ...(groupChatId !== undefined ? { groupChatId } : {}),
    },
    create: {
      key: "default",
      bank,
      payTo,
      deadlineText,
      windowStart,
      windowEnd,
      groupChatId: groupChatId ?? null,
    },
  });
  return c.json(null);
});

authed.get("/telegram", async (c) => {
  return c.json(await getTelegramStatus());
});

authed.put("/telegram/bot", async (c) => {
  const body = await c.req.json<{ botToken?: string; miniAppUrl?: string }>();
  const current = await getSettings(db);
  let botToken = current?.botToken ?? null;
  if (typeof body.botToken === "string" && body.botToken.trim().length > 0) {
    await fetchBotIdentity(body.botToken.trim());
    botToken = body.botToken.trim();
  }
  const miniAppUrl =
    body.miniAppUrl === undefined
      ? (current?.miniAppUrl ?? null)
      : body.miniAppUrl.trim()
        ? assertMiniAppUrl(body.miniAppUrl)
        : null;
  await patchDefaultSettings(db, { botToken, miniAppUrl });
  await restartBot();
  return c.json(await getTelegramStatus());
});

authed.post("/telegram/bot/clear", async (c) => {
  await patchDefaultSettings(db, { botToken: null });
  await restartBot();
  return c.json(await getTelegramStatus());
});

authed.put("/telegram/chat", async (c) => {
  const body = await c.req.json<{ groupChatId?: string }>();
  const groupChatId = assertGroupChatId(body.groupChatId ?? "");
  const token = await getBotToken();
  const groupChatTitle = await fetchChatTitle(token, groupChatId);
  await patchDefaultSettings(db, { groupChatId, groupChatTitle });
  return c.json(await getTelegramStatus());
});

authed.post("/telegram/chat/unlink", async (c) => {
  await patchDefaultSettings(db, { groupChatId: null, groupChatTitle: null });
  return c.json(await getTelegramStatus());
});

authed.post("/telegram/test", async (c) => {
  const settings = await getSettings(db);
  const chatId = settings?.groupChatId;
  if (!chatId) {
    throw new HttpError("Group chat is not linked");
  }
  await sendTelegramMessage(
    chatId,
    "Бот сборщиков привязан. Сообщения из админки будут приходить сюда.",
  );
  return c.json(null);
});

authed.get("/messages/summary", async (c) => {
  const periodId = c.req.query("periodId");
  if (!periodId) {
    throw new HttpError("periodId is required");
  }
  return c.json(await buildSummary(db, periodId));
});

authed.post("/messages/summary/send", async (c) => {
  const body = await c.req.json<{ periodId?: string }>();
  const periodId = body.periodId ?? "";
  const settings = await getSettings(db);
  const chatId = settings?.groupChatId;
  if (!chatId) {
    throw new HttpError("Group chat is not linked");
  }
  const summary = await buildSummary(db, periodId);
  await sendTelegramMessage(chatId, summary.text);
  return c.json(null);
});

authed.get("/messages/remind", async (c) => {
  const periodId = c.req.query("periodId");
  const collectorId = c.req.query("collectorId");
  const kind = assertReminderKind(c.req.query("kind") ?? "");
  if (!periodId || !collectorId) {
    throw new HttpError("periodId and collectorId are required");
  }
  const reminder = await buildReminder(db, periodId, collectorId, kind);
  return c.json({
    text: reminder.text,
    canSend: Boolean(reminder.chatId),
  });
});

authed.post("/messages/remind", async (c) => {
  const body = await c.req.json<{
    periodId?: string;
    collectorId?: string;
    kind?: string;
  }>();
  const periodId = body.periodId ?? "";
  const collectorId = body.collectorId ?? "";
  const kind = assertReminderKind(body.kind ?? "");
  const reminder = await buildReminder(db, periodId, collectorId, kind);
  if (!reminder.chatId) {
    throw new HttpError("Collector has no Telegram ID");
  }
  await sendTelegramMessage(reminder.chatId, reminder.text);
  return c.json(null);
});

const mini = new Hono<{ Variables: MiniVariables }>();
mini.use("*", async (c, next) => {
  const header = c.req.header("Authorization");
  const initData = header?.startsWith("tma ") ? header.slice(4) : undefined;
  const user = verifyTelegramInitData(initData, await getBotToken());
  const collector = await db.collector.findFirst({
    where: { telegramUserId: String(user.id) },
  });
  c.set("telegramUserId", String(user.id));
  c.set("firstName", user.firstName);
  c.set("collector", collector);
  await next();
});

mini.get("/home", async (c) => {
  return c.json(
    await getMiniHome(
      db,
      { id: Number(c.get("telegramUserId")), firstName: c.get("firstName") },
      Date.now(),
    ),
  );
});

mini.post("/entries/manual", async (c) => {
  const collector = requireActiveCollector(c.get("collector"));
  const body = await c.req.json<{ date?: string; kg?: number; note?: string }>();
  const id = await createCollectorManualEntry(db, collector, {
    date: body.date ?? "",
    kg: body.kg ?? 0,
    note: body.note,
  });
  return c.json(id);
});

mini.post("/entries/credit", async (c) => {
  const collector = requireActiveCollector(c.get("collector"));
  const body = await c.req.json<{
    collectorId?: string;
    date?: string;
    kg?: number;
    note?: string;
  }>();
  const id = await createCollectorCreditEntry(db, collector, {
    collectorId: body.collectorId ?? "",
    date: body.date ?? "",
    kg: body.kg ?? 0,
    note: body.note,
  });
  return c.json(id);
});

app.route("/miniapp", mini);
app.route("/", authed);
