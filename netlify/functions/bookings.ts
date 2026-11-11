import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { bookings, notifications, rides } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

export default async (req: Request) => {
  const user = await getSessionUser(req);
  if (!user) {
    return Response.json({ error: "Сначала войди в аккаунт." }, { status: 401 });
  }

  if (req.method === "GET") {
    const rows = await db
      .select({
        booking: bookings,
        ride: rides,
      })
      .from(bookings)
      .innerJoin(rides, eq(bookings.rideId, rides.id))
      .where(eq(bookings.passengerId, user.id))
      .orderBy(sql`${bookings.createdAt} DESC`);
    return Response.json({ bookings: rows });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const rideId = Number(body.rideId);
    const seats = Number(body.seats ?? 1);

    if (!Number.isInteger(rideId) || rideId < 1) {
      return Response.json({ error: "Неверная поездка." }, { status: 400 });
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
      return Response.json({ error: "Проверь количество мест." }, { status: 400 });
    }

    const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);

    if (!ride || ride.status !== "published") {
      return Response.json({ error: "Поездка не найдена." }, { status: 404 });
    }
    if (ride.driverId === user.id) {
      return Response.json({ error: "Нельзя забронировать свою поездку." }, { status: 400 });
    }
    if (ride.seats < seats) {
      return Response.json({ error: "Недостаточно свободных мест." }, { status: 409 });
    }

    const [booking] = await db
      .insert(bookings)
      .values({ rideId, passengerId: user.id, seats })
      .returning();

    await db
      .update(rides)
      .set({ seats: sql`${rides.seats} - ${seats}` })
      .where(eq(rides.id, rideId));

    // Почта пассажира никогда не раскрывается — только телефон с учётом приватности.
    const contactLine =
      user.phone && user.showPhone
        ? `Связаться с пассажиром: ${user.phone}.`
        : "Написать пассажиру можно в разделе «Сообщения».";

    await db.insert(notifications).values({
      userId: ride.driverId,
      type: "booking",
      title: "Новая заявка на бронирование",
      body:
        `${user.name} забронировал(а) ${seats} ${seats === 1 ? "место" : "места"} ` +
        `на поездку ${ride.fromCity} → ${ride.toCity} (${ride.date} в ${ride.time}). ` +
        contactLine,
    });

    return Response.json(
      {
        booking,
        ride: { ...ride, seats: ride.seats - seats },
        message: "Заявка отправлена водителю. Свяжитесь по номеру " + ride.phone,
      },
      { status: 201 },
    );
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/bookings",
};
