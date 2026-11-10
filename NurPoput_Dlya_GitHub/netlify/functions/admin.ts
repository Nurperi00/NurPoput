import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { bookings, rides, users, parcels } from "../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

export default async (req: Request) => {
  const user = await getSessionUser(req);

  if (!user) {
    return Response.json({ error: "Требуется вход." }, { status: 401 });
  }

  // Доступ к панели администратора — только для роли admin (серверная проверка).
  if (user.role !== "admin") {
    return Response.json({ error: "Доступ только для администратора." }, { status: 403 });
  }

  if (req.method === "DELETE") {
    const body = await req.json().catch(() => ({}));
    const targetUserId = Number(body.userId);

    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return Response.json({ error: "Неверный ID пользователя." }, { status: 400 });
    }
    if (targetUserId === user.id) {
      return Response.json({ error: "Нельзя удалить свой собственный аккаунт администратора." }, { status: 400 });
    }

    await db.delete(users).where(eq(users.id, targetUserId));
    return Response.json({ ok: true, message: "Лишний профиль успешно удалён." });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const [[userCount], [rideCount], [parcelCount], [bookingCount], userList] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(users),
    db.select({ value: sql<number>`count(*)::int` }).from(rides),
    db.select({ value: sql<number>`count(*)::int` }).from(parcels),
    db.select({ value: sql<number>`count(*)::int` }).from(bookings),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
  ]);

  const latestRides = await db
    .select({
      id: rides.id,
      fromCity: rides.fromCity,
      toCity: rides.toCity,
      date: rides.date,
      price: rides.price,
      seats: rides.seats,
      driverName: users.name,
    })
    .from(rides)
    .innerJoin(users, eq(rides.driverId, users.id))
    .orderBy(desc(rides.createdAt))
    .limit(10);

  return Response.json({
    stats: {
      users: userCount.value,
      rides: rideCount.value,
      parcels: parcelCount.value,
      bookings: bookingCount.value,
    },
    users: userList,
    latestRides,
  });
};

export const config: Config = {
  path: "/api/admin",
};
