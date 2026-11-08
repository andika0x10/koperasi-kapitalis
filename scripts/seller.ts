import { hashPassword, random } from "../lib/security";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2),
  remote = args.includes("--remote"),
  recover = args.includes("--recover");
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const username = arg("--username") || "seller",
  output = arg("--output");
if (output && existsSync(output)) throw new Error("Berkas kredensial sudah ada. Pilih --output baru.");
if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error("Username seller harus 3–32 huruf kecil, angka, atau garis bawah.");
const wrangler = [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "execute",
  "DB",
  "--config",
  "wrangler.db.jsonc",
  remote ? "--remote" : "--local",
  ...(!remote ? ["--persist-to", ".cloudflare/state"] : []),
];
function run(extra: string[]) {
  const result = spawnSync(process.execPath, [...wrangler, ...extra], { encoding: "utf8", timeout: 60000 });
  if (result.status !== 0) throw new Error("Perintah database gagal. Pastikan login Cloudflare dan migrasi sudah siap.");
  return result.stdout;
}
const existing = JSON.parse(run(["--command", "SELECT username FROM users WHERE role='seller' AND deleted_at IS NULL", "--json"])) as { results: { username: string }[] }[];
const sellers = existing.flatMap((r) => r.results);
const current = recover ? sellers.find((s) => s.username === username) : sellers[0];
if (recover && current?.username !== username) throw new Error("Username tidak cocok dengan seller yang tersimpan.");
if (!recover && current) throw new Error("Seller sudah ada. Gunakan --recover hanya untuk memulihkan akses.");
const password = "KK-" + random().slice(0, 24),
  hash = await hashPassword(password),
  dir = mkdtempSync(join(tmpdir(), "kk-seller-"));
try {
  const path = join(dir, "seller.sql"),
    now = Date.now();
  const sql = recover
    ? `UPDATE users SET password_hash='${hash}',must_change_password=1 WHERE role='seller' AND deleted_at IS NULL AND username='${username}'; DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='seller' AND deleted_at IS NULL AND username='${username}');`
    : `INSERT INTO users(id,username,password_hash,role,must_change_password,created_at) VALUES('${crypto.randomUUID()}','${username}','${hash}','seller',1,${now});`;
  const event = `INSERT INTO audit_log(id,actor_id,actor_username,action,target_id,target_type,outcome,details,created_at) SELECT '${crypto.randomUUID()}',NULL,'Operator CLI','${recover ? "seller_recovered" : "seller_bootstrap"}',id,'user','success','{"username":"${username}","role":"seller"}',${now} FROM users WHERE role='seller' AND deleted_at IS NULL AND username='${username}';`;
  writeFileSync(path, sql + event, { mode: 0o600 });
  run(["--file", path]);
  const credentials = `Koperasi Kapitalis — akun seller\nUsername: ${username}\nPassword sementara: ${password}\nLingkungan: ${remote ? "production" : "local"}\n\nWajib mengganti password saat masuk. Hapus berkas ini setelah password diganti.\n`;
  if (output) {
    writeFileSync(output, credentials, { mode: 0o600, flag: "wx" });
    console.log(`Kredensial tersimpan di ${output}.`);
  } else console.log(credentials);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
