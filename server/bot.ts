import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { db } from "./db";
import { patchDefaultSettings } from "./lib/domain";
import {
  botIntakeReply,
  collectorSubmitErrorText,
  intakeBotPhoto,
  intakeBotText,
} from "./lib/botIntake";
import { persistTelegramPhoto } from "./lib/invoices";
import { ASK_PHONE_TEXT, buildGreetingText, MINI_APP_BUTTON } from "./lib/messages";
import { attachSharedPhone } from "./lib/identity";
import { findCollectorByTelegram } from "./lib/miniapp";
import {
  getMiniAppUrl,
  getTelegramProxyAgent,
  patchTelegramRuntime,
  refreshTelegramRuntime,
} from "./lib/telegram";
import { upsertTelegramBotUser } from "./lib/telegramUsers";

let currentBot: Bot | null = null;
let restartChain: Promise<void> = Promise.resolve();

function inlineAppButton(url: string): InlineKeyboard {
  return new InlineKeyboard().webApp(MINI_APP_BUTTON, url);
}

function replyAppKeyboard(url: string): Keyboard {
  return new Keyboard().webApp(MINI_APP_BUTTON, url).resized().persistent();
}

function phoneKeyboard(): Keyboard {
  return new Keyboard().requestContact("Поделиться номером").resized().oneTime();
}

async function rememberTelegramUser(
  from: { id: number; first_name: string; last_name?: string; username?: string },
  phone?: string | null,
) {
  return await upsertTelegramBotUser(db, {
    telegramUserId: String(from.id),
    name: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.first_name,
    username: from.username,
    phone,
  });
}

async function askPhone(ctx: Context): Promise<void> {
  await ctx.reply(ASK_PHONE_TEXT, { reply_markup: phoneKeyboard() });
}

async function sendGreeting(ctx: Context, withPersistentButton = false): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }
  const collector = await findCollectorByTelegram(db, String(from.id));
  const url = getMiniAppUrl();
  const text = buildGreetingText({
    helloName: collector?.name ?? from.first_name,
    hasApp: Boolean(url),
    status: collector?.active ? "active" : collector ? "inactive" : "unknown",
    idLabel: "Telegram ID",
    id: String(from.id),
  });

  if (!url) {
    await ctx.reply(text);
    return;
  }
  if (withPersistentButton) {
    await ctx.reply(text, { reply_markup: replyAppKeyboard(url) });
  }
  await ctx.reply(withPersistentButton ? MINI_APP_BUTTON : text, {
    reply_markup: inlineAppButton(url),
  });
}

async function greetOrAskPhone(ctx: Context, withPersistentButton = false): Promise<void> {
  const from = ctx.from;
  if (!from || ctx.chat?.type !== "private") {
    await sendGreeting(ctx, withPersistentButton);
    return;
  }
  const saved = await rememberTelegramUser(from);
  if (!saved.phone) {
    const collector = await findCollectorByTelegram(db, String(from.id));
    if (collector?.phone) {
      await rememberTelegramUser(from, collector.phone);
    } else {
      await askPhone(ctx);
      return;
    }
  }
  await sendGreeting(ctx, withPersistentButton);
}

async function bindCurrentChat(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) {
    return;
  }
  if (chat.type === "private") {
    await ctx.reply("Отправь /bind в группе, которую нужно привязать к админке.");
    return;
  }
  const member = await ctx.getChatMember(from.id);
  if (member.status !== "creator" && member.status !== "administrator") {
    await ctx.reply("Привязать чат может только администратор группы.");
    return;
  }
  const title = chat.title;
  await patchDefaultSettings(db, {
    groupChatId: String(chat.id),
    groupChatTitle: title,
  });
  await ctx.reply(`Чат «${title}» привязан к админке сборщиков.`);
}

async function acceptPrivateInvoice(ctx: Context, fileId: string, caption?: string): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }
  try {
    const photoRef = await persistTelegramPhoto(fileId);
    const result = await intakeBotPhoto(db, {
      platform: "telegram",
      userId: String(from.id),
      photoRef,
      caption,
    });
    const text = botIntakeReply(result);
    if (!text) {
      return;
    }
    const url = getMiniAppUrl();
    if (url && result.kind === "submitted") {
      await ctx.reply(text, {
        reply_markup: inlineAppButton(url),
      });
      return;
    }
    await ctx.reply(text);
  } catch (err) {
    const message = collectorSubmitErrorText(err, {
      id: String(from.id),
      idLabel: "Telegram ID",
    });
    if (message.startsWith("Не удалось принять")) {
      console.error(err);
    }
    await ctx.reply(message);
  }
}

export function createBot(token: string): Bot {
  const proxyAgent = getTelegramProxyAgent();
  const bot = new Bot(token, {
    client: proxyAgent
      ? {
          baseFetchConfig: {
            agent: proxyAgent,
            compress: true,
          },
        }
      : undefined,
  });

  bot.command("start", async (ctx) => {
    await greetOrAskPhone(ctx, true);
  });
  bot.command("bind", async (ctx) => {
    await bindCurrentChat(ctx);
  });

  bot.on("my_chat_member", async (ctx) => {
    const next = ctx.myChatMember.new_chat_member.status;
    const prev = ctx.myChatMember.old_chat_member.status;
    const joined =
      (next === "member" || next === "administrator") &&
      (prev === "left" || prev === "kicked");
    if (!joined || ctx.chat.type === "private") {
      return;
    }
    try {
      await ctx.reply("Чтобы привязать этот чат к админке сборщиков, отправьте /bind");
    } catch {
      // Bot may not be allowed to post yet.
    }
  });

  bot.on("message:contact", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const from = ctx.from;
    const contact = ctx.message.contact;
    if (!from || !contact) {
      return;
    }
    if (contact.user_id != null && contact.user_id !== from.id) {
      await ctx.reply("Нужно отправить свой номер кнопкой «Поделиться номером».", {
        reply_markup: phoneKeyboard(),
      });
      return;
    }
    const saved = await rememberTelegramUser(from, contact.phone_number);
    if (!saved.phone) {
      await ctx.reply("Не получилось прочитать номер. Нажми «Поделиться номером» ещё раз.", {
        reply_markup: phoneKeyboard(),
      });
      return;
    }
    await attachSharedPhone(db, {
      platform: "telegram",
      userId: String(from.id),
      phone: saved.phone,
    });
    await sendGreeting(ctx, true);
  });

  bot.on("message:photo", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const from = ctx.from;
    if (!photo || !from) {
      return;
    }
    await acceptPrivateInvoice(ctx, photo.file_id, ctx.message.caption);
  });

  bot.on("message:document", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const document = ctx.message.document;
    const from = ctx.from;
    if (!document || !from) {
      return;
    }
    const mime = document.mime_type ?? "";
    const name = document.file_name ?? "";
    const isImage = mime.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
    if (!isImage) {
      await ctx.reply("Нужно фото ведомости — снимок с камеры или JPG/PNG из галереи.");
      return;
    }
    await acceptPrivateInvoice(ctx, document.file_id, ctx.message.caption);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      return;
    }
    const from = ctx.from;
    if (!from) {
      return;
    }
    try {
      const result = await intakeBotText(db, {
        platform: "telegram",
        userId: String(from.id),
        text,
      });
      const reply = botIntakeReply(result);
      if (reply) {
        const url = getMiniAppUrl();
        if (url && result.kind === "submitted") {
          await ctx.reply(reply, { reply_markup: inlineAppButton(url) });
          return;
        }
        await ctx.reply(reply);
        return;
      }
    } catch (err) {
      const message = collectorSubmitErrorText(err, {
        id: String(from.id),
        idLabel: "Telegram ID",
      });
      if (message.startsWith("Не удалось принять")) {
        console.error(err);
      }
      await ctx.reply(message);
      return;
    }
    await greetOrAskPhone(ctx);
  });

  bot.catch((err) => {
    console.error("Bot error", err.error);
  });

  return bot;
}

async function stopCurrentBot(): Promise<void> {
  const previous = currentBot;
  currentBot = null;
  patchTelegramRuntime({ botRunning: false });
  if (!previous) {
    return;
  }
  try {
    await previous.stop();
  } catch (err) {
    console.error("Failed to stop Telegram bot", err);
  }
}

async function restartBotInner(): Promise<void> {
  await stopCurrentBot();
  const runtime = await refreshTelegramRuntime();
  const token = runtime.botToken;
  if (!token) {
    patchTelegramRuntime({ botUsername: null, botRunning: false });
    console.warn("BOT_TOKEN is not set — Telegram bot is skipped");
    return;
  }
  const bot = createBot(token);
  currentBot = bot;
  try {
    try {
      await bot.api.deleteMyCommands();
    } catch (err) {
      console.error("Failed to clear Telegram bot commands", err);
    }
    const url = getMiniAppUrl();
    if (url) {
      await bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: MINI_APP_BUTTON,
          web_app: { url },
        },
      });
    } else {
      await bot.api.setChatMenuButton({
        menu_button: { type: "default" },
      });
    }
    const me = await bot.api.getMe();
    patchTelegramRuntime({ botUsername: me.username, botRunning: true });
  } catch (err) {
    currentBot = null;
    patchTelegramRuntime({ botUsername: null, botRunning: false });
    throw err;
  }

  void bot
    .start({
      drop_pending_updates: true,
      onStart: (info) => {
        console.log(`Bot @${info.username} polling`);
      },
    })
    .catch((err) => {
      console.error("Bot polling error", err);
      if (currentBot === bot) {
        currentBot = null;
        patchTelegramRuntime({ botRunning: false });
      }
    });
}

export function restartBot(): Promise<void> {
  restartChain = restartChain.then(
    () => restartBotInner(),
    () => restartBotInner(),
  );
  return restartChain;
}

export function stopBot(): Promise<void> {
  restartChain = restartChain.then(
    () => stopCurrentBot(),
    () => stopCurrentBot(),
  );
  return restartChain;
}

export async function startBot(): Promise<void> {
  await restartBot();
}
