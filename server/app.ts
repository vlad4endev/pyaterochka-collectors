import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AdminSession, Collector } from "@prisma/client";
import { db } from "./db";
import { getDashboard } from "./lib/dashboard";
import {
  assertDayOfWeek,
  assertPeriodDates,
  assertPositiveKg,
  assertRate,
  assertStoreTotal,
  assertWindowHour,
  getOpenPeriod,
  getSettings,
  ensureCurrentWeekPeriod,
  patchDefaultSettings,
  normalizeName,
  normalizeOptionalTelegram,
  requireCollector,
  requireCollectorUnpaid,
  requirePeriod,
  requirePreviousWeekPeriod,
  requireUnsettledPeriod,
  assertDateInPeriod,
  currentMoscowWeek,
  entryPayeeId,
  patchPeriod,
} from "./lib/domain";
import { collectorDto, pendingDto, periodDto, settingsDto } from "./lib/dto";
import {
  getAdminPassword,
  HttpError,
  randomSessionToken,
  timingSafeEqualString,
} from "./lib/errors";
import { assertReminderKind, buildReminder, buildSummary, sendSettlementInvoices } from "./lib/messages";
import { createPeriodSettlement, getPeriodSettlement, markCollectorPaid, syncUnpaidCollectorPayment } from "./lib/payments";
import { loadInvoicePhoto, saveInvoicePhoto } from "./lib/invoices";
import {
  createCollectorCreditEntry,
  createCollectorManualEntry,
  getMiniHome,
  requireActiveCollector,
  skipCollectorDayInPeriod,
  skipOwnScheduledDay,
  submitCollectorReport,
  type MiniAppPlatform,
} from "./lib/miniapp";
import { restartBot } from "./bot";
import { restartMaxBot } from "./maxBot";
import {
  assertGroupChatId,
  assertMiniAppUrl,
  fetchBotIdentity,
  fetchChatTitle,
  getBotToken,
  getTelegramStatus,
  checkTelegramPath,
  sendTelegramMessage,
  verifyTelegramInitData,
} from "./lib/telegram";
import {
  fetchMaxBotIdentity,
  fetchMaxChatTitle,
  getMaxBotToken,
  getMaxStatus,
  patchMaxRuntime,
  sendMaxMessage,
  verifyMaxInitData,
} from "./lib/max";
import { assertTelegramProxyConfig } from "./lib/telegramProxy";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Variables = { session: AdminSession };

type MiniVariables = {
  platform: MiniAppPlatform;
  userId: string;
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
    return c.json(
      err.details ? { error: err.message, details: err.details } : { error: err.message },
      err.status,
    );
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
    maxUserId?: string;
    active?: boolean;
  }>();
  const row = await db.collector.create({
    data: {
      name: normalizeName(body.name ?? ""),
      dayOfWeek: assertDayOfWeek(body.dayOfWeek ?? null),
      telegramUserId: normalizeOptionalTelegram(body.telegramUserId),
      maxUserId: normalizeOptionalTelegram(body.maxUserId),
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
    maxUserId?: string;
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
      ...(body.maxUserId !== undefined
        ? { maxUserId: normalizeOptionalTelegram(body.maxUserId) ?? null }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  });
  return c.json(null);
});

authed.get("/periods", async (c) => {
  await ensureCurrentWeekPeriod(db);
  const latest = currentMoscowWeek(Date.now()).endDate;
  const rows = await db.period.findMany({
    where: { startDate: { lte: latest } },
    orderBy: { startDate: "desc" },
    take: 100,
  });
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
  if ((body.startDate ?? "") > currentMoscowWeek(Date.now()).endDate) {
    throw new HttpError("Cannot change a future period");
  }
  if ((body.endDate ?? "") > currentMoscowWeek(Date.now()).endDate) {
    throw new HttpError("Cannot change a future period");
  }
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

authed.patch("/periods/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    startDate?: string;
    endDate?: string;
    storeTotalRub?: number;
    rate?: number;
  }>();
  await patchPeriod(db, id, body);
  return c.json(null);
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
    const creditedBy = row.creditedByCollectorId
      ? await db.collector.findUnique({ where: { id: row.creditedByCollectorId } })
      : null;
    items.push({
      ...pendingDto(row, collector?.name ?? "Unknown"),
      creditedByName: creditedBy?.name,
      hasPhoto: Boolean(row.telegramFileId),
    });
  }
  return c.json(items);
});

authed.get("/entries/:id/photo", async (c) => {
  const entry = await db.entry.findUnique({ where: { id: c.req.param("id") } });
  if (!entry?.telegramFileId) {
    throw new HttpError("Photo not found", 404);
  }
  const photo = await loadInvoicePhoto(entry.telegramFileId);
  return c.body(new Uint8Array(photo.bytes), 200, {
    "Content-Type": photo.contentType,
    "Cache-Control": "private, max-age=300",
  });
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
  await requireUnsettledPeriod(db, entry.periodId);
  const payeeId = entryPayeeId(entry);
  await requireCollectorUnpaid(db, entry.periodId, payeeId);
  await db.entry.update({
    where: { id },
    data: {
      kg: assertPositiveKg(body.kg ?? 0),
      status: "confirmed",
      confirmedAt: new Date(),
    },
  });
  await syncUnpaidCollectorPayment(db, entry.periodId, payeeId);
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
  await requireUnsettledPeriod(db, entry.periodId);
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
  const period = await requireUnsettledPeriod(db, periodId);
  await requireCollectorUnpaid(db, periodId, collectorId);
  const date = assertDateInPeriod(body.date ?? "", period.startDate, period.endDate);
  const row = await db.entry.create({
    data: {
      periodId,
      collectorId,
      date,
      kg: assertPositiveKg(body.kg ?? 0),
      source: "manual",
      status: "confirmed",
      note: body.note,
      confirmedAt: new Date(),
    },
  });
  await syncUnpaidCollectorPayment(db, periodId, collectorId);
  return c.json(row.id);
});

authed.post("/entries/skip", async (c) => {
  const body = await c.req.json<{
    periodId?: string;
    collectorId?: string;
    date?: string;
  }>();
  const id = await skipCollectorDayInPeriod(
    db,
    body.periodId ?? "",
    body.collectorId ?? "",
    body.date ?? "",
  );
  return c.json(id);
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
  const period = await requireUnsettledPeriod(db, periodId);
  await requireCollector(db, collectorId);
  await requireCollectorUnpaid(db, periodId, creditedByCollectorId);
  const date = assertDateInPeriod(body.date ?? "", period.startDate, period.endDate);
  const row = await db.entry.create({
    data: {
      periodId,
      collectorId,
      creditedByCollectorId,
      date,
      kg: assertPositiveKg(body.kg ?? 0),
      source: "manual",
      status: "confirmed",
      note: body.note,
      confirmedAt: new Date(),
    },
  });
  await syncUnpaidCollectorPayment(db, periodId, creditedByCollectorId);
  return c.json(row.id);
});

authed.get("/history", async (c) => {
  const periodId = c.req.query("periodId");
  if (!periodId) {
    throw new HttpError("periodId is required");
  }
  const rows = await db.entry.findMany({
    where: { periodId, status: { in: ["confirmed", "skipped"] } },
    take: 500,
  });
  const items = [];
  for (const row of rows) {
    if (row.status === "confirmed" && row.kg === null) {
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
      status: row.status,
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
  const settlement = await getPeriodSettlement(db, periodId);
  return c.json(settlement.rows);
});

authed.get("/payments/settlement", async (c) => {
  try {
    const period = await requirePreviousWeekPeriod(db);
    const existing = await db.payment.findFirst({ where: { periodId: period.id } });
    if (!existing) {
      return c.json(null);
    }
    return c.json(await getPeriodSettlement(db, period.id));
  } catch (err) {
    if (err instanceof HttpError && err.message === "Previous period not found") {
      return c.json(null);
    }
    throw err;
  }
});

authed.get("/payments/settlement/preview", async (c) => {
  try {
    const period = await requirePreviousWeekPeriod(db);
    return c.json(await getPeriodSettlement(db, period.id));
  } catch (err) {
    if (err instanceof HttpError && err.message === "Previous period not found") {
      return c.json(null);
    }
    throw err;
  }
});

authed.post("/payments/calculate", async (c) => {
  const body = await c.req.json<{ storeKg?: number; storeTotalRub?: number }>();
  const period = await requirePreviousWeekPeriod(db);
  const settlement = await createPeriodSettlement(db, period.id, {
    kg: body.storeKg ?? 0,
    totalRub: body.storeTotalRub ?? 0,
  });
  const settings = await getSettings(db);
  const summary = settings ? await buildSummary(db, period.id) : { text: "" };
  const invoices = await sendSettlementInvoices(db, period.id);
  return c.json({ ...settlement, text: summary.text, invoices });
});

authed.post("/payments/mark-paid", async (c) => {
  const body = await c.req.json<{ periodId?: string; collectorId?: string }>();
  const periodId = body.periodId ?? "";
  const collectorId = body.collectorId ?? "";
  if (!periodId || !collectorId) {
    throw new HttpError("periodId and collectorId are required");
  }
  const result = await markCollectorPaid(db, periodId, collectorId);
  return c.json(result);
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
  try {
    await restartBot();
  } catch (err) {
    console.error("Bot restart failed", err);
  }
  await checkTelegramPath();
  return c.json(await getTelegramStatus());
});

authed.post("/telegram/bot/clear", async (c) => {
  await patchDefaultSettings(db, { botToken: null });
  try {
    await restartBot();
  } catch (err) {
    console.error("Bot restart after token clear failed", err);
  }
  await checkTelegramPath();
  return c.json(await getTelegramStatus());
});

authed.put("/telegram/proxy", async (c) => {
  const body = await c.req.json<{
    type?: string;
    host?: string;
    port?: number | string;
    username?: string;
    password?: string;
  }>();
  const current = await getSettings(db);
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!type || type === "none") {
    await patchDefaultSettings(db, {
      proxyType: null,
      proxyHost: null,
      proxyPort: null,
      proxyUsername: null,
      proxyPassword: null,
    });
    try {
      await restartBot();
    } catch (err) {
      console.error("Bot restart after proxy disable failed", err);
    }
    await checkTelegramPath();
    return c.json(await getTelegramStatus());
  }
  const portRaw = body.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : typeof portRaw === "string" && portRaw.trim().length > 0
        ? Number(portRaw.trim())
        : Number.NaN;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const incomingPassword = typeof body.password === "string" ? body.password : "";
  const password =
    incomingPassword.length > 0 ? incomingPassword : (current?.proxyPassword ?? null);
  const config = assertTelegramProxyConfig({
    type,
    host: typeof body.host === "string" ? body.host : "",
    port,
    username: username || null,
    password: username ? password : null,
  });
  await patchDefaultSettings(db, {
    proxyType: config.type,
    proxyHost: config.host,
    proxyPort: config.port,
    proxyUsername: config.username,
    proxyPassword: config.password,
  });
  try {
    await restartBot();
  } catch (err) {
    console.error("Bot restart after proxy change failed", err);
  }
  await checkTelegramPath();
  return c.json(await getTelegramStatus());
});

authed.post("/telegram/proxy/check", async (c) => {
  await checkTelegramPath();
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

authed.get("/max", async (c) => {
  return c.json(await getMaxStatus());
});

authed.put("/max/bot", async (c) => {
  const body = await c.req.json<{ botToken?: string; miniAppUrl?: string }>();
  const current = await getSettings(db);
  let maxBotToken = current?.maxBotToken ?? null;
  if (typeof body.botToken === "string" && body.botToken.trim().length > 0) {
    const identity = await fetchMaxBotIdentity(body.botToken.trim());
    maxBotToken = body.botToken.trim();
    patchMaxRuntime({ botUsername: identity.username, botName: identity.name });
  } else if (!maxBotToken && !process.env.MAX_BOT_TOKEN?.trim()) {
    throw new HttpError("MAX bot token is required");
  }
  const miniAppUrl =
    body.miniAppUrl === undefined
      ? (current?.miniAppUrl ?? null)
      : body.miniAppUrl.trim()
        ? assertMiniAppUrl(body.miniAppUrl)
        : null;
  await patchDefaultSettings(db, { maxBotToken, miniAppUrl });
  await restartMaxBot();
  await restartBot();
  return c.json(await getMaxStatus());
});

authed.post("/max/bot/check", async (c) => {
  let body: { botToken?: string } = {};
  try {
    body = await c.req.json<{ botToken?: string }>();
  } catch {
    body = {};
  }
  const candidate = typeof body.botToken === "string" ? body.botToken.trim() : "";
  const token = candidate || (await getMaxBotToken());
  const me = await fetchMaxBotIdentity(token);
  return c.json({ ok: true, name: me.name, username: me.username });
});

authed.post("/max/bot/clear", async (c) => {
  await patchDefaultSettings(db, { maxBotToken: null });
  await restartMaxBot();
  return c.json(await getMaxStatus());
});

authed.put("/max/chat", async (c) => {
  const body = await c.req.json<{ groupChatId?: string }>();
  const groupChatId = assertGroupChatId(body.groupChatId ?? "");
  const token = await getMaxBotToken();
  const groupChatTitle = await fetchMaxChatTitle(token, groupChatId);
  await patchDefaultSettings(db, { maxGroupChatId: groupChatId, maxGroupChatTitle: groupChatTitle });
  return c.json(await getMaxStatus());
});

authed.post("/max/chat/unlink", async (c) => {
  await patchDefaultSettings(db, { maxGroupChatId: null, maxGroupChatTitle: null });
  return c.json(await getMaxStatus());
});

authed.post("/max/test", async (c) => {
  const settings = await getSettings(db);
  const chatId = settings?.maxGroupChatId;
  if (!chatId) {
    throw new HttpError("MAX group chat is not linked");
  }
  await sendMaxMessage(
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
  const telegramChatId = settings?.groupChatId;
  const maxChatId = settings?.maxGroupChatId;
  if (!telegramChatId && !maxChatId) {
    throw new HttpError("Group chat is not linked");
  }
  const summary = await buildSummary(db, periodId);
  if (telegramChatId) {
    await sendTelegramMessage(telegramChatId, summary.text);
  }
  if (maxChatId) {
    await sendMaxMessage(maxChatId, summary.text);
  }
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
    canSend: Boolean(reminder.telegramChatId || reminder.maxChatId),
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
  if (!reminder.telegramChatId && !reminder.maxChatId) {
    throw new HttpError("Collector has no messenger ID");
  }
  if (reminder.telegramChatId) {
    await sendTelegramMessage(reminder.telegramChatId, reminder.text);
  }
  if (reminder.maxChatId) {
    await sendMaxMessage(reminder.maxChatId, reminder.text);
  }
  return c.json(null);
});

const mini = new Hono<{ Variables: MiniVariables }>();
mini.use("*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  if (header.startsWith("max ")) {
    const user = verifyMaxInitData(header.slice(4), await getMaxBotToken());
    const collector = await db.collector.findFirst({
      where: { maxUserId: String(user.id) },
    });
    c.set("platform", "max");
    c.set("userId", String(user.id));
    c.set("firstName", user.firstName);
    c.set("collector", collector);
    await next();
    return;
  }
  const initData = header.startsWith("tma ") ? header.slice(4) : undefined;
  const user = verifyTelegramInitData(initData, await getBotToken());
  const collector = await db.collector.findFirst({
    where: { telegramUserId: String(user.id) },
  });
  c.set("platform", "telegram");
  c.set("userId", String(user.id));
  c.set("firstName", user.firstName);
  c.set("collector", collector);
  await next();
});

mini.get("/home", async (c) => {
  return c.json(
    await getMiniHome(
      db,
      {
        id: Number(c.get("userId")),
        firstName: c.get("firstName"),
        platform: c.get("platform"),
      },
      Date.now(),
    ),
  );
});

function isUploadFile(value: unknown): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

async function readMiniReport(c: { req: { header: (name: string) => string | undefined; json: <T>() => Promise<T>; parseBody: () => Promise<Record<string, string | File>> } }) {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const parsed = await c.req.parseBody();
    const kgRaw = typeof parsed.kg === "string" ? parsed.kg.trim() : "";
    return {
      date: typeof parsed.date === "string" ? parsed.date : "",
      kg: kgRaw.length > 0 ? Number(kgRaw) : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
      forCollectorId: typeof parsed.collectorId === "string" ? parsed.collectorId : undefined,
      photo: isUploadFile(parsed.photo) ? parsed.photo : undefined,
    };
  }
  const body = await c.req.json<{
    date?: string;
    kg?: number;
    note?: string;
    collectorId?: string;
  }>();
  return {
    date: body.date ?? "",
    kg: body.kg,
    note: body.note,
    forCollectorId: body.collectorId,
    photo: undefined,
  };
}

mini.post("/entries", async (c) => {
  const collector = requireActiveCollector(c.get("collector"));
  const body = await readMiniReport(c);
  const photoRef = body.photo ? await saveInvoicePhoto(body.photo) : undefined;
  const id = await submitCollectorReport(db, collector, {
    date: body.date,
    kg: body.kg,
    note: body.note,
    forCollectorId: body.forCollectorId,
    photoRef,
  });
  return c.json(id);
});

mini.post("/entries/skip", async (c) => {
  const collector = requireActiveCollector(c.get("collector"));
  const body = await c.req.json<{ date?: string }>();
  const id = await skipOwnScheduledDay(db, collector, body.date ?? "");
  return c.json(id);
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
