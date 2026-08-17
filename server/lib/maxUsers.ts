import type { MaxBotUser, PrismaClient } from "@prisma/client";

export type MaxBotUserDto = {
  maxUserId: string;
  name: string;
  username: string | null;
  phone: string | null;
  startedAt: number;
  lastSeenAt: number;
  collectorName: string | null;
};

function normalizePhone(raw: string): string | null {
  const trimmed = raw.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return trimmed.slice(0, 20);
}

export function phoneFromVcf(vcf: string | null | undefined): string | null {
  if (!vcf) {
    return null;
  }
  const match = vcf.match(/TEL[^:]*:([^\r\n]+)/i);
  return match?.[1] ? normalizePhone(match[1]) : null;
}

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
  const ids = rows.map((row) => row.maxUserId);
  const collectors =
    ids.length === 0
      ? []
      : await db.collector.findMany({
          where: { maxUserId: { in: ids } },
        });
  const byMaxId = new Map(
    collectors.flatMap((collector) =>
      collector.maxUserId ? [[collector.maxUserId, collector.name] as const] : [],
    ),
  );
  return rows.map((row) => ({
    maxUserId: row.maxUserId,
    name: row.name,
    username: row.username,
    phone: row.phone,
    startedAt: row.startedAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    collectorName: byMaxId.get(row.maxUserId) ?? null,
  }));
}
