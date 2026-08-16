import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { db } from "./db";
import { HttpError } from "./lib/errors";
import {
  createInvoiceFromPhoto,
  findCollectorByTelegram,
} from "./lib/miniapp";
import { getMiniAppUrl } from "./lib/telegram";

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
    lines.push("", "Мини-приложение пока не настроено (нужен MINIAPP_URL).");
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

export async function startBot(): Promise<void> {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    console.warn("BOT_TOKEN is not set — Telegram bot is skipped");
    return;
  }
  const bot = createBot(token);
  const url = getMiniAppUrl();

  await bot.api.setMyCommands([
    { command: "start", description: "Приветствие и приложение" },
    { command: "app", description: "Открыть мини-приложение" },
    { command: "help", description: "Как пользоваться" },
  ]);
  if (url) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Приложение",
        web_app: { url },
      },
    });
  }

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => {
      console.log(`Bot @${info.username} polling`);
    },
  });
}
