import { digest, random } from "../lib/security";
import { writeFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
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
const username = arg("--username") || "",
  output = arg("--output"),
  originArg = arg("--origin");
if (!output || !originArg) throw new Error("Gunakan --username, --origin, dan --output. Link disimpan hanya ke berkas output baru.");
const originUrl = new URL(originArg);
if (
  originUrl.username ||
  originUrl.password ||
  originUrl.search ||
  originUrl.hash ||
  originUrl.pathname !== "/" ||
  !(originUrl.protocol === "https:" || (originUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)))
)
  throw new Error("Origin harus HTTPS, atau HTTP localhost, tanpa path/kredensial.");
const origin = originUrl.origin;
if (remote && arg("--persist-to")) throw new Error("--persist-to hanya untuk penyimpanan lokal.");
if (output && existsSync(output)) throw new Error("Berkas kredensial sudah ada. Pilih --output baru.");
if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error("Username owner harus 3–32 huruf kecil, angka, atau garis bawah.");
const wrangler = [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "execute",
  "DB",
  "--config",
  "wrangler.db.jsonc",
  remote ? "--remote" : "--local",
  ...(!remote ? ["--persist-to", arg("--persist-to") || ".cloudflare/state"] : []),
];
function run(extra: string[]) {
  const result = spawnSync(process.execPath, [...wrangler, ...extra], { encoding: "utf8", timeout: 60000 });
  if (result.status !== 0) throw new Error("Perintah database gagal. Pastikan login Cloudflare dan migrasi sudah siap.");
  return result.stdout;
}
const existing = JSON.parse(run(["--command", "SELECT username FROM users WHERE role='owner'", "--json"])) as { results: { username: string }[] }[];
const owners = existing.flatMap((r) => r.results);
const current = recover ? owners.find((s) => s.username === username) : owners[0];
if (recover && current?.username !== username) throw new Error("Username tidak cocok dengan owner yang tersimpan.");
if (!recover && current) throw new Error("Owner sudah ada. Gunakan --recover hanya untuk memulihkan akses.");
const token = random(),
  tokenHash = await digest(token),
  expires = Date.now() + 3600000,
  dir = mkdtempSync(join(tmpdir(), "kk-owner-"));
try {
  const path = join(dir, "owner.sql"),
    now = Date.now();
  const sql = recover
    ? `UPDATE users SET password_hash=NULL,status='reset_required' WHERE role='owner' AND username='${username}'; DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='owner' AND username='${username}');`
    : `INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES('${crypto.randomUUID()}','${username}',NULL,'owner','pending',${now});`;
  const linkSql = `INSERT INTO password_links(user_id,token_hash,expires_at) SELECT id,'${tokenHash}',${expires} FROM users WHERE role='owner' AND username='${username}' ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at;`;
  const event = `INSERT INTO audit_log(id,actor_id,actor_username,action,target_id,target_type,outcome,details,created_at) SELECT '${crypto.randomUUID()}',NULL,'Operator CLI','${recover ? "owner_recovered" : "owner_bootstrap"}',id,'user','success','{"username":"${username}","role":"owner"}',${now} FROM users WHERE role='owner' AND username='${username}';`;
  writeFileSync(path, sql + linkSql + event, { mode: 0o600 });
  run(["--file", path]);
  const credentials = `Koperasi Kapitalis — akun owner\nUsername: ${username}\nLink: ${origin}/atur-password#token=${token}\nBerlaku sampai: ${new Date(expires).toISOString()} (1 jam)\nLingkungan: ${remote ? "production" : "local"}\n\nLink sekali pakai. Hapus berkas setelah password diatur.\n`;
  if (output) {
    writeFileSync(output, credentials, { mode: 0o600, flag: "wx" });
    console.log(`Kredensial tersimpan di ${output}.`);
  }
} finally {
  const sqlFile = join(dir, "owner.sql");
  if (existsSync(sqlFile)) unlinkSync(sqlFile);
  rmdirSync(dir);
}
