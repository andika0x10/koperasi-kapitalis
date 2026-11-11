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
const owner: Client = { id: "owner", cookie: "kk_session=" + "1".repeat(64), csrf: "owner-csrf" },
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
  const p = await ok(await req(owner, "/api/products", "POST", { name: "Beras uji", description: "Data lokal pengujian", category: "Bahan pokok", unit: "kg", price, stock }));
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
  for (const c of [owner, a, b]) {
    await db
      .prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
      .bind(c.id, c.id, hash, c === owner ? "owner" : "buyer", now)
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
  await ok(await req(owner, "/api/products/" + p, "PUT", { ...old, stock: 3 }), 409);
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
  assert.equal((await req(owner, imageUrl)).status, 200);
  await ok(await req(b, imageUrl), 404);
  await ok(await req(null, imageUrl), 401);
  await ok(await req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "" }), 400);
  await ok(await req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Nominal belum sesuai" }));
  await ok(await req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Nominal belum sesuai" }));
  assert.equal(await stock(p), 2);
  await ok(await req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "approved", reason: "" }), 409);
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
    req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "approved", reason: "" }),
    req(owner, "/api/orders/" + o.id + "/decision", "POST", { status: "rejected", reason: "Tolak" }),
  ]);
  assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await ok(await req(a, "/api/orders/" + o.id))).status, "approved");
  assert.equal(await stock(p), 1);
  await ok(await req(owner, "/api/orders/" + o.id + "/complete", "POST", {}), 409);
  await ok(await req(owner, "/api/orders/" + o.id + "/ship", "POST", { courier: "Kurir uji" }));
  await ok(await req(owner, "/api/orders/" + o.id + "/complete", "POST", {}));
  assert.equal((await ok(await req(a, "/api/orders/" + o.id))).status, "completed");
});
test("permanent product deletion blocks running orders and preserves historical snapshots", async () => {
  await cleanCart();
  const p = await product(2);
  await cart(a, p);
  const o = await ok(await checkout(a), 201);
  let row = await db.prepare("SELECT * FROM products WHERE id=?").bind(p).first<any>();
  const blocked = await ok(await req(owner, "/api/products/" + p, "DELETE", { revision: row.revision }), 409);
  assert.equal(blocked.orders[0].id, o.id);
  await assert.rejects(() => db.prepare("DELETE FROM products WHERE id=?").bind(p).run(), /PRODUCT_HAS_RUNNING_ORDERS/);
  await db.prepare("UPDATE orders SET expires_at=1 WHERE id=?").bind(o.id).run();
  await ok(await req(a, "/api/orders/" + o.id));
  assert.equal(await stock(p), 2);
  row = await db.prepare("SELECT * FROM products WHERE id=?").bind(p).first<any>();
  await ok(await req(owner, "/api/products/" + p, "DELETE", { revision: row.revision }));
  assert.equal(await db.prepare("SELECT id FROM products WHERE id=?").bind(p).first(), null);
  assert.equal((await ok(await req(a, "/api/orders/" + o.id))).items[0].name, "Beras uji");
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
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }), 409);
  await ok(await req(a, `/api/orders/${o.id}/proof`, "POST", png));
  await ok(await req(owner, `/api/orders/${o.id}/decision`, "POST", { status: "approved" }));
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "x".repeat(81) }), 400);
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", png), 415);
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", {}), 400);
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "   " }), 400);
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  const detail = await ok(await req(a, `/api/orders/${o.id}`));
  assert.equal(detail.status, "shipped");
  assert.equal(detail.courier, "Kurir uji");
  assert.equal("tracking" in detail, false);
  const columns = await db.prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  assert.equal(
    columns.results.some((column) => column.name === "tracking"),
    false
  );
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir berbeda" }), 409);
  assert.equal(detail.events.filter((e: any) => e.status === "shipped").length, 1);
  await ok(await req(owner, `/api/orders/${o.id}/complete`, "POST", {}));
  await ok(await req(owner, `/api/orders/${o.id}/ship`, "POST", { courier: "Kurir uji" }));
  assert.equal(await stock(p), 2);
});

test("section settings saves preserve other sections, validate and respect roles", async () => {
  const initial = await ok(await req(owner, "/api/settings"));
  await ok(await req(a, "/api/settings", "PUT", { shipping_fee: 2000 }), 403);
  await ok(await req(owner, "/api/settings", "PUT", { shipping_fee: 2000 }));
  let settings = await ok(await req(owner, "/api/settings"));
  assert.deepEqual(settings, { ...initial, shipping_fee: 2000 });
  await ok(await req(owner, "/api/settings", "PUT", { bank_name: "Bank baru", bank_account: "999", bank_holder: "Pemilik baru", qris_id: null }));
  settings = await ok(await req(owner, "/api/settings"));
  assert.equal(settings.shipping_fee, 2000);
  assert.equal(settings.bank_account, "999");
  await ok(await req(owner, "/api/settings", "PUT", { bank_account: "" }), 400);
  await ok(await req(owner, "/api/settings", "PUT", { shipping_fee: -1 }), 400);
  await ok(await req(owner, "/api/settings", "PUT", initial));
  await Promise.all([
    ok(await req(owner, "/api/settings", "PUT", { shipping_fee: 2500 })),
    ok(await req(owner, "/api/settings", "PUT", { bank_name: "Bank paralel", bank_account: "888", bank_holder: "Seller paralel" })),
  ]);
  settings = await ok(await req(owner, "/api/settings"));
  assert.equal(settings.shipping_fee, 2500);
  assert.equal(settings.bank_account, "888");
  await ok(await req(owner, "/api/settings", "PUT", initial));
});

test("sales reports: WIB boundaries, approval date, snapshots, exclusions and pagination", async () => {
  const path = "/api/reports/sales?from=2025-11-01&to=2025-11-30";
  await ok(await req(null, path), 401);
  await ok(await req(a, path), 403);
  assert.equal((await ok(await req(owner, path))).summary.orders, 0);
  for (const dates of ["from=2025-02-30&to=2025-03-01", "from=2025-12-01&to=2025-11-01", "from=bad&to=2025-11-01", "from=2025-11-01"]) {
    await ok(await req(owner, "/api/reports/sales?" + dates), 400);
  }
  await ok(await req(owner, path + "&page=-1"), 400);
  const p = await product(100, 5000);
  async function seed(index: number, decided: number, status = "approved") {
    const id = `report-${index}`;
    await db
      .prepare(
        "INSERT INTO orders(id,user_id,buyer_username,checkout_key,status,recipient,phone,address,subtotal,shipping_fee,total,payment_method,payment_snapshot,created_at,expires_at) VALUES(?,?,'buyer-a',?,'pending','Penerima','0812345678','Alamat laporan',5000,1000,6000,'bank','{}',?,?)"
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
  const report = await ok(await req(owner, path));
  assert.deepEqual(report.summary, { orders: 35, total: 210000, subtotal: 175000, shipping_fee: 35000 });
  assert.deepEqual(report.daily, [
    { day: "2025-11-01", orders: 34, total: 204000 },
    { day: "2025-11-30", orders: 1, total: 6000 },
  ]);
  assert.equal(report.products[0].name, "Nama snapshot");
  assert.equal(report.products[0].quantity, 35);
  assert.equal(report.products[0].subtotal, 175000);
  assert.equal(report.transactions.length, 30);
  const second = await ok(await req(owner, path + "&page=1"));
  assert.equal(second.transactions.length, 5);
  assert.equal(new Set([...report.transactions, ...second.transactions].map((o: any) => o.id)).size, 35);
  await ok(await req(owner, "/api/orders/report-0/ship", "POST", { courier: "Kurir laporan" }));
  await ok(await req(owner, "/api/orders/report-0/complete", "POST", {}));
  assert.deepEqual((await ok(await req(owner, path))).summary, report.summary);
  const singleDay = await ok(await req(owner, "/api/reports/sales?from=2025-11-30&to=2025-11-30"));
  assert.equal(singleDay.summary.orders, 1);
});

test("password links immediately lock credentials, revoke sessions and allow one-time reset", async () => {
  await db.prepare("UPDATE users SET username='buyer_b' WHERE id=?").bind(b.id).run();
  const reset = await ok(await req(owner, "/api/users/" + b.id + "/reset", "POST", {}));
  assert.equal(reset.password, undefined);
  await ok(await req(b, "/api/sessions"), 401);
  await ok(await req(null, "/api/login", "POST", { username: "buyer_b", password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await ok(await activate(reset, "new-password-123"));
  await ok(await activate(reset), 400);
  const client = await loginAs("buyer_b", "new-password-123");
  assert.equal((await ok(await req(client, "/api/me"))).user.status, "active");
  await ok(await req(client, "/api/password", "POST", { current: "wrong-password", password }), 400);
  await ok(await req(client, "/api/password", "POST", { current: "new-password-123", password }));
  await ok(await req(client, "/api/sessions/revoke", "POST", { all: true }));
  await ok(await req(client, "/api/sessions"), 401);
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
async function activate(link: { url: string }, secret = password) {
  const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get("token");
  return req(null, "/api/password-links/complete", "POST", { token, password: secret }, { "cf-connecting-ip": crypto.randomUUID() });
}
async function managed(role = "buyer") {
  const username = "u_" + crypto.randomUUID().replaceAll("-", "").slice(0, 15);
  const created = await ok(await req(owner, "/api/users", "POST", { username, role }), 201);
  await ok(await activate(created));
  const client = await loginAs(username, password);
  return { client, username };
}
test("multiple staff, owner-only management, immutable roles and restricted payment settings", async () => {
  const username = "staff_new";
  const created = await ok(await req(owner, "/api/users", "POST", { username, role: "staff" }), 201);
  await ok(await req(null, "/api/login", "POST", { username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await ok(await activate(created));
  const client = await loginAs(username, password);
  for (const path of ["/api/users", "/api/audit-logs", "/api/reports/sales?from=2026-01-01&to=2026-12-31"]) await ok(await req(client, path), 403);
  await ok(await req(client, "/api/orders"));
  await ok(await req(client, "/api/products?all=1"));
  await ok(await req(client, "/api/users", "POST", { username: "illegal_user", role: "buyer" }), 403);
  await ok(await req(client, "/api/users/" + owner.id + "/reset", "POST", {}), 403);
  await ok(await req(client, "/api/users/" + owner.id, "DELETE"), 403);
  await ok(await req(client, "/api/settings", "PUT", { shipping_fee: 2000 }));
  await ok(await req(client, "/api/settings", "PUT", { shipping_fee: 3000, bank_name: "Bad" }), 403);
  assert.equal((await ok(await req(owner, "/api/settings"))).shipping_fee, 2000);
  await ok(await req(client, "/api/attachments?kind=qris", "POST", png), 403);
  await ok(await req(owner, "/api/settings", "PUT", { shipping_fee: 1000 }));
  await assert.rejects(() => db.prepare("UPDATE users SET role='owner' WHERE id=?").bind(client.id).run(), /ROLE_CANNOT_BE_CHANGED/);
  await ok(await req(owner, "/api/users", "POST", { username: "STAFF_NEW", role: "buyer" }), 409);
  await ok(await req(owner, "/api/users", "POST", { username: "bad_role", role: "owner" }), 400);
  await ok(await req(owner, "/api/users", "POST", { username: "bad_csrf", role: "buyer" }, { "x-csrf-token": "wrong" }), 403);
  const reset = await ok(await req(owner, "/api/users/" + client.id + "/reset", "POST", {}));
  await ok(await req(client, "/api/orders"), 401);
  await ok(await activate(reset));
  await loginAs(username, password);
});

test("username changes confirm password, preserve current session, revoke others and retain actor snapshots", async () => {
  const { client, username } = await managed();
  const other = await loginAs(username, password),
    name = "renamed_" + crypto.randomUUID().slice(0, 8);
  await ok(await req(client, "/api/username", "PUT", { username: name, current: "wrong-password" }), 400);
  await ok(await req(client, "/api/username", "PUT", { username: "staff_new", current: password }), 409);
  await ok(await req(client, "/api/username", "PUT", { username: "bad-name", current: password }), 400);
  await ok(await req(client, "/api/username", "PUT", { username: name.toUpperCase(), current: password }));
  assert.equal((await ok(await req(client, "/api/me"))).user.username, name);
  await ok(await req(other, "/api/sessions"), 401);
  await ok(await req(null, "/api/login", "POST", { username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await loginAs(name, password);
  await ok(await req(owner, "/api/users", "POST", { username, role: "buyer" }), 201);
  const logs = await ok(await req(owner, "/api/audit-logs?action=username_changed&actor=" + client.id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actor_username, username);
  assert.equal(JSON.parse(logs[0].details).after.username, name);
  await ok(await req(client, "/api/username", "PUT", { username: name, current: password }));
  assert.equal((await ok(await req(owner, "/api/audit-logs?action=username_changed&actor=" + client.id))).length, 1);
});
test("physical account deletion preserves orders, actor snapshots and attachments without account access", async () => {
  const { client, username } = await managed();
  const p = await product(3);
  await cart(client, p);
  const order = await ok(await checkout(client), 201);
  await ok(await req(client, "/api/orders/" + order.id + "/proof", "POST", png));
  const proofId = (await ok(await req(client, "/api/orders/" + order.id))).proof_id;
  await ok(await req(owner, "/api/users/" + client.id, "DELETE"));
  assert.equal(await db.prepare("SELECT id FROM users WHERE id=?").bind(client.id).first(), null);
  await ok(await req(client, "/api/cart"), 401);
  await ok(await req(owner, "/api/users/" + client.id + "/reset", "POST", {}), 404);
  const detail = await ok(await req(owner, "/api/orders/" + order.id));
  assert.equal(detail.user_id, null);
  assert.equal(detail.username, username);
  assert.equal((await req(owner, "/api/attachments/" + proofId)).status, 200);
  const replacement = await ok(await req(owner, "/api/users", "POST", { username, role: "buyer" }), 201);
  await ok(await activate(replacement));
  const replacementClient = await loginAs(username, password);
  await ok(await req(replacementClient, "/api/orders/" + order.id), 404);
  assert.equal((await req(replacementClient, "/api/attachments/" + proofId)).status, 404);
  const operator = await managed("staff");
  await ok(await req(operator.client, "/api/orders/" + order.id + "/decision", "POST", { status: "approved" }));
  await ok(await req(operator.client, "/api/orders/" + order.id + "/ship", "POST", { courier: "Kurir" }));
  await ok(await req(operator.client, "/api/orders/" + order.id + "/complete", "POST", {}));
  await ok(await req(owner, "/api/users/" + operator.client.id, "DELETE"));
  const event = await db.prepare("SELECT actor_id,actor_username FROM order_events WHERE order_id=? AND status='completed'").bind(order.id).first<any>();
  assert.equal(event.actor_id, null);
  assert.equal(event.actor_username, operator.username);
  assert.equal((await ok(await req(owner, "/api/audit-logs?action=user_deleted&q=" + client.id))).length, 1);
  assert.equal(
    (await ok(await req(owner, "/api/users?q=" + username))).some((u: any) => u.id === client.id),
    false
  );
});

test("owner cannot be deleted and staff cannot delete each other", async () => {
  const first = await managed("staff"),
    second = await managed("staff");
  const results = await Promise.all([req(first.client, "/api/users/" + second.client.id, "DELETE"), req(second.client, "/api/users/" + first.client.id, "DELETE")]);
  assert.deepEqual(
    results.map((r) => r.status),
    [403, 403]
  );
  await ok(await req(owner, "/api/users/" + owner.id, "DELETE"), 400);
  await assert.rejects(() => db.prepare("DELETE FROM users WHERE id=?").bind(owner.id).run(), /OWNER_CANNOT_BE_DELETED/);
  await ok(await req(owner, "/api/users/" + first.client.id, "DELETE"));
  await ok(await req(first.client, "/api/orders"), 401);
});

test("concurrent login with deletion or username change cannot retain a stale session", async () => {
  const deleted = await managed();
  const results = await Promise.all([
    req(null, "/api/login", "POST", { username: deleted.username, password }, { "cf-connecting-ip": crypto.randomUUID() }),
    req(owner, "/api/users/" + deleted.client.id, "DELETE"),
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
    audit(db, { id: owner.id, username: "snapshot" }, "test_details", "audit-probe", "product", {
      before: { price: 1, password: "secret", token: "secret", address: "private" },
      after: { price: 2, password_hash: "secret" },
    }),
  ]);
  const rows = await ok(await req(owner, "/api/audit-logs?action=test_details&q=audit-probe"));
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
  const one = await ok(await req(owner, path)),
    two = await ok(await req(owner, path + "&page=1"));
  assert.equal(one.length, 30);
  assert.equal(two.length, 5);
  assert.equal(new Set([...one, ...two].map((r: any) => r.id)).size, 35);
  await ok(await req(owner, "/api/audit-logs?from=2026-02-30&to=2026-03-01"), 400);
  await ok(await req(owner, "/api/audit-logs?page=1.5"), 400);
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
  const failures = await ok(await req(owner, "/api/audit-logs?action=login_failed"));
  assert.ok(failures.length > 0);
  assert.ok(failures.every((r: any) => r.outcome === "failure"));
});

test("concurrent login with password reset revokes old credentials and sessions", async () => {
  const user = await managed();
  const results = await Promise.all([
    req(null, "/api/login", "POST", { username: user.username, password }, { "cf-connecting-ip": crypto.randomUUID() }),
    req(owner, "/api/users/" + user.client.id + "/reset", "POST", {}),
  ]);
  const reset = await ok(results[1]);
  if (results[0].status === 200) {
    const cookie = results[0].headers.get("set-cookie")!.split(";")[0];
    assert.equal((await ok(await req({ id: user.client.id, cookie, csrf: "" }, "/api/me"))).user, null);
  } else assert.equal(results[0].status, 401);
  await ok(await req(null, "/api/login", "POST", { username: user.username, password }, { "cf-connecting-ip": crypto.randomUUID() }), 401);
  await ok(await activate(reset));
  const current = await loginAs(user.username, password);
  assert.equal((await ok(await req(current, "/api/me"))).user.status, "active");
});

test("link expiry, replacement, concurrent consumption, deletion and secret-free audit", async () => {
  const user = await managed();
  const reset = await ok(await req(owner, "/api/users/" + user.client.id + "/reset", "POST", {}));
  const token = new URLSearchParams(new URL(reset.url).hash.slice(1)).get("token")!;
  assert.ok(reset.expires_at > Date.now() + 3590000 && reset.expires_at <= Date.now() + 3600000);
  const stored = await db.prepare("SELECT token_hash FROM password_links WHERE user_id=?").bind(user.client.id).first<any>();
  assert.equal(stored.token_hash, await digest(token));
  assert.notEqual(stored.token_hash, token);
  await ok(await req(null, "/api/password-links/validate", "POST", { token }, { origin: "https://other.test" }), 403);
  await ok(await req(null, "/api/password-links/validate", "POST", { token }, { "cf-connecting-ip": crypto.randomUUID() }));
  await db.prepare("UPDATE password_links SET expires_at=? WHERE user_id=?").bind(Date.now(), user.client.id).run();
  await ok(await activate(reset), 400);
  assert.equal((await db.prepare("SELECT status,password_hash FROM users WHERE id=?").bind(user.client.id).first<any>()).password_hash, null);
  const replacement = await ok(await req(owner, "/api/users/" + user.client.id + "/reset", "POST", {}));
  await ok(await activate(reset), 400);
  const results = await Promise.all([activate(replacement), activate(replacement)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  const client = await loginAs(user.username, password);
  const invalidated = await ok(await req(owner, "/api/users/" + client.id + "/reset", "POST", {}));
  await ok(await req(owner, "/api/users/" + client.id, "DELETE"));
  await ok(await activate(invalidated), 400);
  const log = JSON.stringify((await db.prepare("SELECT * FROM audit_log").all()).results);
  assert.ok(!log.includes(token));
  assert.ok(!log.includes(new URLSearchParams(new URL(replacement.url).hash.slice(1)).get("token")!));
  assert.ok(!log.includes(password));
});

test("multi-photo ordering, validation, stale updates and attachment lifetime", async () => {
  const photos: string[] = [];
  for (let i = 0; i < 6; i++) photos.push((await ok(await req(owner, "/api/attachments?kind=product", "POST", png), 201)).id);
  const data = { name: "Barang galeri", category: "Dapur", unit: "buah", price: 1500, stock: 5, photo_ids: photos.slice(0, 5) };
  const created = await ok(await req(owner, "/api/products", "POST", data));
  let row = (await ok(await req(null, "/api/products"))).products.find((p: any) => p.id === created.id);
  assert.deepEqual(row.photo_ids, data.photo_ids);
  assert.equal(row.photo_id, undefined);
  assert.equal(row.archived, undefined);
  await ok(await req(owner, "/api/products", "POST", { ...data, photo_ids: photos }), 400);
  await ok(await req(owner, "/api/products", "POST", { ...data, photo_ids: [photos[0], photos[0]] }), 400);
  await ok(await req(owner, "/api/products", "POST", { ...data, photo_ids: ["unknown-photo"] }), 400);
  await ok(await req(owner, "/api/products", "POST", { ...data, archived: true }), 400);
  await ok(await req(owner, "/api/products", "POST", { ...data, photo_ids: [(await ok(await req(owner, "/api/attachments?kind=qris", "POST", png), 201)).id] }), 400);
  const staff = await managed("staff");
  const changes = await Promise.all([
    req(staff.client, "/api/products/" + row.id, "PUT", { ...row, photo_ids: [...row.photo_ids].reverse() }),
    req(owner, "/api/products/" + row.id, "PUT", { ...row, price: 2000 }),
  ]);
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  row = (await ok(await req(null, "/api/products"))).products.find((p: any) => p.id === created.id);
  await ok(await req(owner, "/api/attachments/" + photos[0], "DELETE"));
  assert.equal((await req(null, "/api/attachments/" + photos[0])).status, 200);
  await ok(await req(owner, "/api/products/" + row.id, "PUT", { ...row, photo_ids: [photos[0], photos[1]] }));
  assert.equal((await req(null, "/api/attachments/" + photos[2])).status, 404);
  await ok(await req(owner, "/api/attachments/" + photos[5], "DELETE"));
  assert.equal((await req(null, "/api/attachments/" + photos[5])).status, 404);
  const shared = await ok(await req(owner, "/api/products", "POST", { ...data, name: "Foto bersama", photo_ids: [photos[0]] }));
  row = (await ok(await req(null, "/api/products"))).products.find((p: any) => p.id === created.id);
  await ok(await req(owner, "/api/products/" + row.id, "DELETE", { revision: row.revision }));
  assert.equal((await req(null, "/api/attachments/" + photos[0])).status, 200);
  assert.equal((await req(null, "/api/attachments/" + photos[1])).status, 404);
  await ok(await req(owner, "/api/products/" + shared.id, "DELETE", { revision: 0 }));
  assert.equal((await req(null, "/api/attachments/" + photos[0])).status, 404);
});

test("staff deletion preserves published photographs; alarm removes abandoned uploads only", async () => {
  const staff = await managed("staff");
  const photo = await ok(await req(staff.client, "/api/attachments?kind=product", "POST", png), 201);
  const abandoned = await ok(await req(staff.client, "/api/attachments?kind=product", "POST", png), 201);
  const recent = await ok(await req(staff.client, "/api/attachments?kind=product", "POST", png), 201);
  const p = await ok(await req(staff.client, "/api/products", "POST", { name: "Foto tersimpan", category: "Dapur", unit: "buah", price: 5000, stock: 3, photo_ids: [photo.id] }));
  await db.prepare("UPDATE attachments SET created_at=1 WHERE id IN (?,?)").bind(photo.id, abandoned.id).run();
  await ok(await req(owner, "/api/users/" + staff.client.id, "DELETE"));
  const ns = await mf.getDurableObjectNamespace("COMMERCE");
  await ns.get(ns.idFromName("store")).fetch("https://internal/__test/alarm");
  assert.equal((await req(null, "/api/attachments/" + photo.id)).status, 200);
  assert.equal((await req(null, "/api/attachments/" + abandoned.id)).status, 404);
  assert.equal((await req(null, "/api/attachments/" + recent.id)).status, 200);
  const row = (await ok(await req(null, "/api/products"))).products.find((row: any) => row.id === p.id);
  assert.deepEqual(row.photo_ids, [photo.id]);
});

test("checkout and permanent deletion serialize without losing reservations", async () => {
  const buyer = await managed();
  const p = await product(1);
  await cart(buyer.client, p);
  const results = await Promise.all([checkout(buyer.client), req(owner, "/api/products/" + p, "DELETE", { revision: 0 })]);
  if (results[0].status === 201) {
    assert.equal(results[1].status, 409);
    assert.equal(await stock(p), 0);
  } else {
    assert.equal(results[0].status, 400);
    assert.equal(results[1].status, 200);
  }
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("owner statistics combine period sales with current inventory and accounts", async () => {
  const report = await ok(await req(owner, "/api/reports/sales?from=2020-01-01&to=2020-01-02"));
  assert.equal(report.summary.orders, 0);
  assert.ok(report.operations.orders.length > 0);
  assert.ok(report.operations.out_of_stock.every((p: any) => p.stock === 0));
  assert.ok(report.operations.low_stock.every((p: any) => p.stock >= 1 && p.stock <= 5));
  assert.equal(
    report.operations.accounts.reduce((n: number, a: any) => n + a.count, 0),
    (await db.prepare("SELECT COUNT(*) n FROM users").first<any>()).n
  );
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
  const expiration = await ok(await req(owner, "/api/audit-logs?action=order_expired&q=" + order.id));
  assert.equal(expiration.length, 1);
  assert.equal(expiration[0].actor_username, "Sistem");
  const event = await db.prepare("SELECT actor_id,actor_username FROM order_events WHERE order_id=? AND status='expired'").bind(order.id).first<any>();
  assert.equal(event.actor_id, null);
  assert.equal(event.actor_username, "Sistem");
  assert.equal((await ok(await req(owner, "/api/audit-logs?action=cart_updated&actor=" + user.client.id))).length, 1);
  const before = await db.prepare("SELECT COUNT(*) n FROM audit_log").first<any>();
  await ok(await req(owner, "/api/users"));
  await ok(await req(user.client, "/api/orders"));
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log").first<any>()).n, before.n);
  await ok(await req(user.client, "/api/logout", "POST", {}));
  const logout = await ok(await req(owner, "/api/audit-logs?action=logout&actor=" + user.client.id));
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
    "password_link_issued",
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
