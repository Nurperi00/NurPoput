import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { phoneCodes, users } from "../../db/schema.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  createSession,
  sessionCookie,
  publicUser,
  sha256,
  generateCode,
} from "./lib/auth.ts";
import { normalizePhone } from "./lib/phone.ts";
import { sendSMS, smsConfigured } from "./lib/notify.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const action = url.pathname.endsWith("/verify") ? "verify" : "request";
  const body = await req.json().catch(() => ({}));

  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) {
    return Response.json(
      { error: "Введи корректный номер телефона, например +996 555 12 34 56." },
      { status: 400 },
    );
  }

  if (action === "request") {
    if (!smsConfigured()) {
      return Response.json(
        {
          error:
            "Отправка SMS не настроена. Администратору нужно подключить SMS-провайдера (Twilio): переменные TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.",
        },
        { status: 503 },
      );
    }

    const [recent] = await db
      .select()
      .from(phoneCodes)
      .where(eq(phoneCodes.phone, phone))
      .orderBy(desc(phoneCodes.createdAt))
      .limit(1);

    if (
      recent &&
      new Date(recent.createdAt).getTime() + RESEND_COOLDOWN_MS > Date.now()
    ) {
      return Response.json(
        { error: "Код уже отправлен. Запроси новый через минуту." },
        { status: 429 },
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await db.insert(phoneCodes).values({ phone, codeHash: sha256(code), expiresAt });

    const sent = await sendSMS(
      phone,
      `NurPoput: код входа ${code}. Никому не сообщай этот код.`,
    );

    if (!sent.ok) {
      return Response.json(
        { error: "SMS-провайдер не смог отправить сообщение. Попробуй позже." },
        { status: 502 },
      );
    }

    return Response.json({ ok: true, expiresInSec: CODE_TTL_MS / 1000 });
  }

  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "Код состоит из 6 цифр." }, { status: 400 });
  }

  const [record] = await db
    .select()
    .from(phoneCodes)
    .where(and(eq(phoneCodes.phone, phone), isNull(phoneCodes.consumedAt)))
    .orderBy(desc(phoneCodes.createdAt))
    .limit(1);

  if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
    return Response.json(
      { error: "Код не найден или истёк. Запроси новый." },
      { status: 400 },
    );
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return Response.json(
      { error: "Слишком много попыток. Запроси новый код." },
      { status: 429 },
    );
  }

  if (record.codeHash !== sha256(code)) {
    await db
      .update(phoneCodes)
      .set({ attempts: sql`${phoneCodes.attempts} + 1` })
      .where(eq(phoneCodes.id, record.id));
    return Response.json({ error: "Неверный код." }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

  let user = existing;
  const name = String(body.name ?? "").trim();

  if (!user && name.length < 2) {
    // Код не списываем: пользователь введёт имя и подтвердит тем же кодом.
    return Response.json(
      { error: "Новый номер: укажи имя, чтобы создать аккаунт.", needName: true },
      { status: 400 },
    );
  }

  await db
    .update(phoneCodes)
    .set({ consumedAt: new Date() })
    .where(eq(phoneCodes.id, record.id));

  if (!user) {
    const [{ value: userCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(users);
    const role = userCount === 0 ? "admin" : "user";

    const [created] = await db
      .insert(users)
      .values({ name, phone, role })
      .returning();
    user = created;
  }

  const session = await createSession(user.id);

  return Response.json(
    { user: publicUser(user) },
    { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
  );
};

export const config: Config = {
  path: ["/api/auth/phone/request", "/api/auth/phone/verify"],
};
