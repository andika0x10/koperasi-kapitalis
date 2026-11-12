import type { Auth, Env } from "./env";
import { digest, HttpError, random } from "./security";
export const DAY = 86400000;
export async function authenticate(request: Request, env: Env, required = true): Promise<Auth | null> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)kk_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) {
    if (required) throw new HttpError(401, "Silakan masuk terlebih dahulu.");
    return null;
  }
  const now = Date.now();
  const auth = await env.DB.prepare(
    `SELECT u.id,u.username,u.role,u.status,s.id AS session_id,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.status='active' AND u.is_blocked=0 AND s.token_hash=? AND s.expires_at>? AND s.last_seen>?`
  )
    .bind(await digest(token), now, now - 7 * DAY)
    .first<Auth>();
  if (!auth && required) throw new HttpError(401, "Sesi berakhir. Silakan masuk kembali.");
  if (auth)
    await env.DB.prepare("UPDATE sessions SET last_seen=? WHERE id=? AND last_seen<?")
      .bind(now, auth.session_id, now - 60000)
      .run();
  return auth;
}
export function csrf(request: Request, auth: Auth) {
  if (request.headers.get("x-csrf-token") !== auth.csrf) throw new HttpError(403, "Sesi formulir tidak valid. Muat ulang halaman.");
}
export function unlocked(auth: Auth) {
  if (auth.status !== "active") throw new HttpError(403, "Atur password melalui link dari staf (pelanggan) atau owner (staf) terlebih dahulu.");
}
export function role(auth: Auth, ...values: import("./types").Role[]) {
  if (!values.includes(auth.role)) throw new HttpError(403, "Anda tidak memiliki akses.");
}
export function sessionCookie(token: string, request: Request, maxAge = 30 * 86400) {
  return `kk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function createSession(env: Env, request: Request, userId: string, statements: D1PreparedStatement[] = []) {
  const token = random(),
    id = crypto.randomUUID(),
    now = Date.now();
  await env.DB.batch([
    ...statements,
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<? OR last_seen<?").bind(now, now - 7 * DAY),
    env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf,device,created_at,last_seen,expires_at) VALUES(?,?,?,?,?,?,?,?)").bind(
      id,
      userId,
      await digest(token),
      random(),
      (request.headers.get("user-agent") || "Perangkat tidak dikenal").slice(0, 250),
      now,
      now,
      now + 30 * DAY
    ),
  ]);
  return token;
}
export async function limit(env: Env, key: string, max: number, windowMs: number) {
  const stub = env.LIMITER.get(env.LIMITER.idFromName(await digest(key)));
  const res = await stub.fetch("https://limiter/check", { method: "POST", body: JSON.stringify({ max, windowMs }) });
  if (!res.ok) throw new HttpError(429, "Terlalu banyak percobaan. Coba lagi beberapa saat.");
}
