import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2),
  value = (key) => {
    const index = args.indexOf(key);
    return index < 0 ? null : args[index + 1];
  };
const base = value("--base") || "http://127.0.0.1:5173",
  credentials = value("--credentials");
for (const path of ["/", "/masuk", "/daftar", "/pengaturan", "/seller", "/seller/users", "/seller/log-aktivitas"]) {
  const response = await fetch(base + path);
  const html = await response.text();
  assert.equal(response.status, 200, path);
  assert.match(html, /<title>Koperasi Kapitalis<\/title>/);
  console.log("OK page", path);
  if (path === "/") {
    const styles = [...html.matchAll(/<link[^>]*href="([^\"]+\.css[^\"]*)"/g)].map((match) => match[1]);
    for (const path of styles) {
      const asset = await fetch(new URL(path, base));
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type") || "", /css/);
      console.log("OK stylesheet");
    }
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  }
}
for (const path of ["/api/users", "/api/audit-logs"]) {
  assert.equal((await fetch(base + path)).status, 401, path);
  console.log("OK protected API", path);
}
const catalog = await fetch(base + "/api/products");
assert.equal(catalog.status, 200);
assert.ok(Array.isArray((await catalog.json()).products));
console.log("OK catalog API");
const settings = await fetch(base + "/api/settings");
assert.equal(settings.status, 200);
console.log("OK store settings API");
if (credentials) {
  const content = readFileSync(credentials, "utf8"),
    username = content.match(/Username: (.+)/)[1].trim(),
    password = content.match(/Password sementara: (.+)/)[1].trim();
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `Login HTTP ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  console.log("OK seller login");
  const meResponse = await fetch(base + "/api/me", { headers: { cookie } }),
    me = await meResponse.json();
  assert.equal(me.user.role, "seller");
  assert.equal(me.user.must_change_password, 1);
  console.log("OK initial password change enforced");
  const sessions = await fetch(base + "/api/sessions", { headers: { cookie } });
  assert.equal(sessions.status, 200);
  assert.ok((await sessions.json()).some((s) => s.current));
  console.log("OK sessions API");
  const protectedResponse = await fetch(base + "/api/products?all=1", { headers: { cookie } });
  assert.equal(protectedResponse.status, 403);
  console.log("OK temporary password access restriction");
  const logout = await fetch(base + "/api/logout", { method: "POST", headers: { cookie, origin: base, "x-csrf-token": me.csrf } });
  assert.equal(logout.status, 200);
  console.log("OK logout");
  const revoked = await fetch(base + "/api/sessions", { headers: { cookie } });
  assert.equal(revoked.status, 401);
  console.log("OK session revoked");
}
