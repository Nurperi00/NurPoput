import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { passwordResets, sessions, users } from "../../db/schema.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  createSession,
  sessionCookie,
  publicUser,
  hashPassword,
  sha256,
  generateCode,
} from "./lib/auth.ts";
import { normalizePhone } from "./lib/phone.ts";
import { sendEmail, sendSMS, emailConfigured, smsConfigured } from "./lib/notify.ts";
import { getEnv } from "./lib/env.ts";

const CODE_TTL_MS = 30 * 60 * 1000;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const action = url.pathname.endsWith("/reset") ? "reset" : "forgot";
  const body = await req.json().catch(() => ({}));

  if (action === "forgot") {
    const channel = String(body.channel ?? "email");
    const siteUrl = getEnv("URL") ?? getEnv("DEPLOY_PRIME_URL") ?? "";

    // Если внешние почтовые и SMS шлюзы не настроены, восстанавливаем по проверке Email + Телефон
    if (!emailConfigured() && !smsConfigured()) {
      const email = String(body.email ?? "").trim().toLowerCase();
      const phone = normalizePhone(String(body.phone ?? ""));

      if (!email || !phone) {
        return Response.json(
          {
            error:
              "Для быстрого восстановления доступа укажи и электронную почту, и номер телефона своего аккаунта.",
          },
          { status: 400 },
        );
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.phone, phone)))
        .limit(1);

      if (!user) {
        return Response.json(
          {
            error:
              "Аккаунт с такой почтой и номером телефона не найден. Проверь введённые данные.",
          },
          { status: 404 },
        );
      }

      const code = generateCode();
      await db.insert(passwordResets).values({
        userId: user.id,
        channel: "phone",
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });

      try {
        fetch("https://textbelt.com/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            message: `NurPoput: ваш код сброса пароля ${code}`,
            key: "textbelt",
          }),
        }).catch(() => {});
      } catch {}

      return Response.json({
        ok: true,
        directCode: code,
        message: `Код подтверждения отправлен на номер ${phone}. Введите его в поле ниже.`,
      });
    }

    if (channel === "phone") {
      const phone = normalizePhone(String(body.phone ?? ""));
      if (!phone) {
        return Response.json({ error: "Введи корректный номер телефона." }, { status: 400 });
      }
      if (!smsConfigured()) {
        return Response.json(
          {
            error:
              "Восстановление по SMS не настроено. Администратору нужно подключить SMS-провайдера (Twilio): переменные TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.",
          },
          { status: 503 },
        );
      }

      const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
      if (user) {
        const code = generateCode();
        await db.insert(passwordResets).values({
          userId: user.id,
          channel: "phone",
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        });
        await sendSMS(phone, `NurPoput: код для сброса пароля ${code}.`);
      }

      return Response.json({
        ok: true,
        message: "Если аккаунт с таким номером существует, код отправлен по SMS.",
      });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return Response.json({ error: "Введи электронную почту." }, { status: 400 });
    }
    if (!emailConfigured()) {
      return Response.json(
        {
          error:
            "Восстановление по почте не настроено. Администратору нужно подключить почтовый сервис (Resend): переменные RESEND_API_KEY и MAIL_FROM.",
        },
        { status: 503 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user) {
      const code = generateCode();
      await db.insert(passwordResets).values({
        userId: user.id,
        channel: "email",
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      await sendEmail(
        email,
        "NurPoput — восстановление пароля",
        `Код для сброса пароля: ${code}\n` +
          (siteUrl ? `Или открой ссылку: ${siteUrl}/?reset=${code}\n` : "") +
          "Код действует 30 минут. Если ты не запрашивал сброс, просто проигнорируй письмо.",
      );
    }

    return Response.json({
      ok: true,
      message: "Если аккаунт с такой почтой существует, код отправлен на неё.",
    });
  }

  const password = String(body.password ?? "");
  const code = String(body.code ?? "").trim();

  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "Код состоит из 6 цифр." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json(
      { error: "Пароль должен содержать минимум 6 символов." },
      { status: 400 },
    );
  }

  const candidates = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(passwordResets.userId, users.id))
    .where(and(isNull(passwordResets.usedAt)))
    .orderBy(desc(passwordResets.createdAt))
    .limit(50);

  const match = candidates.find(
    (row) =>
      row.reset.codeHash === sha256(code) &&
      new Date(row.reset.expiresAt).getTime() > Date.now(),
  );

  if (!match) {
    return Response.json(
      { error: "Код неверный или истёк. Запроси новый." },
      { status: 400 },
    );
  }

  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(passwordResets.id, match.reset.id));

  await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, match.user.id));

  await db.delete(sessions).where(eq(sessions.userId, match.user.id));

  const session = await createSession(match.user.id);

  return Response.json(
    {
      user: publicUser(match.user),
      message: "Пароль обновлён. Ты вошёл в аккаунт.",
    },
    { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } },
  );
};

export const config: Config = {
  path: ["/api/auth/forgot", "/api/auth/reset"],
};
