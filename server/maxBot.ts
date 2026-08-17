import { Bot, Keyboard, MaxError, type Context } from "@maxhub/max-bot-api";
import type { Attachment, Button } from "@maxhub/max-bot-api/types";
import { db } from "./db";
import { patchDefaultSettings } from "./lib/domain";
import { HttpError } from "./lib/errors";
import { saveInvoicePhotoFromUrl } from "./lib/invoices";
import { ASK_PHONE_TEXT, buildGreetingText, MINI_APP_BUTTON } from "./lib/messages";
import { createInvoiceFromPhoto, findCollectorByMax } from "./lib/miniapp";
import {
  getMaxBotUsername,
  getMiniAppUrl,
  maxMiniAppLink,
  patchMaxRuntime,
  refreshMaxRuntime,
  resolveMaxApiBaseUrl,
  unsubscribeMaxWebhooks,
} from "./lib/max";
import { ensureMaxTrustedCa } from "./lib/maxTls";
import { attachSharedPhone } from "./lib/identity";
import { phoneFromVcf, upsertMaxBotUser } from "./lib/maxUsers";

type OpenAppButton = {
  type: "open_app";
  text: string;
  web_app?: string;
};

function appKeyboard() {
  const url = getMiniAppUrl();
  if (url) {
    const button: OpenAppButton = { type: "open_app", text: MINI_APP_BUTTON, web_app: url };
    return Keyboard.inlineKeyboard([[button as unknown as Button]]);
  }
  const link = maxMiniAppLink(getMaxBotUsername());
  if (!link) {
    return undefined;
  }
  return Keyboard.inlineKeyboard([[Keyboard.button.link(MINI_APP_BUTTON, link)]]);
}

let currentBot: Bot | null = null;
let restartChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function replyToUser(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
): Promise<void> {
  if (ctx.chatId != null) {
    await ctx.reply(text, extra);
    return;
  }
  const userId = ctx.user?.user_id;
  if (userId == null) {
    throw new Error("MAX reply skipped: no chat_id and no user");
  }
  await ctx.api.sendMessageToUser(userId, text, extra);
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function contactKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.requestContact("Поделиться номером")]]);
}

async function rememberUser(user: {
  user_id: number;
  name: string;
  username?: string | null;
}, phone?: string | null) {
  return await upsertMaxBotUser(db, {
    maxUserId: String(user.user_id),
    name: user.name,
    username: user.username,
    phone,
  });
}

async function sendGreeting(ctx: Context): Promise<void> {
  const from = ctx.user;
  if (!from) {
    console.warn("MAX greeting skipped: no user on", ctx.updateType);
    return;
  }
  const saved = await rememberUser(from);
  if (!saved.phone) {
    const collector = await findCollectorByMax(db, String(from.user_id));
    if (collector?.phone) {
      await rememberUser(from, collector.phone);
    } else {
      await replyToUser(ctx, ASK_PHONE_TEXT, { attachments: [contactKeyboard()] });
      return;
    }
  }
  const collector = await findCollectorByMax(db, String(from.user_id));
  const url = getMiniAppUrl();
  const text = buildGreetingText({
    helloName: collector?.name ?? firstName(from.name),
    hasApp: Boolean(url),
    status: collector?.active ? "active" : collector ? "inactive" : "unknown",
    idLabel: "MAX ID",
    id: String(from.user_id),
  });

  const keyboard = appKeyboard();
  await replyToUser(ctx, text, keyboard ? { attachments: [keyboard] } : undefined);
}

async function bindCurrentChat(ctx: Context): Promise<void> {
  const chatId = ctx.chatId;
  const from = ctx.user;
  if (chatId == null || !from) {
    return;
  }
  const chat = await ctx.getChat(chatId);
  if (chat.type === "dialog") {
    await ctx.reply("Отправь /bind в группе, которую нужно привязать к админке.");
    return;
  }
  const admins = await ctx.getChatAdmins();
  const member = admins.members.find((item) => item.user_id === from.user_id);
  if (!member || (!member.is_admin && !member.is_owner)) {
    await ctx.reply("Привязать чат может только администратор группы.");
    return;
  }
  const title = chat.title;
  await patchDefaultSettings(db, {
    maxGroupChatId: String(chat.chat_id),
    maxGroupChatTitle: title,
  });
  await ctx.reply(`Чат «${title ?? chat.chat_id}» привязан к админке сборщиков.`);
}

function invoiceImageUrl(attachments: Attachment[] | null | undefined): string | undefined {
  if (!attachments) {
    return undefined;
  }
  for (const item of attachments) {
    if (item.type === "image") {
      return item.payload.url;
    }
    if (item.type === "file") {
      const name = item.filename ?? item.payload.url;
      if (/\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(name)) {
        return item.payload.url;
      }
    }
  }
  return undefined;
}

function isPrivateDialog(ctx: Context): boolean {
  return ctx.message?.recipient.chat_type === "dialog";
}

export function createMaxBot(token: string, apiBaseUrl: string): Bot {
  const bot = new Bot(token, { clientOptions: { baseUrl: apiBaseUrl } });

  bot.on("bot_started", async (ctx) => {
    await sendGreeting(ctx);
  });
  bot.command(/^start(?:@[\w]+)?$/i, async (ctx) => {
    await sendGreeting(ctx);
  });
  bot.command("bind", async (ctx) => {
    await bindCurrentChat(ctx);
  });

  bot.on("bot_added", async (ctx) => {
    if (ctx.update.is_channel) {
      return;
    }
    try {
      await ctx.reply("Чтобы привязать этот чат к админке сборщиков, отправьте /bind");
    } catch {
      // Bot may not be allowed to post yet.
    }
  });

  bot.on("message_created", async (ctx) => {
    if (!isPrivateDialog(ctx)) {
      return;
    }
    const message = ctx.message;
    if (!message) {
      return;
    }
    const from = message.sender;
    if (!from) {
      return;
    }
    const contact = message.body.attachments?.find((item) => item.type === "contact");
    if (contact && contact.type === "contact") {
      const phone = phoneFromVcf(contact.payload.vcf_info);
      const saved = await rememberUser(from, phone);
      if (saved.phone) {
        await attachSharedPhone(db, {
          platform: "max",
          userId: String(from.user_id),
          phone: saved.phone,
        });
      }
      if (!saved.phone) {
        await ctx.reply(
          "Контакт получен, но номер из него не прочитался. Нажми «Поделиться номером» ещё раз.",
          { attachments: [contactKeyboard()] },
        );
        return;
      }
      await sendGreeting(ctx);
      return;
    }
    await rememberUser(from);
    const imageUrl = invoiceImageUrl(message.body.attachments);
    if (imageUrl) {
      try {
        const photoRef = await saveInvoicePhotoFromUrl(imageUrl);
        const result = await createInvoiceFromPhoto(db, String(from.user_id), photoRef, Date.now(), "max");
        const url = getMiniAppUrl();
        const text = `Накладная за ${result.date.slice(8, 10)}.${result.date.slice(5, 7)} ушла на проверку. Открой приложение, чтобы видеть статус.`;
        const keyboard = appKeyboard();
        await ctx.reply(text, url && keyboard ? { attachments: [keyboard] } : undefined);
      } catch (err) {
        const messageText = err instanceof HttpError ? err.message : "Не удалось принять фото";
        if (messageText === "Not a collector") {
          await ctx.reply(
            `Тебя нет в списке участников. Покажи организатору свой MAX ID: ${from.user_id}`,
          );
          return;
        }
        if (messageText === "Collector is inactive") {
          await ctx.reply("Ты скрыт в списке участников — напиши организатору.");
          return;
        }
        if (messageText === "Period not found" || messageText === "Period is closed") {
          await ctx.reply("Сейчас нет открытого периода — подожди организатора.");
          return;
        }
        if (messageText === "Date is outside the open period") {
          await ctx.reply("Сегодняшняя дата не входит в текущий период.");
          return;
        }
        if (messageText === "This day was already submitted by another collector") {
          const name =
            err instanceof HttpError &&
            typeof err.details?.collectorName === "string" &&
            err.details.collectorName.trim().length > 0
              ? err.details.collectorName.trim()
              : undefined;
          await ctx.reply(
            name
              ? `За этот день уже внёс ${name}. Вторая сдача от другого участника не принимается.`
              : "За этот день уже внёс другой участник.",
          );
          return;
        }
        console.error(err);
        await ctx.reply("Не удалось принять фото. Попробуй ещё раз или открой приложение.");
      }
      return;
    }
    const text = message.body.text?.trim() ?? "";
    if (!text || text.startsWith("/")) {
      if (/^\/start(?:@[\w]+)?$/i.test(text)) {
        await sendGreeting(ctx);
      }
      return;
    }
    await sendGreeting(ctx);
  });

  bot.catch((err) => {
    if (err instanceof MaxError) {
      console.error("MAX bot error", err.status, err.description);
      return;
    }
    console.error("MAX bot error", err);
  });

  return bot;
}

async function stopCurrentBot(): Promise<void> {
  const previous = currentBot;
  currentBot = null;
  patchMaxRuntime({ botRunning: false });
  if (!previous) {
    return;
  }
  try {
    previous.stop();
  } catch (err) {
    console.error("Failed to stop MAX bot", err);
  }
}

async function restartMaxBotInner(): Promise<void> {
  ensureMaxTrustedCa();
  await stopCurrentBot();
  const next = await refreshMaxRuntime();
  const token = next.botToken;
  if (!token) {
    patchMaxRuntime({ botUsername: null, botName: null, botRunning: false });
    console.warn("MAX_BOT_TOKEN is not set — MAX bot is skipped");
    return;
  }
  const bot = createMaxBot(token, await resolveMaxApiBaseUrl());
  currentBot = bot;
  try {
    await unsubscribeMaxWebhooks(token);
  } catch (err) {
    console.warn("MAX webhook unsubscribe failed", err);
  }
  try {
    await bot.api.setMyCommands([
      { name: "start", description: "Открыть бота сборщиков" },
    ]);
  } catch (err) {
    console.error("Failed to set MAX bot commands", err);
  }
  try {
    const me = await bot.api.getMyInfo();
    const username = me.username?.replace(/^@/, "") || null;
    patchMaxRuntime({
      botUsername: username,
      botName: me.name || username,
      botRunning: true,
    });
  } catch (err) {
    currentBot = null;
    patchMaxRuntime({ botUsername: null, botName: null, botRunning: false });
    throw err;
  }

  void keepPolling(bot);
}

async function keepPolling(bot: Bot): Promise<void> {
  while (currentBot === bot) {
    try {
      await bot.start();
    } catch (err) {
      console.error("MAX bot polling error", err);
    }
    if (currentBot !== bot) {
      return;
    }
    try {
      bot.stop();
    } catch {
      // Polling may already have exited.
    }
    patchMaxRuntime({ botRunning: false });
    console.warn("MAX bot polling stopped, retrying in 5s");
    await sleep(5000);
    if (currentBot !== bot) {
      return;
    }
    patchMaxRuntime({ botRunning: true });
  }
}

export function restartMaxBot(): Promise<void> {
  restartChain = restartChain.then(
    () => restartMaxBotInner(),
    () => restartMaxBotInner(),
  );
  return restartChain;
}

export function stopMaxBot(): Promise<void> {
  restartChain = restartChain.then(
    () => stopCurrentBot(),
    () => stopCurrentBot(),
  );
  return restartChain;
}

export async function startMaxBot(): Promise<void> {
  await restartMaxBot();
}
