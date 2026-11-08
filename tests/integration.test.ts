import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashPassword, digest } from "../lib/security";
let mf: Miniflare, db: D1Database;
const base = "https://koperasi.test",
  password = "test-password-123";
type Client = { cookie: string; csrf: string; id: string };
const seller: Client = { id: "seller", cookie: "kk_session=" + "1".repeat(64), csrf: "seller-csrf" },
  a: Client = { id: "buyer-a", cookie: "kk_session=" + "2".repeat(64), csrf: "a-csrf" },
  b: Client = { id: "buyer-b", cookie: "kk_session=" + "3".repeat(64), csrf: "b-csrf" };
async function req(client: Client | null, path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
  const binary = data instanceof Uint8Array;
  return mf.dispatchFetch(base + path, {
    method,
    headers: {
      origin: base,
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(data !== undefined ? { "content-type": binary ? "image/png" : "application/json" } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : binary ? data : JSON.stringify(data),
  });
}
async function ok(response: Awaited<ReturnType<typeof req>>, status = 200) {
  const data = (await response.json()) as any;
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
async function product(stock = 5, price = 10000) {
  const p = await ok(await req(seller, "/api/products", "POST", { name: "Beras uji", description: "Data lokal pengujian", category: "Bahan pokok", unit: "kg", price, stock }));
  return p.id as string;
}
async function cart(client: Client, p: string, quantity = 1) {
  return ok(await req(client, "/api/cart", "PUT", { product_id: p, quantity }));
}
async function checkout(client: Client, key = crypto.randomUUID(), expected_total = 11000) {
  return req(client, "/api/checkout", "POST", {
    key,
    recipient: "Penerima uji",
    phone: "081234567890",
    address: "Jalan Pengujian 1, Jakarta, 12345",
    payment_method: "bank",
    expected_total,
  });
}
async function cleanCart() {
  await db.prepare("DELETE FROM cart_items").run();
}
async function stock(id: string) {
  return (await db.prepare("SELECT stock FROM products WHERE id=?").bind(id).first<{ stock: number }>())!.stock;
}
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8m8AAAAASUVORK5CYII=", "base64"));
before(async () => {
  mkdirSync(".test-artifacts", { recursive: true });
  await build({
    entryPoints: ["tests/worker.ts"],
    outfile: ".test-artifacts/worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers", "node:*"],
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve(".test-artifacts/worker.mjs"),
      compatibilityDate: "2026-11-08",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "test-db" },
      durableObjects: { COMMERCE: { className: "Commerce", useSQLite: true }, LIMITER: { className: "RateLimiter", useSQLite: true } },
    })
  );
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  let statement = "";
  for (const raw of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync("migrations/" + f, "utf8"))
    .join("\n")
    .split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("--")) continue;
    statement += " " + line;
    const trigger = statement.trim().startsWith("CREATE TRIGGER");
    if ((trigger && line === "END;") || (!trigger && line.endsWith(";"))) {
      await db.prepare(statement).run();
      statement = "";
    }
  }
  assert.equal(statement, "");
  const hash = await hashPassword(password),
    now = Date.now();
  for (const c of [seller, a, b]) {
    await db
      .prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
      .bind(c.id, c.id, hash, c === seller ? "seller" : "buyer", now)
      .run();
    await db
      .prepare("INSERT INTO sessions(id,user_id,token_hash,csrf,device,created_at,last_seen,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("session-" + c.id, c.id, await digest(c.cookie.split("=")[1]), c.csrf, "Test device", now, now, now + 30 * 86400000)
      .run();
  }
  await db.prepare("UPDATE settings SET shipping_fee=1000,bank_name='Bank uji',bank_account='123456',bank_holder='Seller uji' WHERE id=1").run();
});
after(async () => {
  await mf?.dispose();
});
test("public catalog, registration, role enforcement, CSRF and username uniqueness", async () => {
  await ok(await req(null, "/api/products"));
  const registration = await req(null, "/api/register", "POST", { username: "new_buyer", password });
  await ok(registration);
  assert.match(registration.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax.*Secure/);
  await ok(await req(null, "/api/register", "POST", { username: "NEW_BUYER", password }), 409);
  await ok(await req(a, "/api/products", "POST", {}), 403);
  await ok(await req(a, "/api/users"), 403);
  await ok(await req(a, "/api/cart", "PUT", { product_id: "x", quantity: 1 }, { "x-csrf-token": "wrong" }), 403);
  await ok(await req(null, "/api/login", "POST", { username: "new_buyer", password }, { origin: "https://other.test" }), 403);
});
test("last item competition and checkout retry reserve exactly once", async () => {
  await cleanCart();
  const p = await product(1);
  await cart(a, p);
  await cart(b, p);
  const key = crypto.randomUUID();
  const responses = await Promise.all([checkout(a, key), checkout(b)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const first = (await responses[0].json()) as any;
  assert.equal(await stock(p), 0);
  if (responses[0].status === 201) {
    const again = await ok(await checkout(a, key));
    assert.equal(again.id, first.id);
    assert.equal(await stock(p), 0);
  }
});
test("price changes require total confirmation and snapshots remain unchanged", async () => {
  await cleanCart();
  const p = await product();
  await cart(a, p);
  await db.prepare("UPDATE products SET price=12000 WHERE id=?").bind(p).run();
  await ok(await checkout(a), 409);
  const order = await ok(await checkout(a, crypto.randomUUID(), 13000), 201);
  await db.prepare("UPDATE products SET name='Nama baru',price=20000 WHERE id=?").bind(p).run();
  const detail = await ok(await req(a, "/api/orders/" + order.id));
  assert.equal(detail.items[0].name, "Beras uji");
  assert.equal(detail.total, 13000);
  await ok(await req(b, "/api/orders/" + order.id), 404);
  await ok(await req(a, "/api/orders/" + order.id, "PUT", { recipient: "Diubah" }), 403);
});
test("simultaneous retries use one reservation and stale product forms cannot overwrite it", async () => {
  await cleanCart();
  const p = await product(3);
  const old = await db.prepare("SELECT * FROM products WHERE id=?").bind(p).first();
  await cart(a, p);
  const key = crypto.randomUUID();
  const results = await Promise.all([checkout(a, key), checkout(a, key)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  const payloads = (await Promise.all(results.map((r) => r.json()))) as { id: string }[];
  assert.equal(payloads[0].id, payloads[1].id);
  assert.equal(await stock(p), 2);
  await ok(await req(seller, "/api/products/" + p, "PUT", { ...old, stock: 3 }), 409);
  assert.equal(await stock(p), 2);
});
test("checkout gate, atomic all-or-nothing stock reservation, and frozen payment instructions", async () => {
  await cleanCart();
  const p = await product(2),
    q = await product(2);
  await cart(a, p);
  await cart(a, q);
  await db.prepare("UPDATE products SET stock=0 WHERE id=?").bind(q).run();
  await ok(await checkout(a, crypto.randomUUID(), 21000), 409);
  assert.equal(await stock(p), 2);
  await db.prepare("UPDATE settings SET shipping_fee=NULL WHERE id=1").run();
  await ok(await checkout(a), 409);
  await db.prepare("UPDATE settings SET shipping_fee=1000 WHERE id=1").run();
  await cart(a, q, 0);
  const o = await ok(await checkout(a), 201);
  await db.prepare("UPDATE settings SET bank_account='654321' WHERE id=1").run();
  const detail = await ok(await req(a, "/api/orders/" + o.id));
  assert.equal(JSON.parse(detail.payment_snapshot).bank_account, "123456");
  await db.prepare("UPDATE settings SET bank_account='123456' WHERE id=1").run();
});
test("expiry and alarm retries release stock only once; late proof is refused", async () => {
  await cleanCart();
  const p = await product(2);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  assert.equal(await stock(p), 1);
  await db
    .prepare("UPDATE orders SET expires_at=? WHERE id=?")
    .bind(Date.now() - 1, o.id)
    .run();
  const namespace = await mf.getDurableObjectNamespace("COMMERCE");
  const coordinator = namespace.get(namespace.idFromName("store"));
  for (let i = 0; i < 2; i++) assert.equal((await coordinator.fetch("https://internal/__test/alarm")).status, 200);
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", png), 409);
  for (let i = 0; i < 2; i++) await ok(await req(a, "/api/orders/" + o.id));
  assert.equal(await stock(p), 2);
  const events = await db.prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status='expired'").bind(o.id).first<{ n: number }>();
  assert.equal(events!.n, 1);
});
test("one-time proof, image validation, private access, and rejection finality", async () => {
  await cleanCart();
  const p = await product(2);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", new Uint8Array([1, 2, 3])), 400);
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", new Uint8Array(1500001)), 413);
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", png));
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", png));
  const changed = new Uint8Array(png);
  changed[changed.length - 15] ^= 1;
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", changed), 409);
  const detail = await ok(await req(a, "/api/orders/" + o.id)),
    imageUrl = "/api/attachments/" + detail.proof_id;
  assert.equal((await req(a, imageUrl)).headers.get("cache-control"), "private, no-store");
  assert.equal((await req(seller, imageUrl)).status, 200);
  await ok(await req(b, imageUrl), 404);
  await ok(await req(null, imageUrl), 401);
  await ok(await req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "" }), 400);
  await ok(await req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Nominal belum sesuai" }));
  await ok(await req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Nominal belum sesuai" }));
  assert.equal(await stock(p), 2);
  await ok(await req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "approved", reason: "" }), 409);
});
test("proof received before deadline survives expiry and approval races; shipping workflow", async () => {
  await cleanCart();
  const p = await product(2);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  await ok(await req(a, "/api/orders/" + o.id + "/proof", "POST", png));
  await db.prepare("UPDATE orders SET expires_at=1 WHERE id=?").bind(o.id).run();
  const detail = await ok(await req(a, "/api/orders/" + o.id));
  assert.equal(detail.status, "review");
  assert.equal(await stock(p), 1);
  const decisions = await Promise.all([
    req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "approved", reason: "" }),
    req(seller, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Tolak" }),
  ]);
  assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await ok(await req(a, "/api/orders/" + o.id))).status, "approved");
  assert.equal(await stock(p), 1);
  await ok(await req(seller, "/api/orders/" + o.id + "/complete", "POST", {}), 409);
  await ok(await req(seller, "/api/orders/" + o.id + "/ship", "POST", { courier: "Kurir uji" }));
  await ok(await req(seller, "/api/orders/" + o.id + "/complete", "POST", {}));
  assert.equal((await ok(await req(a, "/api/orders/" + o.id))).status, "completed");
});
test("archive does not mutate historical orders and releases reserved stock when expired", async () => {
  await cleanCart();
  const p = await product(2);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  const row = await db.prepare("SELECT * FROM products WHERE id=?").bind(p).first();
  await ok(await req(seller, "/api/products/" + p, "PUT", { ...row, archived: true }));
  await db.prepare("UPDATE orders SET expires_at=1 WHERE id=?").bind(o.id).run();
  await ok(await req(a, "/api/orders/" + o.id));
  assert.equal(await stock(p), 2);
  await ok(await cartResponse(a, p), 404);
});
async function cartResponse(client: Client, p: string) {
  return req(client, "/api/cart", "PUT", { product_id: p, quantity: 1 });
}
test("shipping requires only courier name, safe retries and role checks", async () => {
  await cleanCart();
  const p = await product(3);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  await ok(await req(a, `/api/orders/${o.id}/ship`, "POST", {}), 403);
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }), 409);
  await ok(await req(a, `/api/orders/${o.id}/proof`, "POST", png));
  await ok(await req(seller, `/api/orders/${o.id}/decision`, "POST", { status: "approved" }));
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "x".repeat(81) }), 400);
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", png), 415);
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", {}), 400);
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "   " }), 400);
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  const detail = await ok(await req(a, `/api/orders/${o.id}`));
  assert.equal(detail.status, "shipped");
  assert.equal(detail.courier, "Kurir uji");
  assert.equal("tracking" in detail, false);
  const columns = await db.prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  assert.equal(
    columns.results.some((column) => column.name === "tracking"),
    false
  );
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir berbeda" }), 409);
  assert.equal(detail.events.filter((e: any) => e.status === "shipped").length, 1);
  await ok(await req(seller, `/api/orders/${o.id}/complete`, "POST", {}));
  await ok(await req(seller, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  assert.equal(await stock(p), 2);
});

test("section settings saves preserve other sections, validate and respect roles", async () => {
  const initial = await ok(await req(seller, "/api/settings"));
  await ok(await req(a, "/api/settings", "PUT", { shipping_fee: 2000 }), 403);
  await ok(await req(seller, "/api/settings", "PUT", { shipping_fee: 2000 }));
  let settings = await ok(await req(seller, "/api/settings"));
  assert.deepEqual(settings, { ...initial, shipping_fee: 2000 });
  await ok(await req(seller, "/api/settings", "PUT", { bank_name: "Bank baru", bank_account: "999", bank_holder: "Pemilik baru", qris_id: null }));
  settings = await ok(await req(seller, "/api/settings"));
  assert.equal(settings.shipping_fee, 2000);
  assert.equal(settings.bank_account, "999");
  await ok(await req(seller, "/api/settings", "PUT", { bank_account: "" }), 400);
  await ok(await req(seller, "/api/settings", "PUT", { shipping_fee: -1 }), 400);
  await ok(await req(seller, "/api/settings", "PUT", initial));
  await Promise.all([
    ok(await req(seller, "/api/settings", "PUT", { shipping_fee: 2500 })),
    ok(await req(seller, "/api/settings", "PUT", { bank_name: "Bank paralel", bank_account: "888", bank_holder: "Seller paralel" })),
  ]);
  settings = await ok(await req(seller, "/api/settings"));
  assert.equal(settings.shipping_fee, 2500);
  assert.equal(settings.bank_account, "888");
  await ok(await req(seller, "/api/settings", "PUT", initial));
});

test("sales reports: WIB boundaries, approval date, snapshots, exclusions and pagination", async () => {
  const path = "/api/reports/sales?from=2025-11-01&to=2025-11-30";
  await ok(await req(null, path), 401);
  await ok(await req(a, path), 403);
  assert.equal((await ok(await req(seller, path))).summary.orders, 0);
  for (const dates of ["from=2025-02-30&to=2025-03-01", "from=2025-12-01&to=2025-11-01", "from=bad&to=2025-11-01", "from=2025-11-01"]) {
    await ok(await req(seller, "/api/reports/sales?" + dates), 400);
  }
  await ok(await req(seller, path + "&page=-1"), 400);
  const p = await product(100, 5000);
  async function seed(index: number, decided: number, status = "approved") {
    const id = `report-${index}`;
    await db
      .prepare(
        "INSERT INTO orders(id,user_id,checkout_key,status,recipient,phone,address,subtotal,shipping_fee,total,payment_method,payment_snapshot,created_at,expires_at) VALUES(?,?,?,'pending','Penerima','0812345678','Alamat laporan',5000,1000,6000,'bank','{}',?,?)"
      )
      .bind(id, a.id, id, Date.parse("2025-10-01T00:00:00Z"), Date.now() + 3600000)
      .run();
    await db.prepare("INSERT INTO order_items(id,order_id,product_id,name,unit,price,quantity) VALUES(?,?,?,'Nama snapshot','kg',5000,1)").bind(id, id, p).run();
    if (status === "pending") return;
    await db.prepare("UPDATE orders SET status='review' WHERE id=?").bind(id).run();
    if (status === "review") return;
    await db
      .prepare("UPDATE orders SET status=?,decided_at=? WHERE id=?")
      .bind(status === "rejected" ? "rejected" : "approved", decided, id)
      .run();
    if (["shipped", "completed"].includes(status)) await db.prepare("UPDATE orders SET status='shipped' WHERE id=?").bind(id).run();
    if (status === "completed") await db.prepare("UPDATE orders SET status='completed' WHERE id=?").bind(id).run();
  }
  const start = Date.parse("2025-10-31T17:00:00Z"),
    end = Date.parse("2025-11-30T17:00:00Z");
  for (let n = 0; n < 34; n++) await seed(n, start + n, n === 1 ? "shipped" : n === 2 ? "completed" : "approved");
  await seed(34, end - 1);
  await seed(35, start - 1);
  await seed(36, end);
  await seed(37, start, "pending");
  await seed(38, start, "review");
  await seed(39, start, "rejected");
  await db.prepare("UPDATE products SET name='Nom actuel',price=99000 WHERE id=?").bind(p).run();
  const report = await ok(await req(seller, path));
  assert.deepEqual(report.summary, { orders: 35, total: 210000, subtotal: 175000, shipping_fee: 35000 });
  assert.deepEqual(report.daily, [
    { day: "2025-11-01", orders: 34, total: 204000 },
    { day: "2025-11-30", orders: 1, total: 6000 },
  ]);
  assert.equal(report.products[0].name, "Nama snapshot");
  assert.equal(report.products[0].quantity, 35);
  assert.equal(report.products[0].subtotal, 175000);
  assert.equal(report.transactions.length, 30);
  const second = await ok(await req(seller, path + "&page=1"));
  assert.equal(second.transactions.length, 5);
  assert.equal(new Set([...report.transactions, ...second.transactions].map((o: any) => o.id)).size, 35);
  await ok(await req(seller, "/api/orders/report-0/ship", "POST", { courier: "Kurir laporan" }));
  await ok(await req(seller, "/api/orders/report-0/complete", "POST", {}));
  assert.deepEqual((await ok(await req(seller, path))).summary, report.summary);
  const singleDay = await ok(await req(seller, "/api/reports/sales?from=2025-11-30&to=2025-11-30"));
  assert.equal(singleDay.summary.orders, 1);
});

test("password reset revokes sessions, enforces password change, and supports session management", async () => {
  const reset = await ok(await req(seller, "/api/users/" + b.id + "/reset", "POST", {}));
  await ok(await req(b, "/api/sessions"), 401);
  // Seeded test usernames contain a hyphen: use a registered account for the login flow.
  await db.prepare("UPDATE users SET username='buyer_b' WHERE id=?").bind(b.id).run();
  const login = await req(null, "/api/login", "POST", { username: "buyer_b", password: reset.password });
  await ok(login);
  const temp: Client = { id: b.id, cookie: login.headers.get("set-cookie")!.split(";")[0], csrf: "" };
  const me = await ok(await req(temp, "/api/me"));
  assert.equal(me.user.must_change_password, 1);
  temp.csrf = me.csrf;
  await ok(await req(temp, "/api/cart"), 403);
  await ok(await req(temp, "/api/sessions"));
  await ok(await req(temp, "/api/password", "POST", { current: "wrong-password", password: "new-password-123" }), 400);
  await ok(await req(temp, "/api/password", "POST", { current: reset.password, password: "new-password-123" }));
  assert.equal((await ok(await req(temp, "/api/me"))).user.must_change_password, 0);
  await ok(await req(temp, "/api/sessions/revoke", "POST", { all: true }));
  await ok(await req(temp, "/api/sessions"), 401);
});
test("inactive and absolute session expiration", async () => {
  await db
    .prepare("UPDATE sessions SET last_seen=? WHERE id=?")
    .bind(Date.now() - 8 * 86400000, "session-buyer-a")
    .run();
  await ok(await req(a, "/api/sessions"), 401);
  await db
    .prepare("UPDATE sessions SET last_seen=?,expires_at=? WHERE id=?")
    .bind(Date.now(), Date.now() - 1, "session-buyer-a")
    .run();
  await ok(await req(a, "/api/sessions"), 401);
});
test("login attempt limiter", async () => {
  for (let i = 0; i < 10; i++) await ok(await req(null, "/api/login", "POST", { username: "absent_user", password }), 401);
  await ok(await req(null, "/api/login", "POST", { username: "absent_user", password }), 429);
});

async function loginAs(username: string, secret: string): Promise<Client> {
  const res = await req(null, "/api/login", "POST", { username, password: secret }, { "cf-connecting-ip": crypto.randomUUID() });
  await ok(res);
  const client = { id: "", cookie: res.headers.get("set-cookie")!.split(";")[0], csrf: "" };
  const me = await ok(await req(client, "/api/me"));
  client.id = me.user.id;
  client.csrf = me.csrf;
  return client;
}
async function managed(role = "buyer") {
  const username = "u_" + crypto.randomUUID().replaceAll("-", "").slice(0, 15);
  const created = await ok(await req(seller, "/api/users", "POST", { username, role }), 201);
  const client = await loginAs(username, created.password);
  await ok(await req(client, "/api/password", "POST", { current: created.password, password }));
  return { client, username };
}
test("multi-seller creation, forced password, immutable role, reset and permissions", async () => {
  const username = "seller_new";
  const created = await ok(await req(seller, "/api/users", "POST", { username, role: "seller" }), 201);
  const client = await loginAs(username, created.password);
  await ok(await req(client, "/api/users"), 403);
  await ok(await req(client, "/api/username", "PUT", { username: "blocked_change", current: created.password }), 403);
  await ok(await req(client, "/api/password", "POST", { current: created.password, password }));
  await ok(await req(client, "/api/users"));
  await ok(await req(client, "/api/audit-logs"));
  await ok(await req(client, "/api/users/" + client.id + "/reset", "POST", {}), 400);
  await ok(await req(client, "/api/users/" + client.id, "PUT", { role: "buyer" }), 404);
  const buyer = await managed();
  await ok(await req(buyer.client, "/api/users", "POST", { username: "illegal_seller", role: "seller" }), 403);
  await ok(await req(buyer.client, "/api/audit-logs"), 403);
  await ok(await req(seller, "/api/users", "POST", { username: "SELLER_NEW", role: "buyer" }), 409);
  await ok(await req(seller, "/api/users", "POST", { username: "invalid_role", role: "admin" }), 400);
  await ok(await req(seller, "/api/users", "POST", { username: "bad_csrf", role: "buyer" }, { "x-csrf-token": "wrong" }), 403);
  const reset = await ok(await req(seller, "/api/users/" + client.id + "/reset", "POST", {}));
  await ok(await req(client, "/api/users"), 401);
  const relogin = await loginAs(username, reset.password);
  assert.equal((await ok(await req(relogin, "/api/me"))).user.must_change_password, 1);
});
test("username changes confirm password, preserve current session, revoke others and retain actor snapshots", async () => {
  const { client, username } = await managed();
  const other = await loginAs(username, password),
    name = "renamed_" + crypto.randomUUID().slice(0, 8);
  await ok(await req(client, "/api/username", "PUT", { username: name, current: "wrong-password" }), 400);
  await ok(await req(client, "/api/username", "PUT", { username: "seller_new", current: password }), 409);
  await ok(await req(client, "/api/username", "PUT", { username: "bad-name", current: password }), 400);
  await ok(await req(client, "/api/username", "PUT", { username: name.toUpperCase(), current: password }));
  assert.equal((await ok(await req(client, "/api/me"))).user.username, name);
  await ok(await req(other, "/api/sessions"), 401);
  await ok(await req(null, "/api/login", "POST", { username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await loginAs(name, password);
  await ok(await req(seller, "/api/users", "POST", { username, role: "buyer" }), 201);
  const logs = await ok(await req(seller, "/api/audit-logs?action=username_changed&actor=" + client.id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actor_username, username);
  assert.equal(JSON.parse(logs[0].details).after.username, name);
  await ok(await req(client, "/api/username", "PUT", { username: name, current: password }));
  assert.equal((await ok(await req(seller, "/api/audit-logs?action=username_changed&actor=" + client.id))).length, 1);
});
test("soft deletion retains active orders, reserves usernames and rejects old sessions and reset", async () => {
  const { client, username } = await managed();
  const p = await product(3);
  await cart(client, p, 1);
  const order = await ok(await checkout(client), 201);
  await ok(await req(seller, "/api/users/" + client.id, "DELETE"));
  await ok(await req(client, "/api/cart"), 401);
  await ok(await req(null, "/api/login", "POST", { username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await ok(await req(seller, "/api/users/" + client.id + "/reset", "POST", {}), 404);
  await ok(await req(seller, "/api/users", "POST", { username, role: "buyer" }), 409);
  await ok(await req(null, "/api/register", "POST", { username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 409);
  const detail = await ok(await req(seller, "/api/orders/" + order.id));
  assert.equal(detail.status, "pending");
  assert.ok(detail.user_deleted_at);
  await db.prepare("UPDATE orders SET status='review' WHERE id=?").bind(order.id).run();
  const operator = await managed("seller");
  await ok(await req(operator.client, "/api/orders/" + order.id + "/decision", "POST", { status: "approved", reason: "" }));
  await ok(await req(operator.client, "/api/orders/" + order.id + "/ship", "POST", { courier: "Kurir" }));
  await ok(await req(operator.client, "/api/orders/" + order.id + "/complete", "POST", {}));
  const events = await db.prepare("SELECT actor_id,actor_username FROM order_events WHERE order_id=? AND status='completed'").bind(order.id).first<any>();
  assert.equal(events.actor_id, operator.client.id);
  assert.equal(events.actor_username, operator.username);
  await ok(await req(seller, "/api/users/" + client.id, "DELETE"));
  assert.equal((await ok(await req(seller, "/api/audit-logs?action=user_deleted&q=" + client.id))).length, 1);
  assert.ok((await ok(await req(seller, "/api/users?status=deleted&q=" + username))).some((u: any) => u.id === client.id));
});
test("concurrent seller deletions revoke queued access and database protects final seller", async () => {
  const first = await managed("seller"),
    second = await managed("seller");
  await ok(await req(first.client, "/api/users/" + first.client.id, "DELETE"), 400);
  const results = await Promise.all([req(first.client, "/api/users/" + second.client.id, "DELETE"), req(second.client, "/api/users/" + first.client.id, "DELETE")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const active = (await db.prepare("SELECT id FROM users WHERE role='seller' AND deleted_at IS NULL").all<{ id: string }>()).results;
  for (const user of active.filter((u) => u.id !== seller.id)) await ok(await req(seller, "/api/users/" + user.id, "DELETE"));
  await assert.rejects(() => db.prepare("UPDATE users SET deleted_at=? WHERE id=?").bind(Date.now(), seller.id).run(), /LAST_SELLER/);
});
test("concurrent login with deletion or username change cannot retain a stale session", async () => {
  const deleted = await managed();
  const results = await Promise.all([
    req(null, "/api/login", "POST", { username: deleted.username, password }, { "cf-connecting-ip": crypto.randomUUID() }),
    req(seller, "/api/users/" + deleted.client.id, "DELETE"),
  ]);
  assert.equal(results[1].status, 200);
  if (results[0].status === 200) {
    const cookie = results[0].headers.get("set-cookie")!.split(";")[0];
    assert.equal((await ok(await req({ id: deleted.client.id, cookie, csrf: "" }, "/api/me"))).user, null);
  }
  const renamed = await managed();
  const result = await Promise.all([
    req(null, "/api/login", "POST", { username: renamed.username, password }, { "cf-connecting-ip": crypto.randomUUID() }),
    req(renamed.client, "/api/username", "PUT", { username: "race_renamed", current: password }),
  ]);
  assert.equal(result[1].status, 200);
  if (result[0].status === 200) {
    const cookie = result[0].headers.get("set-cookie")!.split(";")[0];
    assert.equal((await ok(await req({ id: renamed.client.id, cookie, csrf: "" }, "/api/me"))).user, null);
  }
});
test("audit atomicity, sensitive field allowlist, WIB filters, pagination and daily retention", async () => {
  const { audit } = await import("../lib/audit");
  await db.batch([
    audit(db, { id: seller.id, username: "snapshot" }, "test_details", "audit-probe", "product", {
      before: { price: 1, password: "secret", token: "secret", address: "private" },
      after: { price: 2, password_hash: "secret" },
    }),
  ]);
  const rows = await ok(await req(seller, "/api/audit-logs?action=test_details&q=audit-probe"));
  assert.deepEqual(JSON.parse(rows[0].details), { before: { price: 1 }, after: { price: 2 } });
  await assert.rejects(() =>
    db.batch([db.prepare("UPDATE settings SET shipping_fee=42 WHERE id=1"), audit(db, { id: "missing-user", username: "missing" }, "atomic_fail", "1", "settings")])
  );
  assert.notEqual((await db.prepare("SELECT shipping_fee FROM settings").first<any>()).shipping_fee, 42);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='atomic_fail'").first<any>()).n, 0);
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const boundary = Date.parse(day + "T00:00:00+07:00");
  for (let i = 0; i < 35; i++)
    await db
      .prepare("INSERT INTO audit_log(id,action,target_id,created_at) VALUES(?,?,?,?)")
      .bind("page-" + i, "boundary_test", "probe", boundary + i)
      .run();
  await db
    .prepare("INSERT INTO audit_log(id,action,target_id,created_at) VALUES('before-boundary','boundary_test','probe',?)")
    .bind(boundary - 1)
    .run();
  const path = `/api/audit-logs?action=boundary_test&from=${day}&to=${day}`;
  const one = await ok(await req(seller, path)),
    two = await ok(await req(seller, path + "&page=1"));
  assert.equal(one.length, 30);
  assert.equal(two.length, 5);
  assert.equal(new Set([...one, ...two].map((r: any) => r.id)).size, 35);
  await ok(await req(seller, "/api/audit-logs?from=2026-02-30&to=2026-03-01"), 400);
  await ok(await req(seller, "/api/audit-logs?page=1.5"), 400);
  const cutoff = Date.now() - 365 * 86400000;
  await db
    .prepare("INSERT INTO audit_log(id,action,created_at) VALUES('old-log','legacy',?)")
    .bind(cutoff - 10000)
    .run();
  await db
    .prepare("INSERT INTO audit_log(id,action,created_at) VALUES('recent-log','legacy',?)")
    .bind(cutoff + 60000)
    .run();
  const coordinator = await mf.getDurableObjectNamespace("COMMERCE");
  const stub = coordinator.get(coordinator.idFromName("store"));
  await stub.fetch("https://internal/__test/alarm");
  assert.equal(await db.prepare("SELECT id FROM audit_log WHERE id='old-log'").first(), null);
  assert.ok(await db.prepare("SELECT id FROM audit_log WHERE id='recent-log'").first());
  const failures = await ok(await req(seller, "/api/audit-logs?action=login_failed"));
  assert.ok(failures.length > 0);
  assert.ok(failures.every((r: any) => r.outcome === "failure"));
});

test("concurrent login with password reset revokes old credentials and sessions", async () => {
  const user = await managed();
  const results = await Promise.all([
    req(null, "/api/login", "POST", { username: user.username, password }, { "cf-connecting-ip": crypto.randomUUID() }),
    req(seller, "/api/users/" + user.client.id + "/reset", "POST", {}),
  ]);
  const reset = await ok(results[1]);
  if (results[0].status === 200) {
    const cookie = results[0].headers.get("set-cookie")!.split(";")[0];
    assert.equal((await ok(await req({ id: user.client.id, cookie, csrf: "" }, "/api/me"))).user, null);
  } else assert.equal(results[0].status, 401);
  await ok(await req(null, "/api/login", "POST", { username: user.username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  const current = await loginAs(user.username, reset.password);
  assert.equal((await ok(await req(current, "/api/me"))).user.must_change_password, 1);
});

test("audits cover mutations, safe retries and automatic expiry with an idle daily alarm", async () => {
  const user = await managed(),
    p = await product(4);
  await cart(user.client, p, 1);
  await cart(user.client, p, 1);
  const order = await ok(await checkout(user.client), 201);
  await db.prepare("UPDATE orders SET expires_at=1 WHERE id=?").bind(order.id).run();
  const ns = await mf.getDurableObjectNamespace("COMMERCE"),
    coordinator = ns.get(ns.idFromName("store"));
  await coordinator.fetch("https://internal/__test/alarm");
  await coordinator.fetch("https://internal/__test/alarm");
  const expiration = await ok(await req(seller, "/api/audit-logs?action=order_expired&q=" + order.id));
  assert.equal(expiration.length, 1);
  assert.equal(expiration[0].actor_username, "Sistem");
  const event = await db.prepare("SELECT actor_id,actor_username FROM order_events WHERE order_id=? AND status='expired'").bind(order.id).first<any>();
  assert.equal(event.actor_id, null);
  assert.equal(event.actor_username, "Sistem");
  assert.equal((await ok(await req(seller, "/api/audit-logs?action=cart_updated&actor=" + user.client.id))).length, 1);
  const before = await db.prepare("SELECT COUNT(*) n FROM audit_log").first<any>();
  await ok(await req(seller, "/api/users"));
  await ok(await req(user.client, "/api/orders"));
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log").first<any>()).n, before.n);
  await ok(await req(user.client, "/api/logout", "POST", {}));
  const logout = await ok(await req(seller, "/api/audit-logs?action=logout&actor=" + user.client.id));
  assert.equal(logout.length, 1);
  const actions = (await db.prepare("SELECT DISTINCT action FROM audit_log").all<{ action: string }>()).results.map((r) => r.action);
  for (const action of [
    "registered",
    "login",
    "login_failed",
    "password_changed",
    "username_changed",
    "user_created",
    "user_deleted",
    "user_password_reset",
    "sessions_revoked",
    "cart_updated",
    "checkout",
    "proof_uploaded",
    "attachment_uploaded",
    "product_created",
    "product_updated",
    "settings_updated",
    "approved",
    "rejected",
    "shipped",
    "completed",
    "order_expired",
    "request_rejected",
    "logout",
  ])
    assert.ok(actions.includes(action), action);
  await db.prepare("UPDATE orders SET expires_at=1 WHERE status='pending'").run();
  const alarm = (await (await coordinator.fetch("https://internal/__test/alarm")).json()) as { scheduledAt: number };
  assert.ok(alarm.scheduledAt > Date.now() + 23 * 3600000);
});
