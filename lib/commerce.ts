import { DurableObject } from "cloudflare:workers";
import type { Env, Auth } from "./env";
import type { Product, Settings, Order, CartItem } from "./types";
import { authenticate, csrf, role, unlocked } from "./auth";
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
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation);
    this.tail = task.catch(() => {});
    return task;
  }
  async fetch(request: Request) {
    return this.serialized(async () => {
      try {
        return await this.route(request);
      } catch (error) {
        return failure(error);
      }
    });
  }
  async alarm() {
    await this.serialized(async () => {
      await this.arm();
      await this.expire();
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
    else await this.ctx.storage.deleteAlarm();
  }
  private async expire() {
    await this.env.DB.prepare("UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<=?").bind(Date.now()).run();
  }
  private audit(auth: Auth, action: string, target: string) {
    return this.env.DB.prepare("INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), auth.id, action, target, Date.now());
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
      await db.prepare("DELETE FROM sessions WHERE id=?").bind(auth.session_id).run();
      return json({ ok: true });
    }
    if (path === "/api/sessions/revoke" && method === "POST") {
      const data = await body(request);
      if (data.all === true) await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(auth.id).run();
      else
        await db
          .prepare("DELETE FROM sessions WHERE user_id=? AND id=?")
          .bind(auth.id, text(data.id, "Sesi", 100))
          .run();
      return json({ ok: true });
    }
    unlocked(auth);
    if (path === "/api/cart" && method === "PUT") {
      role(auth, "buyer");
      const data = await body(request),
        id = text(data.product_id, "Produk", 100),
        qty = integer(data.quantity, "Jumlah", 0, 999);
      if (!qty) await db.prepare("DELETE FROM cart_items WHERE user_id=? AND product_id=?").bind(auth.id, id).run();
      else {
        const product = await db.prepare("SELECT stock FROM products WHERE id=? AND archived=0").bind(id).first<{ stock: number }>();
        if (!product) throw new HttpError(404, "Produk tidak tersedia.");
        if (qty > product.stock) throw new HttpError(409, "Jumlah melebihi stok tersedia.");
        const count = await db.prepare("SELECT COUNT(*) AS n FROM cart_items WHERE user_id=? AND product_id<>?").bind(auth.id, id).first<{ n: number }>();
        if (count!.n >= 20) throw new HttpError(400, "Maksimal 20 jenis barang per pesanan.");
        await db
          .prepare("INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity")
          .bind(auth.id, id, qty)
          .run();
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
        db.prepare("INSERT INTO order_events(id,order_id,actor_id,status,created_at) VALUES(?,?,?,'pending',?)").bind(crypto.randomUUID(), id, auth.id, now),
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
        db.prepare("UPDATE orders SET proof_id=?,proof_at=?,status='review' WHERE id=? AND status='pending' AND expires_at>?").bind(file.id, now, order.id, now),
      ]);
      return json({ ok: true });
    }
    role(auth, "seller");
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
      await db.batch([
        method === "POST"
          ? db
              .prepare("INSERT INTO products(id,name,description,category,unit,price,stock,photo_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
              .bind(id, name, description, category, unit, price, stock, photo, now, now)
          : db
              .prepare("UPDATE products SET name=?,description=?,category=?,unit=?,price=?,stock=?,photo_id=?,archived=?,updated_at=?,revision=revision+1 WHERE id=?")
              .bind(name, description, category, unit, price, stock, photo, data.archived === true || data.archived === 1 ? 1 : 0, now, id),
        this.audit(auth, method === "POST" ? "product_created" : "product_updated", id),
      ]);
      return json({ id });
    }
    if (path === "/api/attachments" && method === "POST") {
      const kind = new URL(request.url).searchParams.get("kind");
      if (!["product", "qris"].includes(kind || "")) throw new HttpError(400, "Jenis gambar tidak valid.");
      const file = await this.attachment(request, auth, kind!);
      await file.statement.run();
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
      await db.batch([
        db.prepare("UPDATE settings SET shipping_fee=?,bank_name=?,bank_account=?,bank_holder=?,qris_id=? WHERE id=1").bind(shipping, bank, account, holder, qris),
        this.audit(auth, "settings_updated", "1"),
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
          db.prepare("UPDATE orders SET status=?,reason=?,decided_at=? WHERE id=? AND status='review'").bind(data.status, reason, Date.now(), order.id),
          this.audit(auth, String(data.status), order.id),
        ]);
      } else if (action === "ship") {
        const courier = text(data.courier, "Nama kurir", 80);
        if (["shipped", "completed"].includes(order.status)) {
          if (order.courier === courier) return json({ ok: true });
          throw new HttpError(409, "Pesanan sudah dikirim dengan nama kurir yang tersimpan.");
        }
        if (order.status !== "approved") throw new HttpError(409, "Hanya pesanan disetujui yang dapat dikirim.");
        await db.batch([
          db.prepare("UPDATE orders SET status='shipped',courier=?,shipped_at=? WHERE id=? AND status='approved'").bind(courier, Date.now(), order.id),
          this.audit(auth, "shipped", order.id),
        ]);
      } else {
        if (order.status === "completed") return json({ ok: true });
        if (order.status !== "shipped") throw new HttpError(409, "Pesanan belum dikirim.");
        await db.batch([
          db.prepare("UPDATE orders SET status='completed',completed_at=? WHERE id=? AND status='shipped'").bind(Date.now(), order.id),
          this.audit(auth, "completed", order.id),
        ]);
      }
      return json({ ok: true });
    }
    const reset = path.match(/^\/api\/users\/([^/]+)\/reset$/);
    if (reset && method === "POST") {
      const user = await db.prepare("SELECT id FROM users WHERE id=? AND role='buyer'").bind(reset[1]).first();
      if (!user) throw new HttpError(404, "Buyer tidak ditemukan.");
      const password = "KK-" + random().slice(0, 20),
        hash = await hashPassword(password);
      await db.batch([
        db.prepare("UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?").bind(hash, reset[1]),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(reset[1]),
        this.audit(auth, "buyer_password_reset", reset[1]),
      ]);
      return json({ password });
    }
    throw new HttpError(404, "Halaman tidak ditemukan.");
  }
}
async function digestBytes(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), (n) => n.toString(16).padStart(2, "0")).join("");
}
