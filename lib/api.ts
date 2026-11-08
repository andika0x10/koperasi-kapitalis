import type { Env, Auth } from "./env";
import { authenticate, createSession, sessionCookie, limit, role, unlocked } from "./auth";
import { body, json, failure } from "./http";
import { digest, hashPassword, HttpError, text, validPassword, verifyPassword } from "./security";
import type { Order } from "./types";

export async function api(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method,
      db = env.DB;
    if (!["GET", "HEAD"].includes(method)) {
      if (request.headers.get("origin") !== url.origin) throw new HttpError(403, "Asal permintaan tidak valid.");
      if (!["POST", "PUT", "DELETE"].includes(method)) throw new HttpError(405, "Metode tidak didukung.");
    }
    if ((path === "/api/register" || path === "/api/login") && method === "POST") {
      const data = await body(request),
        username = text(data.username, "Username", 32, 3).toLowerCase();
      if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new HttpError(400, "Username memakai 3–32 huruf, angka, atau garis bawah.");
      validPassword(data.password);
      const ip = request.headers.get("cf-connecting-ip") || "local";
      await limit(env, `auth:ip:${ip}`, 30, 15 * 60000);
      await limit(env, `auth:user:${username}`, 10, 15 * 60000);
      let user = await db.prepare("SELECT id,password_hash FROM users WHERE username=?").bind(username).first<{ id: string; password_hash: string }>();
      if (path === "/api/register") {
        if (user) throw new HttpError(409, "Username sudah digunakan.");
        await limit(env, `register:${ip}`, 5, 3600000);
        const id = crypto.randomUUID(),
          hash = await hashPassword(data.password);
        await db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'buyer',?)").bind(id, username, hash, Date.now()).run();
        user = { id, password_hash: hash };
      } else if (!user || !(await verifyPassword(data.password, user.password_hash))) {
        // Keep unknown usernames on the same expensive path as incorrect passwords.
        if (!user) await hashPassword(data.password, "0".repeat(64));
        throw new HttpError(401, "Username atau password salah.");
      }
      const token = await createSession(env, request, user.id);
      // A concurrent reset must not grant a session authenticated with an old password.
      const current = await db.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.id).first<{ password_hash: string }>();
      if (current?.password_hash !== user.password_hash) {
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(await digest(token))
          .run();
        throw new HttpError(401, "Password berubah. Silakan masuk kembali.");
      }
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, request) });
    }
    if (path === "/api/me" && method === "GET") {
      const auth = await authenticate(request, env, false);
      return json({ user: auth ? { id: auth.id, username: auth.username, role: auth.role, must_change_password: auth.must_change_password } : null, csrf: auth?.csrf || null });
    }
    if (path === "/api/products" && method === "GET") {
      const auth = url.searchParams.get("all") === "1" ? await authenticate(request, env) : null;
      if (auth) {
        role(auth, "seller");
        unlocked(auth);
      }
      const query = url.searchParams.get("q")?.slice(0, 150) || "",
        category = url.searchParams.get("category")?.slice(0, 60) || "";
      const products = await db
        .prepare(
          `SELECT * FROM products WHERE (?=1 OR archived=0) AND (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(description),lower(?))>0) AND (?='' OR category=?) ORDER BY archived,name LIMIT 500`
        )
        .bind(auth ? 1 : 0, query, query, query, category, category)
        .all();
      const categories = await db.prepare("SELECT DISTINCT category FROM products WHERE archived=0 ORDER BY category").all<{ category: string }>();
      return json({ products: products.results, categories: categories.results.map((c) => c.category) });
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
        if (auth.role !== "seller" && auth.id !== meta.owner_id) throw new HttpError(404, "Gambar tidak ditemukan.");
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
    if (method !== "GET") {
      // Forward original cookie and CSRF to the coordinator; it authenticates again after queueing.
      const res = await env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch(request);
      if (path === "/api/logout" && res.ok) {
        const response = new Response(res.body, res);
        response.headers.set("set-cookie", sessionCookie("", request, 0));
        return response;
      }
      return res;
    }
    unlocked(auth);
    if (path === "/api/cart") {
      role(auth, "buyer");
      return json((await db.prepare("SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.name").bind(auth.id).all()).results);
    }
    if (path === "/api/orders" || /^\/api\/orders\/[^/]+$/.test(path)) {
      const expired = await env.COMMERCE.get(env.COMMERCE.idFromName("store")).fetch("https://internal/internal/expire");
      if (!expired.ok) throw new HttpError(503, "Status pesanan belum tersedia. Coba lagi.");
      if (path === "/api/orders") {
        const page = Math.max(0, Math.min(10000, Number(url.searchParams.get("page")) || 0)),
          status = url.searchParams.get("status") || "";
        const result = await db
          .prepare(
            `SELECT o.*,u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE (?='seller' OR o.user_id=?) AND (?='' OR o.status=?) ORDER BY CASE WHEN o.status='review' THEN 0 ELSE 1 END,o.created_at DESC LIMIT 30 OFFSET ?`
          )
          .bind(auth.role, auth.id, status, status, page * 30)
          .all();
        return json(result.results);
      }
      const order = await db
        .prepare("SELECT o.*,u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=? AND (?='seller' OR o.user_id=?)")
        .bind(path.split("/").pop(), auth.role, auth.id)
        .first<Order>();
      if (!order) throw new HttpError(404, "Pesanan tidak ditemukan.");
      const [items, events] = await Promise.all([
        db.prepare("SELECT id,name,unit,price,quantity FROM order_items WHERE order_id=? ORDER BY name").bind(order.id).all(),
        db.prepare("SELECT id,status,note,created_at FROM order_events WHERE order_id=? ORDER BY created_at,id").bind(order.id).all(),
      ]);
      return json({ ...order, items: items.results, events: events.results });
    }
    if (path === "/api/users") {
      role(auth, "seller");
      const q = (url.searchParams.get("q") || "").slice(0, 32),
        page = Math.max(0, Number(url.searchParams.get("page")) || 0);
      return json(
        (
          await db
            .prepare("SELECT id,username,role,must_change_password,created_at FROM users WHERE instr(username,?)>0 ORDER BY created_at DESC LIMIT 30 OFFSET ?")
            .bind(q, page * 30)
            .all()
        ).results
      );
    }
    throw new HttpError(404, "Halaman tidak ditemukan.");
  } catch (error) {
    return failure(error);
  }
}
