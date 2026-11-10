import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { rides, users } from "../../db/schema.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

const CITIES = [
  "Бишкек", "Ош", "Каракол", "Токмок", "Джалал-Абад", "Нарын", "Талас",
  "Баткен", "Чолпон-Ата", "Балыкчы", "Кант", "Кызыл-Кия", "Кара-Балта",
  "Узген", "Кочкор", "Ат-Башы",
];

export default async (req: Request) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const date = url.searchParams.get("date");
    const passengers = Number(url.searchParams.get("passengers") ?? 1);

    if (!from || !to || !date) {
      return Response.json({ error: "Укажи маршрут и дату." }, { status: 400 });
    }
    if (from === to) {
      return Response.json({ error: "Города должны отличаться." }, { status: 400 });
    }

    const conditions = [
      eq(rides.fromCity, from),
      eq(rides.toCity, to),
      eq(rides.date, date),
      eq(rides.status, "published"),
      gte(rides.seats, Math.max(1, passengers)),
    ];

    const results = await db
      .select({
        id: rides.id,
        date: rides.date,
        time: rides.time,
        car: rides.car,
        seats: rides.seats,
        price: rides.price,
        comment: rides.comment,
        phone: rides.phone,
        driverName: users.name,
      })
      .from(rides)
      .innerJoin(users, eq(rides.driverId, users.id))
      .where(and(...conditions))
      .orderBy(rides.time);

    return Response.json({ rides: results });
  }

  if (req.method === "POST") {
    const user = await getSessionUser(req);
    if (!user) {
      return Response.json({ error: "Сначала войди в аккаунт." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const fromCity = String(body.from ?? "");
    const toCity = String(body.to ?? "");
    const date = String(body.date ?? "");
    const time = String(body.time ?? "");
    const seats = Number(body.seats);
    const price = Number(body.price);
    const car = String(body.car ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const comment = String(body.comment ?? "").trim();

    if (!CITIES.includes(fromCity) || !CITIES.includes(toCity)) {
      return Response.json({ error: "Выбери города из списка." }, { status: 400 });
    }
    if (fromCity === toCity) {
      return Response.json({ error: "Город отправления и назначения должны отличаться." }, { status: 400 });
    }
    if (!date || !time || !car || !phone) {
      return Response.json({ error: "Заполни все обязательные поля." }, { status: 400 });
    }
    if (!Number.isFinite(price) || price < 1 || price > 100000) {
      return Response.json({ error: "Проверь цену поездки." }, { status: 400 });
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
      return Response.json({ error: "Проверь количество мест." }, { status: 400 });
    }

    const [ride] = await db
      .insert(rides)
      .values({ driverId: user.id, fromCity, toCity, date, time, seats, price, car, phone, comment })
      .returning();

    return Response.json({ ride }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/rides",
};
