import { DurableObject } from "cloudflare:workers";
import type { Env, Auth } from "./env";
import type { Product, Settings, Order, CartItem } from "./types";
import { authenticate, csrf, role, unlocked, createSession, sessionCookie, limit } from "./auth";
import { audit, safeDetails, username } from "./audit";
import { body, json, failure } from "./http";
import { HttpError, text, integer, imageFile, digest, random, validPassword, hashPassword, verifyPassword } from "./security";

export class RateLimiter extends DurableObject<Env> {
  async fetch(request: Request) {
    const { max, windowMs } = (await request.json()) as { max: number; windowMs: number };
    const now = Date.now();
    const allowed = await this.ctx.storage.transaction(async (storage) => {
      let entry = await storage.get<{ start: number; count: number }>("window");
      if (!entry || entry.start + windowMs <= now) entry = { start: now, count: 0 };
      if (entry.count >= max) return false;
      entry.count++;
      await storage.put("window", entry);
      await storage.setAlarm(entry.start + windowMs);
      return true;
    });
    return new Response(null, { status: allowed ? 204 : 429 });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export class Commerce extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private attemptedUsername: string | null = null;
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation);
    this.tail = task.catch(() => {});
    return task;
  }
  async fetch(request: Request) {
    return this.serialized(async () => {
      this.attemptedUsername = null;
      try {
        await this.arm();
        return await this.route(request);
      } catch (error) {
        const response = failure(error);
        if (!["GET", "HEAD"].includes(request.method) && response.status < 500) {
          const actor = await authenticate(request, this.env, false);
          const path = new URL(request.url).pathname;
          await audit(
            this.env.DB,
            actor || { id: null, username: "Tidak terautentikasi" },
            path === "/api/login" ? "login_failed" : "request_rejected",
            path.slice(0, 180),
            "request",
            { code: response.status, ...(this.attemptedUsername ? { username: this.attemptedUsername } : {}) },
            "failure"
          ).run();
        }
        return response;
      }
    });
  }
  async alarm() {
    await this.serialized(async () => {
      await this.arm();
      await this.expire();
      await this.env.DB.prepare("DELETE FROM audit_log WHERE created_at<?")
        .bind(Date.now() - 365 * 86400000)
        .run();
      await this.schedule();
    });
  }
  private async arm() {
    const old = await this.ctx.storage.getAlarm();
    if (!old || old > Date.now() + 60000) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  private async schedule() {
    const next = await this.env.DB.prepare("SELECT MIN(expires_at) AS next FROM orders WHERE status='pending'").first<{ next: number | null }>();
    if (next?.next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(next.next, Date.now() + 60000)));
    else await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
  private async expire() {
    const db = this.env.DB;
    const pending = await db.prepare("SELECT id FROM orders WHERE status='pending' AND expires_at<=?").bind(Date.now()).all<{ id: string }>();
    for (const order of pending.results)
      await db.batch([
        db.prepare("UPDATE orders SET status='expired',event_actor_id=NULL WHERE id=? AND status='pending'").bind(order.id),
        audit(db, null, "order_expired", order.id, "order", { before: { status: "pending" }, after: { status: "expired" } }),
      ]);
  }
  private audit(auth: Auth, action: string, target: string, details: unknown = null) {
    const type = action.startsWith("product")
      ? "product"
      : action.startsWith("settings")
        ? "settings"
        : ["approved", "rejected", "shipped", "completed", "checkout", "proof_uploaded"].includes(action)
          ? "order"
          : "user";
    return audit(this.env.DB, auth, action, target, type, details);
  }
  private async order(id: string, auth: Auth) {
    const order = await this.env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<Order>();
    if (!order || (auth.role !== "seller" && order.user_id !== auth.id)) throw new HttpError(404, "Pesanan tidak ditemukan.");
    return order;
  }
  private async attachment(request: Request, auth: Auth, kind: string) {
    const { bytes, mime } = await imageFile(request);
    const id = crypto.randomUUID(),
      checksum = await digestBytes(bytes);
    return {
      id,
      checksum,
      statement: this.env.DB.prepare("INSERT INTO attachments(id,owner_id,kind,mime,bytes,checksum,data,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(
        id,
        auth.id,
        kind,
        mime,
        bytes.length,
        checksum,
        bytes.buffer,
        Date.now()
      ),
    };
  }
  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname,
      method = request.method,
      db = this.env.DB;
    if (path === "/internal/expire") {
      await this.arm();
      await this.expire();
      await this.schedule();
      return json({ ok: true });
    }
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new HttpError(403, "Asal permintaan tidak valid.");
    if (!["POST", "PUT", "DELETE"].includes(method)) throw new HttpError(405, "Metode tidak didukung.");
    if ((path === "/api/login" || path === "/api/register") && method === "POST") {
      const data = await body(request),
        name = username(data.username);
      this.attemptedUsername = name;
      validPassword(data.password);
      const ip = request.headers.get("cf-connecting-ip") || "local";
      await limit(this.env, `auth:ip:${ip}`, 30, 15 * 60000);
      await limit(this.env, `auth:user:${name}`, 10, 15 * 60000);
      let user = await db
        .prepare("SELECT id,username,password_hash,deleted_at FROM users WHERE username=?")
        .bind(name)
        .first<{ id: string; username: string; password_hash: string; deleted_at: number | null }>();
      const statements: D1PreparedStatement[] = [];
      if (path === "/api/register") {
        if (user) throw new HttpError(409, "Username sudah digunakan.");
        await limit(this.env, `register:${ip}`, 5, 3600000);
        const id = crypto.randomUUID(),
          hash = await hashPassword(data.password);
        user = { id, username: name, password_hash: hash, deleted_at: null };
        statements.push(db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'buyer',?)").bind(id, name, hash, Date.now()));
        statements.push(audit(db, user, "registered", id, "user", { after: { username: name, role: "buyer" } }));
      } else {
        const verified = user ? await verifyPassword(data.password, user.password_hash) : (await hashPassword(data.password, "0".repeat(64)), false);
        if (!verified || !user || user.deleted_at !== null) throw new HttpError(401, "Username atau password salah.");
      }
      statements.push(audit(db, user!, "login", user!.id, "user"));
      const token = await createSession(this.env, request, user!.id, statements);
      // CLI recovery writes directly to D1, outside the coordinator queue.
      const current = await db
        .prepare("SELECT password_hash,username,deleted_at FROM users WHERE id=?")
        .bind(user!.id)
        .first<{ password_hash: string; username: string; deleted_at: number | null }>();
      if (!current || current.password_hash !== user!.password_hash || current.username !== name || current.deleted_at !== null) {
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(await digest(token))
          .run();
        throw new HttpError(401, "Akun berubah. Silakan masuk kembali.");
      }
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, request) });
    }
    const auth = (await authenticate(request, this.env))!;
    csrf(request, auth);
    if (path === "/api/password" && method === "POST") {
      const data = await body(request);
      validPassword(data.password);
      const current = text(data.current, "Password saat ini", 128);
      const user = await db.prepare("SELECT password_hash FROM users WHERE id=?").bind(auth.id).first<{ password_hash: string }>();
      if (!user || !(await verifyPassword(current, user.password_hash))) throw new HttpError(400, "Password saat ini salah.");
      const hash = await hashPassword(data.password);
      await db.batch([
        db.prepare("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?").bind(hash, auth.id),
        db.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(auth.id, auth.session_id),
        this.audit(auth, "password_changed", auth.id),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/logout" && method === "POST") {
      await db.batch([db.prepare("DELETE FROM sessions WHERE id=?").bind(auth.session_id), this.audit(auth, "logout", auth.id)]);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, 0) });
    }
    if (path === "/api/sessions/revoke" && method === "POST") {
      const data = await body(request);
      const target = data.all === true ? null : text(data.id, "Sesi", 100);
      const existing = await db.prepare("SELECT id FROM sessions WHERE user_id=? AND (? IS NULL OR id=?)").bind(auth.id, target, target).all();
      if (existing.results.length)
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE user_id=? AND (? IS NULL OR id=?)").bind(auth.id, target, target),
          this.audit(auth, "sessions_revoked", auth.id, { all: data.all === true, count: existing.results.length }),
        ]);
      return json({ ok: true });
    }
    unlocked(auth);
    if (path === "/api/username" && method === "PUT") {
      const data = await body(request),
        name = username(data.username);
      const user = await db.prepare("SELECT password_hash FROM users WHERE id=?").bind(auth.id).first<{ password_hash: string }>();
      if (!user || !(await verifyPassword(text(data.current, "Password saat ini", 128), user.password_hash))) throw new HttpError(400, "Password saat ini salah.");
      if (name === auth.username) return json({ ok: true });
      await db.batch([
        db.prepare("UPDATE users SET username=? WHERE id=?").bind(name, auth.id),
        db.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(auth.id, auth.session_id),
        this.audit(auth, "username_changed", auth.id, { before: { username: auth.username }, after: { username: name } }),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/cart" && method === "PUT") {
      role(auth, "buyer");
      const data = await body(request),
        id = text(data.product_id, "Produk", 100),
        qty = integer(data.quantity, "Jumlah", 0, 999);
      const previous = await db.prepare("SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?").bind(auth.id, id).first<{ quantity: number }>();
      if ((previous?.quantity || 0) === qty) return json({ ok: true });
      if (!qty)
        await db.batch([
          db.prepare("DELETE FROM cart_items WHERE user_id=? AND product_id=?").bind(auth.id, id),
          audit(db, auth, "cart_updated", id, "cart", { before: { quantity: previous?.quantity || 0 }, after: { quantity: qty } }),
        ]);
      else {
        const product = await db.prepare("SELECT stock FROM products WHERE id=? AND archived=0").bind(id).first<{ stock: number }>();
        if (!product) throw new HttpError(404, "Produk tidak tersedia.");
        if (qty > product.stock) throw new HttpError(409, "Jumlah melebihi stok tersedia.");
        const count = await db.prepare("SELECT COUNT(*) AS n FROM cart_items WHERE user_id=? AND product_id<>?").bind(auth.id, id).first<{ n: number }>();
        if (count!.n >= 20) throw new HttpError(400, "Maksimal 20 jenis barang per pesanan.");
        await db.batch([
          db
            .prepare("INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity")
            .bind(auth.id, id, qty),
          audit(db, auth, "cart_updated", id, "cart", { before: { quantity: previous?.quantity || 0 }, after: { quantity: qty } }),
        ]);
      }
      return json({ ok: true });
    }
    if (path === "/api/checkout" && method === "POST") {
      role(auth, "buyer");
      const data = await body(request),
        key = text(data.key, "Kunci checkout", 80, 16);
      const previous = await db.prepare("SELECT id FROM orders WHERE user_id=? AND checkout_key=?").bind(auth.id, key).first();
      if (previous) return json(previous);
      const recipient = text(data.recipient, "Nama penerima", 100),
        phone = text(data.phone, "Nomor HP", 25, 8),
        address = text(data.address, "Alamat lengkap", 1000, 15);
      if (!/^[+\d\s()-]{8,25}$/.test(phone)) throw new HttpError(400, "Nomor HP tidak valid.");
      const config = (await db.prepare("SELECT * FROM settings WHERE id=1").first<Settings>())!;
      if (config.shipping_fee === null) throw new HttpError(409, "Seller belum mengatur ongkir.");
      const bankReady = !!(config.bank_name && config.bank_account && config.bank_holder);
      if ((data.payment_method === "bank" && !bankReady) || (data.payment_method === "qris" && !config.qris_id) || !["bank", "qris"].includes(String(data.payment_method)))
        throw new HttpError(400, "Metode pembayaran belum tersedia.");
      const cart = await db.prepare("SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").bind(auth.id).all<CartItem>();
      if (!cart.results.length || cart.results.length > 20) throw new HttpError(400, "Isi keranjang dengan 1–20 jenis barang.");
      if (cart.results.some((p) => p.archived || p.stock < p.quantity)) throw new HttpError(409, "Stok berubah. Periksa keranjang sebelum checkout.");
      const subtotal = cart.results.reduce((s, p) => s + p.price * p.quantity, 0),
        total = subtotal + config.shipping_fee;
      if (data.expected_total !== total) throw new HttpError(409, "Harga atau ongkir berubah. Muat ulang dan periksa total sebelum checkout.");
      const now = Date.now(),
        id = crypto.randomUUID();
      await this.arm(); // Persist wake-up before D1 commit; a crash cannot strand a reservation.
      await db.batch([
        db
          .prepare(
            `INSERT INTO orders(id,user_id,checkout_key,status,recipient,phone,address,subtotal,shipping_fee,total,payment_method,payment_snapshot,created_at,expires_at) VALUES(?,?,?,'pending',?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(id, auth.id, key, recipient, phone, address, subtotal, config.shipping_fee, total, data.payment_method, JSON.stringify(config), now, now + 3600000),
        ...cart.results.map((p) =>
          db
            .prepare("INSERT INTO order_items(id,order_id,product_id,name,unit,price,quantity) VALUES(?,?,?,?,?,?,?)")
            .bind(crypto.randomUUID(), id, p.id, p.name, p.unit, p.price, p.quantity)
        ),
        db.prepare("DELETE FROM cart_items WHERE user_id=?").bind(auth.id),
        db
          .prepare("INSERT INTO order_events(id,order_id,actor_id,actor_username,status,created_at) VALUES(?,?,?,?,'pending',?)")
          .bind(crypto.randomUUID(), id, auth.id, auth.username, now),
        this.audit(auth, "checkout", id, { after: { status: "pending", total, payment_method: data.payment_method } }),
      ]);
      return json({ id }, 201);
    }
    const proof = path.match(/^\/api\/orders\/([^/]+)\/proof$/);
    if (proof && method === "POST") {
      role(auth, "buyer");
      const order = await this.order(proof[1], auth),
        file = await this.attachment(request, auth, "proof");
      if (order.proof_id) {
        const old = await db.prepare("SELECT checksum FROM attachments WHERE id=?").bind(order.proof_id).first<{ checksum: string }>();
        if (old?.checksum === file.checksum) return json({ ok: true });
        throw new HttpError(409, "Bukti sudah diunggah dan tidak dapat diganti.");
      }
      // Check the deadline after reading the body, not when the request started.
      if (order.status !== "pending" || order.expires_at <= Date.now()) {
        await this.expire();
        throw new HttpError(409, "Pesanan kedaluwarsa atau tidak menerima bukti. Buat pesanan baru.");
      }
      const now = Date.now();
      await db.batch([
        file.statement,
        db
          .prepare("UPDATE orders SET proof_id=?,proof_at=?,event_actor_id=?,status='review' WHERE id=? AND status='pending' AND expires_at>?")
          .bind(file.id, now, auth.id, order.id, now),
        this.audit(auth, "proof_uploaded", order.id, { before: { status: order.status }, after: { status: "review" } }),
        audit(db, auth, "attachment_uploaded", file.id, "attachment", { kind: "proof" }),
      ]);
      return json({ ok: true });
    }
    role(auth, "seller");
    if (path === "/api/users" && method === "POST") {
      const data = await body(request),
        name = username(data.username);
      if (!["buyer", "seller"].includes(String(data.role))) throw new HttpError(400, "Role tidak valid.");
      const id = crypto.randomUUID(),
        password = "KK-" + random().slice(0, 20),
        hash = await hashPassword(password);
      await db.batch([
        db.prepare("INSERT INTO users(id,username,password_hash,role,must_change_password,created_at) VALUES(?,?,?,?,1,?)").bind(id, name, hash, data.role, Date.now()),
        this.audit(auth, "user_created", id, { after: { username: name, role: data.role } }),
      ]);
      return json({ id, username: name, password }, 201);
    }
    const deletion = path.match(/^\/api\/users\/([^/]+)$/);
    if (deletion && method === "DELETE") {
      if (deletion[1] === auth.id) throw new HttpError(400, "Anda tidak dapat menghapus akun sendiri.");
      const user = await db
        .prepare("SELECT id,username,role,deleted_at FROM users WHERE id=?")
        .bind(deletion[1])
        .first<{ id: string; username: string; role: string; deleted_at: number | null }>();
      if (!user) throw new HttpError(404, "Pengguna tidak ditemukan.");
      if (user.deleted_at !== null) return json({ ok: true });
      if (user.role === "seller") {
        const count = await db.prepare("SELECT COUNT(*) n FROM users WHERE role='seller' AND deleted_at IS NULL").first<{ n: number }>();
        if (count!.n <= 1) throw new HttpError(409, "Seller aktif terakhir tidak dapat dihapus.");
      }
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE users SET deleted_at=? WHERE id=?").bind(now, user.id),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
        this.audit(auth, "user_deleted", user.id, { before: { username: user.username, role: user.role }, after: { deleted_at: now } }),
      ]);
      return json({ ok: true });
    }
    if ((path === "/api/products" && method === "POST") || (/^\/api\/products\/[^/]+$/.test(path) && method === "PUT")) {
      const data = await body(request),
        id = method === "POST" ? crypto.randomUUID() : path.split("/").pop()!;
      if (method === "PUT") {
        const current = await db.prepare("SELECT revision FROM products WHERE id=?").bind(id).first<{ revision: number }>();
        if (!current) throw new HttpError(404, "Produk tidak ditemukan.");
        if (integer(data.revision, "Versi produk") !== current.revision)
          throw new HttpError(409, "Stok atau produk telah berubah. Tutup formulir, muat ulang daftar, lalu edit kembali.");
      }
      const name = text(data.name, "Nama barang", 150),
        description = text(data.description ?? "", "Deskripsi", 3000, 0),
        category = text(data.category, "Kategori", 60),
        unit = text(data.unit, "Satuan", 40),
        price = integer(data.price, "Harga", 1),
        stock = integer(data.stock, "Stok", 0, 999999),
        photo = data.photo_id ? text(data.photo_id, "Foto", 100) : null;
      if (photo && !(await db.prepare("SELECT id FROM attachments WHERE id=? AND kind='product'").bind(photo).first())) throw new HttpError(400, "Foto produk tidak valid.");
      const now = Date.now();
      const previous = method === "PUT" ? await db.prepare("SELECT * FROM products WHERE id=?").bind(id).first<Record<string, unknown>>() : null;
      const after = { name, description, category, unit, price, stock, photo_id: photo, archived: data.archived === true || data.archived === 1 ? 1 : 0 };
      if (previous && JSON.stringify(safeDetails(previous)) === JSON.stringify(safeDetails({ ...previous, ...after }))) return json({ id });
      await db.batch([
        method === "POST"
          ? db
              .prepare("INSERT INTO products(id,name,description,category,unit,price,stock,photo_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
              .bind(id, name, description, category, unit, price, stock, photo, now, now)
          : db
              .prepare("UPDATE products SET name=?,description=?,category=?,unit=?,price=?,stock=?,photo_id=?,archived=?,updated_at=?,revision=revision+1 WHERE id=?")
              .bind(name, description, category, unit, price, stock, photo, data.archived === true || data.archived === 1 ? 1 : 0, now, id),
        this.audit(auth, method === "POST" ? "product_created" : "product_updated", id, { before: previous ? safeDetails(previous) : null, after }),
      ]);
      return json({ id });
    }
    if (path === "/api/attachments" && method === "POST") {
      const kind = new URL(request.url).searchParams.get("kind");
      if (!["product", "qris"].includes(kind || "")) throw new HttpError(400, "Jenis gambar tidak valid.");
      const file = await this.attachment(request, auth, kind!);
      await db.batch([file.statement, audit(db, auth, "attachment_uploaded", file.id, "attachment", { kind })]);
      return json({ id: file.id }, 201);
    }
    if (path === "/api/settings" && method === "PUT") {
      const current = await db.prepare("SELECT * FROM settings WHERE id=1").first<Record<string, unknown>>();
      const data = { ...current, ...(await body(request)) },
        shipping = data.shipping_fee === null ? null : integer(data.shipping_fee, "Ongkir", 0, 10000000),
        bank = text(data.bank_name ?? "", "Bank", 80, 0),
        account = text(data.bank_account ?? "", "Rekening", 80, 0),
        holder = text(data.bank_holder ?? "", "Nama pemilik", 120, 0),
        qris = data.qris_id ? text(data.qris_id, "QRIS", 100) : null;
      if ([bank, account, holder].some(Boolean) && ![bank, account, holder].every(Boolean))
        throw new HttpError(400, "Lengkapi seluruh informasi rekening atau kosongkan semuanya.");
      if (qris && !(await db.prepare("SELECT id FROM attachments WHERE id=? AND kind='qris'").bind(qris).first())) throw new HttpError(400, "Gambar QRIS tidak valid.");
      const after = { shipping_fee: shipping, bank_name: bank, bank_account: account, bank_holder: holder, qris_id: qris };
      if (JSON.stringify(safeDetails(current!)) === JSON.stringify(after)) return json({ ok: true });
      await db.batch([
        db.prepare("UPDATE settings SET shipping_fee=?,bank_name=?,bank_account=?,bank_holder=?,qris_id=? WHERE id=1").bind(shipping, bank, account, holder, qris),
        this.audit(auth, "settings_updated", "1", { before: safeDetails(current!), after }),
      ]);
      return json({ ok: true });
    }
    const decision = path.match(/^\/api\/orders\/([^/]+)\/(decision|ship|complete)$/);
    if (decision && method === "POST") {
      const order = await this.order(decision[1], auth),
        data = await body(request),
        action = decision[2];
      if (action === "decision") {
        if (!["approved", "rejected"].includes(String(data.status))) throw new HttpError(400, "Keputusan tidak valid.");
        const reason = text(data.reason ?? "", "Alasan", 1000, data.status === "rejected" ? 1 : 0);
        if (order.status !== "review") {
          if (order.status === data.status && order.reason === reason) return json({ ok: true });
          throw new HttpError(409, "Keputusan sudah final atau bukti belum diterima.");
        }
        await db.batch([
          db.prepare("UPDATE orders SET status=?,reason=?,decided_at=?,event_actor_id=? WHERE id=? AND status='review'").bind(data.status, reason, Date.now(), auth.id, order.id),
          this.audit(auth, String(data.status), order.id, { before: { status: order.status }, after: { status: data.status } }),
        ]);
      } else if (action === "ship") {
        const courier = text(data.courier, "Nama kurir", 80);
        if (["shipped", "completed"].includes(order.status)) {
          if (order.courier === courier) return json({ ok: true });
          throw new HttpError(409, "Pesanan sudah dikirim dengan nama kurir yang tersimpan.");
        }
        if (order.status !== "approved") throw new HttpError(409, "Hanya pesanan disetujui yang dapat dikirim.");
        await db.batch([
          db.prepare("UPDATE orders SET status='shipped',courier=?,shipped_at=?,event_actor_id=? WHERE id=? AND status='approved'").bind(courier, Date.now(), auth.id, order.id),
          this.audit(auth, "shipped", order.id, { before: { status: order.status }, after: { status: "shipped", courier } }),
        ]);
      } else {
        if (order.status === "completed") return json({ ok: true });
        if (order.status !== "shipped") throw new HttpError(409, "Pesanan belum dikirim.");
        await db.batch([
          db.prepare("UPDATE orders SET status='completed',completed_at=?,event_actor_id=? WHERE id=? AND status='shipped'").bind(Date.now(), auth.id, order.id),
          this.audit(auth, "completed", order.id, { before: { status: order.status }, after: { status: "completed" } }),
        ]);
      }
      return json({ ok: true });
    }
    const reset = path.match(/^\/api\/users\/([^/]+)\/reset$/);
    if (reset && method === "POST") {
      if (reset[1] === auth.id) throw new HttpError(400, "Ganti password sendiri melalui Pengaturan.");
      const user = await db.prepare("SELECT id,username FROM users WHERE id=? AND deleted_at IS NULL").bind(reset[1]).first<{ id: string; username: string }>();
      if (!user) throw new HttpError(404, "Pengguna aktif tidak ditemukan.");
      const password = "KK-" + random().slice(0, 20),
        hash = await hashPassword(password);
      await db.batch([
        db.prepare("UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?").bind(hash, reset[1]),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(reset[1]),
        this.audit(auth, "user_password_reset", reset[1], { username: user.username }),
      ]);
      return json({ password });
    }
    throw new HttpError(404, "Halaman tidak ditemukan.");
  }
}
async function digestBytes(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), (n) => n.toString(16).padStart(2, "0")).join("");
}
