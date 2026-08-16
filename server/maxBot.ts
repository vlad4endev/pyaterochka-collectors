import { Bot, Keyboard, MaxError, type Context } from "@maxhub/max-bot-api";
import { db } from "./db";
import { patchDefaultSettings } from "./lib/domain";
import { HttpError } from "./lib/errors";
import { saveInvoicePhotoFromUrl } from "./lib/invoices";
import { buildGreetingText, MINI_APP_BUTTON } from "./lib/messages";
import { createInvoiceFromPhoto, findCollectorByMax } from "./lib/miniapp";
import {
  getMaxBotUsername,
  getMiniAppUrl,
  maxMiniAppLink,
  patchMaxRuntime,
  refreshMaxRuntime,
} from "./lib/max";

type OpenAppButton = {
  type: "open_app";
  text: string;
  web_app?: string;
};

let currentBot: Bot | null = null;
let restartChain: Promise<void> = Promise.resolve();

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function appKeyboard() {
  const url = getMiniAppUrl();
  const username = getMaxBotUsername();
  const buttons: Array<OpenAppButton | ReturnType<typeof Keyboard.button.link>> = [];
  if (url) {
    buttons.push({ type: "open_app", text: MINI_APP_BUTTON, web_app: url });
  }
  const link = maxMiniAppLink(username);
  if (link && buttons.length === 0) {
    buttons.push(Keyboard.button.link(MINI_APP_BUTTON, link));
  }
  if (buttons.length === 0) {
    return undefined;
  }
  return Keyboard.inlineKeyboard([buttons]);
}

async function sendGreeting(ctx: Context): Promise<void> {
  const from = ctx.user;
  if (!from) {
    return;
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
  await ctx.reply(text, keyboard ? { attachments: [keyboard] } : undefined);
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

function isPrivateDialog(ctx: Context): boolean {
  return ctx.message?.recipient.chat_type === "dialog";
}

export function createMaxBot(token: string): Bot {
  const bot = new Bot(token);

  bot.on("bot_started", async (ctx) => {
    await sendGreeting(ctx);
  });
  bot.command("start", async (ctx) => {
    await sendGreeting(ctx);
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
    const from = ctx.user;
    if (!message || !from) {
      return;
    }
    const image = message.body.attachments?.find((item) => item.type === "image");
    if (image && image.type === "image") {
      try {
        const photoRef = await saveInvoicePhotoFromUrl(image.payload.url);
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
        console.error(err);
        await ctx.reply("Не удалось принять фото. Попробуй ещё раз или открой приложение.");
      }
      return;
    }
    const text = message.body.text?.trim() ?? "";
    if (!text || text.startsWith("/")) {
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
  await stopCurrentBot();
  const next = await refreshMaxRuntime();
  const token = next.botToken;
  if (!token) {
    patchMaxRuntime({ botUsername: null, botRunning: false });
    console.warn("MAX_BOT_TOKEN is not set — MAX bot is skipped");
    return;
  }
  const bot = createMaxBot(token);
  currentBot = bot;
  try {
    await bot.api.setMyCommands([
      { name: "start", description: "Приветствие и приложение" },
      { name: "app", description: "Открыть мини-приложение" },
      { name: "help", description: "Как пользоваться" },
      { name: "bind", description: "Привязать группу к админке" },
    ]);
    const me = await bot.api.getMyInfo();
    const username = me.username?.replace(/^@/, "") || null;
    patchMaxRuntime({ botUsername: username, botRunning: true });
  } catch (err) {
    currentBot = null;
    patchMaxRuntime({ botUsername: null, botRunning: false });
    throw err;
  }

  void bot
    .start({
      allowedUpdates: [
        "message_created",
        "bot_started",
        "bot_added",
        "bot_removed",
        "message_callback",
      ],
    })
    .catch((err) => {
      console.error("MAX bot polling error", err);
      if (currentBot === bot) {
        currentBot = null;
        patchMaxRuntime({ botRunning: false });
      }
    });
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
