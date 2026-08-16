import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { db } from "./db";
import { patchDefaultSettings } from "./lib/domain";
import { HttpError } from "./lib/errors";
import {
  createInvoiceFromPhoto,
  findCollectorByTelegram,
} from "./lib/miniapp";
import {
  getMiniAppUrl,
  patchTelegramRuntime,
  refreshTelegramRuntime,
} from "./lib/telegram";

let currentBot: Bot | null = null;
let restartChain: Promise<void> = Promise.resolve();

function inlineAppButton(url: string): InlineKeyboard {
  return new InlineKeyboard().webApp("Открыть приложение", url);
}

function replyAppKeyboard(url: string): Keyboard {
  return new Keyboard().webApp("Открыть приложение", url).resized().persistent();
}

async function sendGreeting(ctx: Context, withPersistentButton = false): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }
  const collector = await findCollectorByTelegram(db, String(from.id));
  const url = getMiniAppUrl();
  const helloName = collector?.name ?? from.first_name;
  const lines = [
    `Привет, ${helloName}!`,
    "",
    "Это бот сборщиков «Пятёрка на бульваре».",
  ];
  if (url) {
    lines.push(
      "",
      "Нажми «Открыть приложение» — сразу увидишь график, килограммы, сумму и все записи за период.",
    );
  } else {
    lines.push("", "Мини-приложение пока не настроено. Организатор задаёт URL в админке.");
  }
  if (collector?.active) {
    lines.push("", "Фото накладной можно прислать сюда в чат — оно уйдёт на проверку.");
  } else if (!collector) {
    lines.push(
      "",
      `Если тебя ещё нет в списке, покажи организатору свой Telegram ID: ${from.id}`,
    );
  } else {
    lines.push("", "Ты скрыт в списке участников — напиши организатору.");
  }

  if (!url) {
    await ctx.reply(lines.join("\n"));
    return;
  }
  if (withPersistentButton) {
    await ctx.reply(lines.join("\n"), { reply_markup: replyAppKeyboard(url) });
  }
  await ctx.reply(withPersistentButton ? "Открыть приложение:" : lines.join("\n"), {
    reply_markup: inlineAppButton(url),
  });
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

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await sendGreeting(ctx, true);
  });
  bot.command("help", async (ctx) => {
    await sendGreeting(ctx);
  });
  bot.command("app", async (ctx) => {
    await sendGreeting(ctx);
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
    try {
      const result = await createInvoiceFromPhoto(
        db,
        String(from.id),
        photo.file_id,
        Date.now(),
      );
      const url = getMiniAppUrl();
      const text = `Накладная за ${result.date.slice(8, 10)}.${result.date.slice(5, 7)} ушла на проверку. Открой приложение, чтобы видеть статус.`;
      if (url) {
        await ctx.reply(text, {
          reply_markup: inlineAppButton(url),
        });
      } else {
        await ctx.reply(text);
      }
    } catch (err) {
      const message = err instanceof HttpError ? err.message : "Не удалось принять фото";
      if (message === "Not a collector") {
        await ctx.reply(
          `Тебя нет в списке участников. Покажи организатору свой Telegram ID: ${from.id}`,
        );
        return;
      }
      if (message === "Collector is inactive") {
        await ctx.reply("Ты скрыт в списке участников — напиши организатору.");
        return;
      }
      if (message === "Period not found" || message === "Period is closed") {
        await ctx.reply("Сейчас нет открытого периода — подожди организатора.");
        return;
      }
      if (message === "Date is outside the open period") {
        await ctx.reply("Сегодняшняя дата не входит в текущий период.");
        return;
      }
      console.error(err);
      await ctx.reply("Не удалось принять фото. Попробуй ещё раз или открой приложение.");
    }
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") {
      return;
    }
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      return;
    }
    await sendGreeting(ctx);
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
    await bot.api.setMyCommands([
      { command: "start", description: "Приветствие и приложение" },
      { command: "app", description: "Открыть мини-приложение" },
      { command: "help", description: "Как пользоваться" },
      { command: "bind", description: "Привязать группу к админке" },
    ]);
    const url = getMiniAppUrl();
    if (url) {
      await bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Приложение",
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
