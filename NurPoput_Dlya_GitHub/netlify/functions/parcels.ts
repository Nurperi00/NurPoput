import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { notifications, parcels, users } from "../../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

const CITIES = [
  "Бишкек", "Ош", "Каракол", "Токмок", "Джалал-Абад", "Нарын", "Талас",
  "Баткен", "Чолпон-Ата", "Балыкчы", "Кант", "Кызыл-Кия", "Кара-Балта",
  "Узген", "Кочкор", "Ат-Башы",
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const isSearch = url.pathname.endsWith("/search");

  if (req.method === "GET") {
    // Публичный поиск открытых посылок — виден всем пользователям.
    if (isSearch) {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");

      const conditions = [eq(parcels.status, "open")];
      if (from) conditions.push(eq(parcels.fromCity, from));
      if (to) conditions.push(eq(parcels.toCity, to));
      if (date) conditions.push(eq(parcels.date, date));

      const rows = await db
        .select({ parcel: parcels, ownerName: users.name })
        .from(parcels)
        .innerJoin(users, eq(parcels.ownerId, users.id))
        .where(and(...conditions))
        .orderBy(desc(parcels.createdAt))
        .limit(100);

      return Response.json({
        parcels: rows.map((row) => ({ ...row.parcel, ownerName: row.ownerName })),
      });
    }

    const user = await getSessionUser(req);
    if (!user) {
      return Response.json({ error: "Сначала войди в аккаунт." }, { status: 401 });
    }

    const rows = await db
      .select()
      .from(parcels)
      .where(eq(parcels.ownerId, user.id))
      .orderBy(desc(parcels.createdAt));
    return Response.json({ parcels: rows });
  }

  if (req.method === "POST") {
    const user = await getSessionUser(req);
    if (!user) {
      return Response.json({ error: "Сначала войди в аккаунт." }, { status: 401 });
    }

    if (url.pathname.endsWith("/take")) {
      const body = await req.json().catch(() => ({}));
      const parcelId = Number(body.parcelId);

      if (!Number.isInteger(parcelId) || parcelId < 1) {
        return Response.json({ error: "Неверный ID посылки." }, { status: 400 });
      }

      const [parcel] = await db
        .select()
        .from(parcels)
        .where(eq(parcels.id, parcelId))
        .limit(1);

      if (!parcel) {
        return Response.json({ error: "Посылка не найдена." }, { status: 404 });
      }
      if (parcel.ownerId === user.id) {
        return Response.json(
          { error: "Нельзя взять заказ на свою же посылку." },
          { status: 400 },
        );
      }
      if (parcel.status !== "open") {
        return Response.json(
          { error: "Этот заказ уже принят другим водителем." },
          { status: 409 },
        );
      }

      await db
        .update(parcels)
        .set({ status: "in_progress" })
        .where(eq(parcels.id, parcelId));

      await db.insert(notifications).values({
        userId: parcel.ownerId,
        type: "parcel_taken",
        title: "Водитель взял вашу посылку!",
        body: `${user.name} готов доставить вашу посылку (${parcel.fromCity} → ${parcel.toCity}, ${parcel.date}). Телефон водителя для связи: ${user.phone || "уточните в профиле"}.`,
      });

      return Response.json({
        ok: true,
        message: `Заказ принят! Телефон отправителя: ${parcel.senderPhone} (${parcel.senderName}), телефон получателя: ${parcel.recipientPhone} (${parcel.recipientName}).`,
        parcel: { ...parcel, status: "in_progress" },
      });
    }

    const body = await req.json().catch(() => ({}));

    const fromCity = String(body.from ?? "");
    const toCity = String(body.to ?? "");
    const senderName = String(body.senderName ?? "").trim();
    const senderPhone = String(body.senderPhone ?? "").trim();
    const recipientName = String(body.recipientName ?? "").trim();
    const recipientPhone = String(body.recipientPhone ?? "").trim();
    const date = String(body.date ?? "");
    const size = String(body.size ?? "");
    const description = String(body.description ?? "").trim();

    if (!CITIES.includes(fromCity) || !CITIES.includes(toCity)) {
      return Response.json({ error: "Выбери города из списка." }, { status: 400 });
    }
    if (fromCity === toCity) {
      return Response.json(
        { error: "Город отправления и назначения должны отличаться." },
        { status: 400 },
      );
    }
    if (!senderName || !senderPhone || !recipientName || !recipientPhone || !date) {
      return Response.json(
        { error: "Заполни все обязательные поля." },
        { status: 400 },
      );
    }

    const [parcel] = await db
      .insert(parcels)
      .values({
        ownerId: user.id,
        fromCity,
        toCity,
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        date,
        size,
        description,
      })
      .returning();

    return Response.json({ parcel }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: ["/api/parcels", "/api/parcels/search", "/api/parcels/take"],
};
