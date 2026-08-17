import type { MaxBotUser, PrismaClient } from "@prisma/client";
import { normalizePhone, phoneFromVcf, phoneMatchValues } from "./phone";

export type MaxBotUserDto = {
  maxUserId: string;
  name: string;
  username: string | null;
  phone: string | null;
  startedAt: number;
  lastSeenAt: number;
  collectorName: string | null;
};

export { phoneFromVcf };

export async function upsertMaxBotUser(
  db: PrismaClient,
  input: {
    maxUserId: string;
    name: string;
    username?: string | null;
    phone?: string | null;
  },
): Promise<MaxBotUser> {
  const now = new Date();
  const name = input.name.trim() || "без имени";
  const username = input.username?.replace(/^@/, "").trim() || null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  return await db.maxBotUser.upsert({
    where: { maxUserId: input.maxUserId },
    create: {
      maxUserId: input.maxUserId,
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

export async function listMaxBotUsers(db: PrismaClient): Promise<MaxBotUserDto[]> {
  const rows = await db.maxBotUser.findMany({
    take: 200,
    orderBy: { lastSeenAt: "desc" },
  });
  const collectors =
    rows.length === 0
      ? []
      : await db.collector.findMany({
          take: 200,
        });
  const byMaxId = new Map(
    collectors.flatMap((collector) =>
      collector.maxUserId ? [[collector.maxUserId, collector.name] as const] : [],
    ),
  );
  return rows.map((row) => {
    const byId = byMaxId.get(row.maxUserId);
    const byPhone =
      row.phone &&
      collectors.find(
        (collector) =>
          collector.phone &&
          phoneMatchValues(row.phone ?? "").includes(collector.phone),
      )?.name;
    return {
      maxUserId: row.maxUserId,
      name: row.name,
      username: row.username,
      phone: row.phone,
      startedAt: row.startedAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
      collectorName: byId ?? byPhone ?? null,
    };
  });
}
