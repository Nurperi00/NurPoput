import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getSessionUser, publicUser } from "./lib/auth.ts";

const MAX_BYTES = 750 * 1024;

const FORMATS: Record<string, { ext: string; mime: string }> = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/webp": { ext: "webp", mime: "image/webp" },
};

function avatarStore() {
  return getStore("avatars");
}

function avatarKey(userId: number, ext: string) {
  return `avatar-${userId}.${ext}`;
}

async function findAvatar(userId: number) {
  const store = avatarStore();
  for (const format of Object.values(FORMATS)) {
    const data = await store.get(avatarKey(userId, format.ext), {
      type: "arrayBuffer",
    });
    if (data) return { data, mime: format.mime };
  }
  return null;
}

async function deleteAllAvatars(userId: number) {
  const store = avatarStore();
  await Promise.all(
    Object.values(FORMATS).map((format) =>
      store.delete(avatarKey(userId, format.ext)),
    ),
  );
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const userId = Number(url.searchParams.get("userId"));
    if (!Number.isInteger(userId) || userId < 1) {
      return Response.json(
        { error: "Неверный пользователь." },
        { status: 400 },
      );
    }

    const avatar = await findAvatar(userId);
    if (!avatar) {
      return new Response(null, { status: 404 });
    }

    return new Response(avatar.data, {
      headers: {
        "Content-Type": avatar.mime,
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return Response.json({ error: "Требуется вход." }, { status: 401 });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const dataUrl = String(body.dataUrl ?? "");
    const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl,
    );

    if (!match) {
      return Response.json(
        { error: "Поддерживаются изображения PNG, JPEG или WebP." },
        { status: 400 },
      );
    }

    const format = FORMATS[match[1]];
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length === 0) {
      return Response.json({ error: "Пустой файл." }, { status: 400 });
    }
    if (buffer.length > MAX_BYTES) {
      return Response.json(
        {
          error:
            "Фото слишком большое. После сжатия оно должно занимать до 700 КБ.",
        },
        { status: 413 },
      );
    }

    await deleteAllAvatars(user.id);
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    await avatarStore().set(avatarKey(user.id, format.ext), bytes.buffer);

    const [updated] = await db
      .update(users)
      .set({ avatarVersion: sql`${users.avatarVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning();

    return Response.json({ user: publicUser(updated) });
  }

  if (req.method === "DELETE") {
    await deleteAllAvatars(user.id);

    const [updated] = await db
      .update(users)
      .set({ avatarVersion: 0 })
      .where(eq(users.id, user.id))
      .returning();

    return Response.json({ user: publicUser(updated) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/avatar",
};
