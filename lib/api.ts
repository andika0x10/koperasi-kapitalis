import type { Env } from "./env";
import { authenticate, role, unlocked, limit } from "./auth";
import { json, failure } from "./http";
import { HttpError, text } from "./security";
import { findPlaces } from "./geocoding";
import { placeSearchUrl } from "./map-config";
import { auditLogs, pageNumber } from "./audit";
import { salesReport, purchaseReport } from "./reports";
import type { Order } from "./types";
import { productPhotos } from "./products";
import { emptyProfile } from "./delivery";

export async function api(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method,
      db = env.DB;
    if (method !== "GET" && method !== "HEAD") {
      return env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch(request);
    }
    if (path === "/api/me" && method === "GET") {
      const auth = await authenticate(request, env, false);
      return json({ user: auth ? { id: auth.id, username: auth.username, role: auth.role, status: auth.status } : null, csrf: auth?.csrf || null });
    }
    if (path === "/api/products" && method === "GET") {
      const auth = url.searchParams.get("all") === "1" ? await authenticate(request, env) : null;
      if (auth) {
        role(auth, "owner", "staff");
        unlocked(auth);
      }
      const query = url.searchParams.get("q")?.slice(0, 150) || "",
        category = url.searchParams.get("category")?.slice(0, 60) || "";
      const products = await db
        .prepare(`SELECT * FROM products WHERE (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(description),lower(?))>0) AND (?='' OR category=?) ORDER BY name LIMIT 500`)
        .bind(query, query, query, category, category)
        .all();
      const categories = await db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all<{ category: string }>();
      return json({ products: await productPhotos(db, products.results as { id: string }[]), categories: categories.results.map((c) => c.category) });
    }
    if (path === "/api/settings" && method === "GET") return json(await db.prepare("SELECT * FROM settings WHERE id=1").first());
    const attachment = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachment && method === "GET") {
      const meta = await db
        .prepare("SELECT id,kind,owner_id,mime,checksum FROM attachments WHERE id=?")
        .bind(attachment[1])
        .first<{ id: string; kind: string; owner_id: string; mime: string; checksum: string }>();
      if (!meta) throw new HttpError(404, "Gambar tidak ditemukan.");
      if (meta.kind === "proof") {
        const auth = (await authenticate(request, env))!;
        unlocked(auth);
        if (auth.role === "buyer" && !(await db.prepare("SELECT id FROM orders WHERE proof_id=? AND user_id=?").bind(meta.id, auth.id).first()))
          throw new HttpError(404, "Gambar tidak ditemukan.");
      }
      const result = await db.prepare("SELECT data FROM attachments WHERE id=?").bind(meta.id).first<{ data: number[] | ArrayBuffer }>();
      const bytes = Array.isArray(result!.data) ? new Uint8Array(result!.data) : new Uint8Array(result!.data);
      return new Response(bytes, {
        headers: {
          "content-type": meta.mime,
          "cache-control": meta.kind === "proof" ? "private, no-store" : "public, max-age=86400, immutable",
          "x-content-type-options": "nosniff",
          "content-disposition": "inline",
        },
      });
    }
    const auth = (await authenticate(request, env))!;
    if (path === "/api/sessions" && method === "GET") {
      const now = Date.now(),
        sessions = await db
          .prepare("SELECT id,device,created_at,last_seen FROM sessions WHERE user_id=? AND expires_at>? AND last_seen>? ORDER BY last_seen DESC")
          .bind(auth.id, now, now - 7 * 86400000)
          .all<{ id: string }>();
      return json(sessions.results.map((s) => ({ ...s, current: s.id === auth.session_id })));
    }
    unlocked(auth);
    if (path === "/api/places" && method === "GET") {
      role(auth, "buyer", "owner");
      const query = text(url.searchParams.get("q"), "Alamat pencarian", 200, 3).replace(/\s+/g, " ");
      await limit(env, `place-search:${auth.id}`, 10, 60000);
      const endpoint = env.GEOCODING_URL || placeSearchUrl;
      const cacheUrl = new URL("/__place_cache", url.origin);
      cacheUrl.searchParams.set("q", query.toLowerCase());
      cacheUrl.searchParams.set("provider", endpoint);
      const cacheKey = new Request(cacheUrl.toString());
      const cache = await caches.open("place-search");
      const cached = await cache.match(cacheKey);
      if (cached) return json(await cached.json());
      await limit(env, "place-search:global", 1, 1100);
      const results = await findPlaces(query, endpoint);
      await cache.put(cacheKey, Response.json(results, { headers: { "Cache-Control": "public, max-age=86400" } }));
      return json(results);
    }
    if (path === "/api/profile") {
      role(auth, "buyer");
      return json((await db.prepare("SELECT full_name,whatsapp,address,latitude,longitude FROM delivery_profiles WHERE user_id=?").bind(auth.id).first()) || emptyProfile);
    }
    if (path === "/api/reports/sales") {
      role(auth, "owner");
      const expired = await env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch("https://internal/internal/expire");
      if (!expired.ok) throw new HttpError(503, "Status pesanan belum tersedia. Coba lagi.");
      return json(await salesReport(db, url));
    }
    if (path === "/api/reports/purchases") {
      role(auth, "buyer");
      const expired = await env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch("https://internal/internal/expire");
      if (!expired.ok) throw new HttpError(503, "Status pesanan belum tersedia. Coba lagi.");
      return json(await purchaseReport(db, url, auth.id));
    }
    if (path === "/api/cart") {
      role(auth, "buyer");
      return json(
        await productPhotos(
          db,
          (await db.prepare("SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.name").bind(auth.id).all()).results as {
            id: string;
          }[]
        )
      );
    }
    if (path === "/api/orders" || /^\/api\/orders\/[^/]+$/.test(path)) {
      const expired = await env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch("https://internal/internal/expire");
      if (!expired.ok) throw new HttpError(503, "Status pesanan belum tersedia. Coba lagi.");
      if (path === "/api/orders") {
        const page = Math.max(0, Math.min(10000, Number(url.searchParams.get("page")) || 0)),
          status = url.searchParams.get("status") || "";
        const result = await db
          .prepare(
            `SELECT o.*,o.buyer_username AS username FROM orders o WHERE (? IN ('owner','staff') OR o.user_id=?) AND (?='' OR o.status=?) ORDER BY CASE WHEN o.status='review' THEN 0 ELSE 1 END,o.created_at DESC LIMIT 30 OFFSET ?`
          )
          .bind(auth.role, auth.id, status, status, page * 30)
          .all();
        return json(result.results);
      }
      const order = await db
        .prepare("SELECT o.*,o.buyer_username AS username FROM orders o WHERE o.id=? AND (? IN ('owner','staff') OR o.user_id=?)")
        .bind(path.split("/").pop(), auth.role, auth.id)
        .first<Order>();
      if (!order) throw new HttpError(404, "Pesanan tidak ditemukan.");
      const [items, events] = await Promise.all([
        db.prepare("SELECT id,name,unit,price,quantity FROM order_items WHERE order_id=? ORDER BY name").bind(order.id).all(),
        db.prepare("SELECT id,status,note,created_at,actor_id,actor_username FROM order_events WHERE order_id=? ORDER BY created_at,id").bind(order.id).all(),
      ]);
      return json({ ...order, items: items.results, events: events.results });
    }
    if (path === "/api/users") {
      role(auth, "owner", "staff");
      const q = (url.searchParams.get("q") || "").slice(0, 32),
        filter = auth.role === "staff" ? "buyer" : url.searchParams.get("role") || "",
        status = url.searchParams.get("status") || "";
      if (!["", "buyer", "staff", "owner"].includes(filter) || !["", "active", "pending", "reset_required"].includes(status)) throw new HttpError(400, "Filter tidak valid.");
      return json(
        (
          await db
            .prepare(
              "SELECT id,username,role,status,created_at FROM users WHERE instr(lower(username),lower(?))>0 AND (?='' OR role=?) AND (?='' OR status=?) ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?"
            )
            .bind(q, filter, filter, status, status, pageNumber(url) * 30)
            .all()
        ).results
      );
    }
    if (path === "/api/audit-logs") {
      role(auth, "owner");
      return json(await auditLogs(env, url));
    }
    throw new HttpError(404, "Halaman tidak ditemukan.");
  } catch (error) {
    return failure(error);
  }
}
