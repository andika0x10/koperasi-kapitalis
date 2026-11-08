import type { Env } from "./env";
import { HttpError, text } from "./security";
import { reportRange } from "./reports";

// Only explicitly approved fields may enter persistent audit details.
const allowed = new Set([
  "username",
  "role",
  "deleted_at",
  "name",
  "description",
  "category",
  "unit",
  "price",
  "stock",
  "photo_id",
  "archived",
  "shipping_fee",
  "bank_name",
  "bank_account",
  "bank_holder",
  "qris_id",
  "quantity",
  "status",
  "courier",
  "total",
  "payment_method",
  "kind",
  "bytes",
  "all",
  "count",
  "code",
]);
export function safeDetails(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key, value]) => allowed.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))));
}
export type Actor = { id: string | null; username: string };
export function audit(db: D1Database, actor: Actor | null, action: string, target: string | null, type: string, details: unknown = null, outcome = "success") {
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    details =
      "before" in record || "after" in record
        ? Object.fromEntries(
            ["before", "after"]
              .filter((key) => key in record)
              .map((key) => [key, record[key] && typeof record[key] === "object" ? safeDetails(record[key] as Record<string, unknown>) : null])
          )
        : safeDetails(record);
  }
  return db
    .prepare("INSERT INTO audit_log(id,actor_id,actor_username,action,target_id,target_type,outcome,details,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor?.id ?? null, actor?.username ?? "Sistem", action, target, type, outcome, details === null ? null : JSON.stringify(details), Date.now());
}
export function username(value: unknown) {
  const name = text(value, "Username", 32, 3).toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(name)) throw new HttpError(400, "Username memakai 3–32 huruf, angka, atau garis bawah.");
  return name;
}
export function pageNumber(url: URL) {
  const page = Number(url.searchParams.get("page") || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new HttpError(400, "Halaman tidak valid.");
  return page;
}
export async function auditLogs(env: Env, url: URL) {
  const p = url.searchParams,
    actor = (p.get("actor") || "").slice(0, 100),
    action = (p.get("action") || "").slice(0, 100),
    q = (p.get("q") || "").slice(0, 100);
  let start = Date.now() - 365 * 86400000,
    end = Date.now() + 1;
  if (p.get("from") || p.get("to")) {
    const range = reportRange(p.get("from"), p.get("to"));
    start = Math.max(start, range.start);
    end = range.end;
  }
  return (
    await env.DB.prepare(
      `SELECT * FROM audit_log WHERE created_at>=? AND created_at<? AND (?='' OR instr(lower(COALESCE(actor_username,'')),lower(?))>0 OR actor_id=?) AND (?='' OR action=?) AND (?='' OR instr(lower(COALESCE(target_id,'')),lower(?))>0 OR instr(lower(COALESCE(details,'')),lower(?))>0) ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?`
    )
      .bind(start, end, actor, actor, actor, action, action, q, q, q, pageNumber(url) * 30)
      .all()
  ).results;
}
