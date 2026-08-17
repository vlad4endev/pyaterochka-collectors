import type { Collector, PrismaClient } from "@prisma/client";
import { normalizePhone, phoneMatchValues } from "./phone";

export async function findCollectorByPhone(
  db: PrismaClient,
  phone: string,
): Promise<Collector | null> {
  const variants = phoneMatchValues(phone);
  if (variants.length === 0) {
    return null;
  }
  return await db.collector.findFirst({
    where: { phone: { in: variants } },
  });
}

async function findTelegramBotUserByPhone(db: PrismaClient, phone: string) {
  const variants = phoneMatchValues(phone);
  if (variants.length === 0) {
    return null;
  }
  return await db.telegramBotUser.findFirst({
    where: { phone: { in: variants } },
  });
}

async function findMaxBotUserByPhone(db: PrismaClient, phone: string) {
  const variants = phoneMatchValues(phone);
  if (variants.length === 0) {
    return null;
  }
  return await db.maxBotUser.findFirst({
    where: { phone: { in: variants } },
  });
}

async function messengerIdTaken(
  db: PrismaClient,
  field: "telegramUserId" | "maxUserId",
  value: string,
  exceptCollectorId: string,
): Promise<boolean> {
  const existing = await db.collector.findFirst({
    where: { [field]: value, NOT: { id: exceptCollectorId } },
  });
  return Boolean(existing);
}

export async function syncCollectorIdentity(
  db: PrismaClient,
  collectorId: string,
): Promise<Collector | null> {
  const collector = await db.collector.findUnique({ where: { id: collectorId } });
  if (!collector) {
    return null;
  }

  let phone = collector.phone;
  let telegramUserId = collector.telegramUserId;
  let maxUserId = collector.maxUserId;

  if (telegramUserId) {
    const tgUser = await db.telegramBotUser.findUnique({
      where: { telegramUserId },
    });
    if (!phone && tgUser?.phone) {
      phone = tgUser.phone;
    }
  }
  if (maxUserId) {
    const maxUser = await db.maxBotUser.findUnique({
      where: { maxUserId },
    });
    if (!phone && maxUser?.phone) {
      phone = maxUser.phone;
    }
  }
  if (phone) {
    const tgUser = await findTelegramBotUserByPhone(db, phone);
    if (tgUser && !telegramUserId) {
      const taken = await messengerIdTaken(db, "telegramUserId", tgUser.telegramUserId, collector.id);
      if (!taken) {
        telegramUserId = tgUser.telegramUserId;
      }
    }
    const maxUser = await findMaxBotUserByPhone(db, phone);
    if (maxUser && !maxUserId) {
      const taken = await messengerIdTaken(db, "maxUserId", maxUser.maxUserId, collector.id);
      if (!taken) {
        maxUserId = maxUser.maxUserId;
      }
    }
  }

  if (
    phone === collector.phone &&
    telegramUserId === collector.telegramUserId &&
    maxUserId === collector.maxUserId
  ) {
    return collector;
  }

  return await db.collector.update({
    where: { id: collector.id },
    data: { phone, telegramUserId, maxUserId },
  });
}

export async function attachSharedPhone(
  db: PrismaClient,
  input: {
    platform: "telegram" | "max";
    userId: string;
    phone: string;
  },
): Promise<Collector | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return null;
  }

  const byMessenger =
    input.platform === "telegram"
      ? await db.collector.findFirst({ where: { telegramUserId: input.userId } })
      : await db.collector.findFirst({ where: { maxUserId: input.userId } });
  const byPhone = await findCollectorByPhone(db, phone);
  const telegramUser = await findTelegramBotUserByPhone(db, phone);
  const maxUser = await findMaxBotUserByPhone(db, phone);
  const byOther =
    input.platform === "max" && telegramUser
      ? await db.collector.findFirst({
          where: { telegramUserId: telegramUser.telegramUserId },
        })
      : input.platform === "telegram" && maxUser
        ? await db.collector.findFirst({
            where: { maxUserId: maxUser.maxUserId },
          })
        : null;

  if (byMessenger && byPhone && byMessenger.id !== byPhone.id) {
    return await db.collector.update({
      where: { id: byMessenger.id },
      data: { phone },
    });
  }
  if (byMessenger && byOther && byMessenger.id !== byOther.id) {
    return await db.collector.update({
      where: { id: byMessenger.id },
      data: { phone },
    });
  }

  const target = byMessenger ?? byPhone ?? byOther;
  if (!target) {
    return null;
  }

  const data: {
    phone: string;
    telegramUserId?: string;
    maxUserId?: string;
  } = { phone };

  if (input.platform === "telegram" && !target.telegramUserId) {
    const taken = await messengerIdTaken(db, "telegramUserId", input.userId, target.id);
    if (!taken) {
      data.telegramUserId = input.userId;
    }
  }
  if (input.platform === "max" && !target.maxUserId) {
    const taken = await messengerIdTaken(db, "maxUserId", input.userId, target.id);
    if (!taken) {
      data.maxUserId = input.userId;
    }
  }
  if (!target.maxUserId && !data.maxUserId && maxUser) {
    const taken = await messengerIdTaken(db, "maxUserId", maxUser.maxUserId, target.id);
    if (!taken) {
      data.maxUserId = maxUser.maxUserId;
    }
  }
  if (!target.telegramUserId && !data.telegramUserId && telegramUser) {
    const taken = await messengerIdTaken(
      db,
      "telegramUserId",
      telegramUser.telegramUserId,
      target.id,
    );
    if (!taken) {
      data.telegramUserId = telegramUser.telegramUserId;
    }
  }

  return await db.collector.update({
    where: { id: target.id },
    data,
  });
}
