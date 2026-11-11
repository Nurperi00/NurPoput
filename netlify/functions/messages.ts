import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { bookings, messages, notifications, rides, users } from "../../db/schema.js";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getSessionUser } from "./lib/auth.ts";

type BookingRow = typeof bookings.$inferSelect;
type RideRow = typeof rides.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

async function loadThreads(userId: number) {
  const passengerRows = await db
    .select({ booking: bookings, ride: rides })
    .from(bookings)
    .innerJoin(rides, eq(bookings.rideId, rides.id))
    .where(eq(bookings.passengerId, userId));

  const driverRows = await db
    .select({ booking: bookings, ride: rides, passengerName: users.name })
    .from(bookings)
    .innerJoin(rides, eq(bookings.rideId, rides.id))
    .innerJoin(users, eq(bookings.passengerId, users.id))
    .where(eq(rides.driverId, userId));

  const threads = new Map<
    number,
    {
      booking: BookingRow;
      ride: RideRow;
      role: "driver" | "passenger";
      otherId: number;
      otherName?: string;
    }
  >();

  for (const row of passengerRows) {
    threads.set(row.booking.id, {
      booking: row.booking,
      ride: row.ride,
      role: "passenger",
      otherId: row.ride.driverId,
    });
  }

  for (const row of driverRows) {
    threads.set(row.booking.id, {
      booking: row.booking,
      ride: row.ride,
      role: "driver",
      otherId: row.booking.passengerId,
      otherName: row.passengerName,
    });
  }

  const list = [...threads.values()];
  if (list.length === 0) return [];

  const otherIds = [...new Set(list.map((item) => item.otherId))];
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      showPhone: users.showPhone,
    })
    .from(users)
    .where(inArray(users.id, otherIds));
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const bookingIds = list.map((item) => item.booking.id);
  const allMessages = await db
    .select()
    .from(messages)
    .where(inArray(messages.bookingId, bookingIds))
    .orderBy(asc(messages.createdAt));

  const byBooking = new Map<number, MessageRow[]>();
  for (const message of allMessages) {
    const bucket = byBooking.get(message.bookingId) ?? [];
    bucket.push(message);
    byBooking.set(message.bookingId, bucket);
  }

  const result = list.map((item) => {
    const person = peopleById.get(item.otherId);
    const bucket = byBooking.get(item.booking.id) ?? [];
    const last = bucket.length > 0 ? bucket[bucket.length - 1] : null;
    const unread = bucket.filter(
      (message) => message.senderId !== userId && !message.readAt,
    ).length;

    return {
      bookingId: item.booking.id,
      rideId: item.ride.id,
      fromCity: item.ride.fromCity,
      toCity: item.ride.toCity,
      date: item.ride.date,
      time: item.ride.time,
      role: item.role,
      otherId: item.otherId,
      otherName:
        item.role === "driver"
          ? item.otherName ?? "Участник"
          : person?.name ?? "Водитель",
      otherPhone:
        person?.showPhone && person.phone ? person.phone : null,
      bookingStatus: item.booking.status,
      seats: item.booking.seats,
      price: item.ride.price,
      unread,
      lastMessage: last
        ? {
            body: last.body,
            createdAt: new Date(last.createdAt).toISOString(),
            mine: last.senderId === userId,
          }
        : null,
      updatedAt:
        last
          ? new Date(last.createdAt).toISOString()
          : new Date(item.booking.createdAt).toISOString(),
    };
  });

  result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return result;
}

export default async (req: Request) => {
  const user = await getSessionUser(req);
  if (!user) {
    return Response.json({ error: "Требуется вход." }, { status: 401 });
  }

  const url = new URL(req.url);
  const bookingIdParam = url.searchParams.get("bookingId");

  if (req.method === "GET" && !bookingIdParam) {
    return Response.json({ threads: await loadThreads(user.id) });
  }

  if (req.method === "GET") {
    const bookingId = Number(bookingIdParam);
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return Response.json({ error: "Неверный чат." }, { status: 400 });
    }

    const [row] = await db
      .select({ booking: bookings, ride: rides })
      .from(bookings)
      .innerJoin(rides, eq(bookings.rideId, rides.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) {
      return Response.json({ error: "Чат не найден." }, { status: 404 });
    }

    const isPassenger = row.booking.passengerId === user.id;
    const isDriver = row.ride.driverId === user.id;
    if (!isPassenger && !isDriver) {
      return Response.json(
        { error: "Чат доступен только участникам поездки." },
        { status: 403 },
      );
    }

    const otherId = isPassenger ? row.ride.driverId : row.booking.passengerId;
    const [other] = await db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        showPhone: users.showPhone,
      })
      .from(users)
      .where(eq(users.id, otherId))
      .limit(1);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.bookingId, bookingId))
      .orderBy(asc(messages.createdAt));

    await db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.bookingId, bookingId),
          ne(messages.senderId, user.id),
          isNull(messages.readAt),
        ),
      );

    return Response.json({
      thread: {
        bookingId,
        fromCity: row.ride.fromCity,
        toCity: row.ride.toCity,
        date: row.ride.date,
        time: row.ride.time,
        role: isPassenger ? "passenger" : "driver",
        otherName: other?.name ?? "Участник",
        otherPhone: other?.showPhone && other.phone ? other.phone : null,
        bookingStatus: row.booking.status,
        seats: row.booking.seats,
        price: row.ride.price,
      },
      messages: rows.map((message) => ({
        id: message.id,
        mine: message.senderId === user.id,
        body: message.body,
        createdAt: new Date(message.createdAt).toISOString(),
        read: Boolean(message.readAt),
      })),
    });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const bookingId = Number(body.bookingId);
    const text = String(body.body ?? "").trim();

    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return Response.json({ error: "Неверный чат." }, { status: 400 });
    }
    if (!text) {
      return Response.json({ error: "Введите сообщение." }, { status: 400 });
    }
    if (text.length > 2000) {
      return Response.json(
        { error: "Сообщение слишком длинное (до 2000 символов)." },
        { status: 400 },
      );
    }

    const [row] = await db
      .select({ booking: bookings, ride: rides })
      .from(bookings)
      .innerJoin(rides, eq(bookings.rideId, rides.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) {
      return Response.json({ error: "Чат не найден." }, { status: 404 });
    }

    const isParticipant =
      row.booking.passengerId === user.id || row.ride.driverId === user.id;
    if (!isParticipant) {
      return Response.json(
        { error: "Писать в чат могут только участники поездки." },
        { status: 403 },
      );
    }

    const [message] = await db
      .insert(messages)
      .values({ bookingId, senderId: user.id, body: text })
      .returning();

    const recipientId =
      row.booking.passengerId === user.id
        ? row.ride.driverId
        : row.booking.passengerId;

    await db.insert(notifications).values({
      userId: recipientId,
      type: "message",
      title: "Новое сообщение в чате",
      body: `${user.name}: ${text.slice(0, 140)}`,
    });

    return Response.json(
      {
        message: {
          id: message.id,
          mine: true,
          body: message.body,
          createdAt: new Date(message.createdAt).toISOString(),
        },
      },
      { status: 201 },
    );
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/messages",
};
