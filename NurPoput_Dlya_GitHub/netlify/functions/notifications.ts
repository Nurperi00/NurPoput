import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

export default async (req: Request) => {
  const user = await getSessionUser(req);
  if (!user) {
    return Response.json({ error: "Сначала войди в аккаунт." }, { status: 401 });
  }

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const [count] = await db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.read, false)),
      );

    return Response.json({
      notifications: rows,
      unread: count?.unread ?? 0,
    });
  }

  if (req.method === "POST") {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.read, false)),
      );

    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: ["/api/notifications", "/api/notifications/read"],
};
