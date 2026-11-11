import type { Config } from "@netlify/functions";
import {
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookie,
  clearSessionCookie,
  getSessionUser,
  publicUser,
  SESSION_COOKIE,
} from "./lib/auth.ts";
import { normalizePhone } from "./lib/phone.ts";
import { db } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const user = await getSessionUser(req);
    if (!user) {
      return Response.json({ user: null }, { status: 401 });
    }
    return Response.json({ user: publicUser(user) });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const action = url.pathname.endsWith("/logout") ? "logout" : url.pathname.endsWith("/register") ? "register" : "login";
  const body = await req.json().catch(() => ({}));

  if (action === "logout") {
    // Сессию удаляем и на сервере, чтобы украденный cookie не оставался валидным.
    const cookies = req.headers.get("cookie") ?? "";
    const match = cookies
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

    if (match) {
      const token = match.slice(SESSION_COOKIE.length + 1);
      if (token) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
    }

    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearSessionCookie() },
    });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return Response.json({ error: "Заполни все обязательные поля." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Пароль должен содержать минимум 6 символов." }, { status: 400 });
  }

  if (action === "register") {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) {
      return Response.json({ error: "Введи имя длиной не менее 2 символов." }, { status: 400 });
    }

    const rawPhone = String(body.phone ?? "").trim();
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return Response.json(
        { error: "Введи корректный номер телефона (например, +996 555 12 34 56)." },
        { status: 400 },
      );
    }

    const [existingPhone] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (existingPhone) {
      return Response.json({ error: "Этот номер телефона уже зарегистрирован." }, { status: 409 });
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return Response.json({ error: "Этот адрес уже зарегистрирован." }, { status: 409 });
    }

    // Первый зарегистрированный пользователь становится администратором.
    const [{ value: userCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(users);
    const role = userCount === 0 ? "admin" : "user";

    const [user] = await db
      .insert(users)
      .values({ name, email, phone, passwordHash: hashPassword(password), role })
      .returning();

    const session = await createSession(user.id);

    return Response.json(
      { user: publicUser(user) },
      { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return Response.json(
      { error: "Не удалось войти. Проверь почту и пароль." },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);

  return Response.json(
    { user: publicUser(user) },
    { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
  );
};

export const config: Config = {
  path: ["/api/auth", "/api/auth/login", "/api/auth/register", "/api/auth/logout"],
};
