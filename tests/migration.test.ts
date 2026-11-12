import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

function statements(source: string) {
  const result: string[] = [];
  let current = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("--")) continue;
    current += " " + line;
    if (current.trim().startsWith("CREATE TRIGGER") ? line === "END;" : line.endsWith(";")) {
      result.push(current);
      current = "";
    }
  }
  assert.equal(current, "");
  return result;
}

test("D1 forward migration preserves populated history and atomically refuses archived running orders", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-11-08",
      d1Databases: { DB: "migration-isolated" },
    })
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql") && f < "0005")
      .sort()) {
      await db.batch(statements(readFileSync("migrations/" + file, "utf8")).map((sql) => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES('old-staff','pengelola','legacy-hash','seller',1)"),
      db.prepare("INSERT INTO users(id,username,password_hash,role,must_change_password,created_at) VALUES('temp-staff','sementara','temporary-hash','seller',1,1)"),
      db.prepare("INSERT INTO users(id,username,password_hash,role,created_at,deleted_at) VALUES('deleted-buyer','pembeli_lama','legacy-hash','buyer',1,2)"),
      db.prepare("INSERT INTO attachments(id,owner_id,kind,mime,bytes,checksum,data,created_at) VALUES('photo','old-staff','product','image/jpeg',4,'checksum',X'FFD8FFD9',1)"),
      db.prepare("INSERT INTO attachments(id,owner_id,kind,mime,bytes,checksum,data,created_at) VALUES('proof','deleted-buyer','proof','image/jpeg',4,'checksum',X'FFD8FFD9',1)"),
      db.prepare(
        "INSERT INTO attachments(id,owner_id,kind,mime,bytes,checksum,data,created_at) VALUES('archived-photo','old-staff','product','image/jpeg',4,'checksum',X'FFD8FFD9',1)"
      ),
      db.prepare("INSERT INTO products(id,name,category,unit,price,stock,photo_id,created_at,updated_at) VALUES('live','Beras','Dapur','kg',10000,5,'photo',1,1)"),
      db.prepare("INSERT INTO products(id,name,category,unit,price,stock,photo_id,created_at,updated_at) VALUES('archived','Minyak','Dapur','liter',15000,3,'archived-photo',1,1)"),
      db.prepare(
        "INSERT INTO orders(id,user_id,checkout_key,status,recipient,phone,address,subtotal,shipping_fee,total,payment_method,payment_snapshot,proof_id,created_at,expires_at,event_actor_id) VALUES('order','deleted-buyer','checkout-key','pending','Penerima','0812345678','Alamat',15000,1000,16000,'bank','{}','proof',1,9999999999999,'old-staff')"
      ),
      db.prepare("INSERT INTO order_items(id,order_id,product_id,name,unit,price,quantity) VALUES('item','order','archived','Minyak snapshot','liter',15000,1)"),
      db.prepare("UPDATE products SET archived=1 WHERE id='archived'"),
      db.prepare("INSERT INTO order_events(id,order_id,actor_id,status,created_at) VALUES('initial','order','deleted-buyer','pending',1)"),
      db.prepare("INSERT INTO audit_log(id,actor_id,action,created_at) VALUES('historical','deleted-buyer','registered',1)"),
      db.prepare(
        "INSERT INTO sessions(id,user_id,token_hash,csrf,device,created_at,last_seen,expires_at) VALUES('staff-session','old-staff','token','csrf','device',1,1,9999999999999)"
      ),
      db.prepare(
        "INSERT INTO sessions(id,user_id,token_hash,csrf,device,created_at,last_seen,expires_at) VALUES('temp-session','temp-staff','temp-token','csrf','device',1,1,9999999999999)"
      ),
    ]);
    const migration = statements(readFileSync("migrations/0005_owner_staff_photos.sql", "utf8"));
    await assert.rejects(() => db.batch(migration.map((sql) => db.prepare(sql))), /ARSIP_MASIH_MEMILIKI_PESANAN_BERJALAN/);
    assert.equal((await db.prepare("SELECT role FROM users WHERE id='old-staff'").first<{ role: string }>())?.role, "seller");
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='migration_guard'").first(), null);
    await db.prepare("UPDATE orders SET status='expired' WHERE id='order'").run();
    await db.batch(migration.map((sql) => db.prepare(sql)));
    assert.deepEqual(await db.prepare("SELECT role,password_hash,status FROM users WHERE id='old-staff'").first(), {
      role: "staff",
      password_hash: "legacy-hash",
      status: "active",
    });
    assert.deepEqual(await db.prepare("SELECT role,password_hash,status FROM users WHERE id='temp-staff'").first(), {
      role: "staff",
      password_hash: null,
      status: "reset_required",
    });
    assert.equal(await db.prepare("SELECT id FROM users WHERE id='deleted-buyer'").first(), null);
    assert.equal(await db.prepare("SELECT id FROM sessions WHERE id='temp-session'").first(), null);
    assert.ok(await db.prepare("SELECT id FROM sessions WHERE id='staff-session'").first());
    assert.deepEqual(await db.prepare("SELECT user_id,buyer_username,total FROM orders WHERE id='order'").first(), { user_id: null, buyer_username: "pembeli_lama", total: 16000 });
    assert.deepEqual(await db.prepare("SELECT actor_id,actor_username FROM audit_log WHERE id='historical'").first(), { actor_id: null, actor_username: "pembeli_lama" });
    assert.deepEqual(await db.prepare("SELECT actor_id,actor_username FROM order_events WHERE id='initial'").first(), { actor_id: null, actor_username: "pembeli_lama" });
    assert.equal(await db.prepare("SELECT owner_id FROM attachments WHERE id='proof'").first("owner_id"), null);
    assert.equal(await db.prepare("SELECT id FROM products WHERE id='archived'").first(), null);
    assert.equal(await db.prepare("SELECT id FROM attachments WHERE id='archived-photo'").first(), null);
    assert.equal(await db.prepare("SELECT name FROM order_items WHERE id='item'").first("name"), "Minyak snapshot");
    await db.batch(statements(readFileSync("migrations/0006_delivery.sql", "utf8")).map((sql) => db.prepare(sql)));
    assert.deepEqual(await db.prepare("SELECT total,latitude,longitude,shipping_snapshot FROM orders WHERE id='order'").first(), {
      total: 16000,
      latitude: null,
      longitude: null,
      shipping_snapshot: null,
    });
    assert.equal(await db.prepare("SELECT shipping_mode FROM settings WHERE id=1").first("shipping_mode"), "fixed");
    assert.equal((await db.prepare("SELECT * FROM delivery_profiles").all()).results.length, 0);
    assert.deepEqual(await db.prepare("SELECT attachment_id,position FROM product_photos WHERE product_id='live'").first(), { attachment_id: "photo", position: 0 });
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally {
    await mf.dispose();
  }
});
