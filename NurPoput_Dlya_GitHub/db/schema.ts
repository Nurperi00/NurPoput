import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  phone: text("phone").unique(),
  googleId: text("google_id").unique(),
  showPhone: boolean("show_phone").notNull().default(true),
  avatarVersion: integer("avatar_version").notNull().default(0),
  role: text().notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: text().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const rides = pgTable("rides", {
  id: serial().primaryKey(),
  driverId: integer("driver_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  date: text().notNull(),
  time: text().notNull(),
  seats: integer().notNull(),
  price: integer().notNull(),
  car: text().notNull(),
  phone: text().notNull(),
  comment: text().notNull().default(""),
  status: text().notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: serial().primaryKey(),
  rideId: integer("ride_id")
    .notNull()
    .references(() => rides.id, { onDelete: "cascade" }),
  passengerId: integer("passenger_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  seats: integer().notNull(),
  status: text().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const parcels = pgTable("parcels", {
  id: serial().primaryKey(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  senderName: text("sender_name").notNull(),
  senderPhone: text("sender_phone").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  date: text().notNull(),
  size: text().notNull(),
  description: text().notNull().default(""),
  status: text().notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text().notNull(),
  title: text().notNull(),
  body: text().notNull().default(""),
  read: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const driverProfiles = pgTable("driver_profiles", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  carModel: text("car_model").notNull().default(""),
  verified: boolean().notNull().default(false),
  totalRides: integer("total_rides").notNull().default(0),
});

export const messages = pgTable("messages", {
  id: serial().primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const phoneCodes = pgTable("phone_codes", {
  id: serial().primaryKey(),
  phone: text().notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer().notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  id: serial().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  channel: text().notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer().notNull().default(0),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
