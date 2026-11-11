import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { bookings, rides, parcels, users } from "../../db/schema.js";
import { and, desc, eq, ne } from "drizzle-orm";
import { getSessionUser, publicUser } from "./lib/auth.ts";
import { normalizePhone } from "./lib/phone.ts";

export default async (req: Request) => {
  const user = await getSessionUser(req);

  if (!user) {
    return Response.json({ error: "Требуется вход." }, { status: 401 });
  }

  if (req.method === "GET") {
    const myRides = await db
      .select()
      .from(rides)
      .where(eq(rides.driverId, user.id))
      .orderBy(desc(rides.createdAt));

    const myBookings = await db
      .select({ booking: bookings, ride: rides })
      .from(bookings)
      .innerJoin(rides, eq(bookings.rideId, rides.id))
      .where(eq(bookings.passengerId, user.id))
      .orderBy(desc(bookings.createdAt));

    const driverBookings = await db
      .select({ booking: bookings, ride: rides, passengerName: users.name })
      .from(bookings)
      .innerJoin(rides, eq(bookings.rideId, rides.id))
      .innerJoin(users, eq(bookings.passengerId, users.id))
      .where(eq(rides.driverId, user.id))
      .orderBy(desc(bookings.createdAt));

    const myParcels = await db
      .select()
      .from(parcels)
      .where(eq(parcels.ownerId, user.id))
      .orderBy(desc(parcels.createdAt));

    return Response.json({
      user: publicUser(user),
      rides: myRides,
      bookings: myBookings,
      driverBookings,
      parcels: myParcels,
    });
  }

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const updates: Partial<typeof users.$inferInsert> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) {
        return Response.json({ error: "Имя слишком короткое." }, { status: 400 });
      }
      updates.name = name.slice(0, 80);
    }

    if (body.phone !== undefined) {
      const raw = String(body.phone).trim();
      if (!raw) {
        updates.phone = null;
      } else {
        const phone = normalizePhone(raw);
        if (!phone) {
          return Response.json(
            { error: "Введи корректный номер, например +996 555 12 34 56." },
            { status: 400 },
          );
        }
        const [taken] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.phone, phone), ne(users.id, user.id)))
          .limit(1);
        if (taken) {
          return Response.json(
            { error: "Этот номер уже привязан к другому аккаунту." },
            { status: 409 },
          );
        }
        updates.phone = phone;
      }
    }

    if (body.showPhone !== undefined) {
      updates.showPhone = Boolean(body.showPhone);
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ user: publicUser(user) });
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id))
      .returning();

    return Response.json({ user: publicUser(updated) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/profile",
};
