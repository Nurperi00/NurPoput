import { getStore } from "@netlify/blobs";

export default async (req) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return Response.json({ error: "Missing key" }, { status: 400 });
    }

    const store = getStore("nurpoput");

    if (req.method === "GET") {
      const data = await store.get(key, { type: "json" });
      return Response.json({ ok: true, data: data ?? null });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json().catch(() => null);
      await store.setJSON(key, body);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
};

export const config = {
  path: "/api/sync",
};
