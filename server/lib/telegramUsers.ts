import type { PrismaClient, TelegramBotUser } from "@prisma/client";
import { normalizePhone } from "./phone";

export async function upsertTelegramBotUser(
  db: PrismaClient,
  input: {
    telegramUserId: string;
    name: string;
    username?: string | null;
    phone?: string | null;
  },
): Promise<TelegramBotUser> {
  const now = new Date();
  const name = input.name.trim() || "без имени";
  const username = input.username?.replace(/^@/, "").trim() || null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  return await db.telegramBotUser.upsert({
    where: { telegramUserId: input.telegramUserId },
    create: {
      telegramUserId: input.telegramUserId,
      name,
      username,
      phone,
      startedAt: now,
      lastSeenAt: now,
    },
    update: {
      name,
      lastSeenAt: now,
      ...(username ? { username } : {}),
      ...(phone ? { phone } : {}),
    },
  });
}
