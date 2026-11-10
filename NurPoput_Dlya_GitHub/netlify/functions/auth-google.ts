import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { createSession, sessionCookie, publicUser } from "./lib/auth.ts";
import { getEnv } from "./lib/env.ts";

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
}

export default async (req: Request) => {
  const clientId = getEnv("GOOGLE_CLIENT_ID");

  if (req.method === "GET") {
    return Response.json({
      googleEnabled: Boolean(clientId),
      googleClientId: clientId ?? null,
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!clientId) {
    return Response.json(
      {
        error:
          "Вход через Google не настроен. Добавь переменную GOOGLE_CLIENT_ID в настройках сайта Netlify.",
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const credential = String(body.credential ?? "");

  if (!credential) {
    return Response.json({ error: "Не получен токен Google." }, { status: 400 });
  }

  const response = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential),
  );
  if (!response.ok) {
    return Response.json({ error: "Не удалось проверить аккаунт Google." }, { status: 401 });
  }

  const info = (await response.json()) as GoogleTokenInfo;

  if (info.aud !== clientId || !info.email || !info.sub) {
    return Response.json({ error: "Токен Google недействителен." }, { status: 401 });
  }

  if (info.email_verified !== "true" && info.email_verified !== true) {
    return Response.json({ error: "Почта Google не подтверждена." }, { status: 401 });
  }

  const email = info.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  let user = existing;

  if (!user) {
    const [{ value: userCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(users);
    const role = userCount === 0 ? "admin" : "user";
    const name =
      (info.name ?? "").trim().length >= 2 ? info.name!.trim() : email.split("@")[0];

    const [created] = await db
      .insert(users)
      .values({ name, email, googleId: info.sub, role })
      .returning();
    user = created;
  } else if (!user.googleId) {
    const [updated] = await db
      .update(users)
      .set({ googleId: info.sub })
      .where(eq(users.id, user.id))
      .returning();
    user = updated;
  }

  const session = await createSession(user.id);

  return Response.json(
    { user: publicUser(user) },
    { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
  );
};

export const config: Config = {
  path: ["/api/auth/google"],
};
