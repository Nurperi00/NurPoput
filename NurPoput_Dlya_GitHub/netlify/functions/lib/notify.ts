import { getEnv } from "./env.ts";

type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "provider_error" };

export function smsConfigured() {
  return Boolean(
    getEnv("TWILIO_ACCOUNT_SID") &&
      getEnv("TWILIO_AUTH_TOKEN") &&
      getEnv("TWILIO_FROM_NUMBER"),
  );
}

export function emailConfigured() {
  return Boolean(getEnv("RESEND_API_KEY") && getEnv("MAIL_FROM"));
}

export async function sendSMS(phone: string, text: string): Promise<SendResult> {
  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  const from = getEnv("TWILIO_FROM_NUMBER");

  if (!sid || !token || !from) return { ok: false, reason: "not_configured" };

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        },
        body: new URLSearchParams({ To: phone, From: from, Body: text }),
      },
    );
    return response.ok ? { ok: true } : { ok: false, reason: "provider_error" };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const key = getEnv("RESEND_API_KEY");
  const from = getEnv("MAIL_FROM");

  if (!key || !from) return { ok: false, reason: "not_configured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    return response.ok ? { ok: true } : { ok: false, reason: "provider_error" };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}
