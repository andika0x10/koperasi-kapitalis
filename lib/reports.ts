import type { SalesReportData, PurchaseReportData } from "./types";
import { HttpError } from "./security";
export function reportRange(from: string | null, to: string | null) {
  function parse(value: string | null) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Pilih tanggal mulai dan akhir yang valid.");
    const utc = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== value) throw new HttpError(400, "Tanggal tidak valid.");
    return utc - 7 * 3600000;
  }
  const start = parse(from),
    last = parse(to);
  if (last < start) throw new HttpError(400, "Tanggal akhir harus setelah tanggal mulai.");
  return { start, end: last + 86400000 };
}
export async function salesReport(db: D1Database, url: URL): Promise<SalesReportData> {
  const { start, end } = reportRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const rawPage = Number(url.searchParams.get("page") || 0);
  if (!Number.isSafeInteger(rawPage) || rawPage < 0 || rawPage > 10000) throw new HttpError(400, "Halaman tidak valid.");
  const where = "status IN ('approved','shipped','completed') AND decided_at>=? AND decided_at<?";
  // One batch gives all aggregates and the transaction page a consistent database snapshot.
  const results = await db.batch([
    db
      .prepare(`SELECT COUNT(*) orders,COALESCE(SUM(total),0) total,COALESCE(SUM(subtotal),0) subtotal,COALESCE(SUM(shipping_fee),0) shipping_fee FROM orders WHERE ${where}`)
      .bind(start, end),
    db.prepare(`SELECT date(decided_at/1000,'unixepoch','+7 hours') day,COUNT(*) orders,SUM(total) total FROM orders WHERE ${where} GROUP BY day ORDER BY day`).bind(start, end),
    db
      .prepare(
        `SELECT i.product_id,i.name,i.unit,SUM(i.quantity) quantity,SUM(i.price*i.quantity) subtotal FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.${where} GROUP BY i.product_id,i.name,i.unit ORDER BY quantity DESC,i.name LIMIT 10`
      )
      .bind(start, end),
    db
      .prepare(`SELECT id,recipient,status,decided_at,subtotal,shipping_fee,total FROM orders WHERE ${where} ORDER BY decided_at DESC,id DESC LIMIT 30 OFFSET ?`)
      .bind(start, end, rawPage * 30),
    db.prepare("SELECT status,COUNT(*) count FROM orders GROUP BY status"),
    db.prepare("SELECT id,name,stock,unit FROM products WHERE stock=0 ORDER BY name"),
    db.prepare("SELECT id,name,stock,unit FROM products WHERE stock BETWEEN 1 AND 5 ORDER BY stock,name"),
    db.prepare("SELECT role,status,COUNT(*) count FROM users GROUP BY role,status"),
  ]);
  return {
    summary: results[0].results[0],
    daily: results[1].results,
    products: results[2].results,
    transactions: results[3].results,
    page: rawPage,
    operations: { orders: results[4].results, out_of_stock: results[5].results, low_stock: results[6].results, accounts: results[7].results },
  } as unknown as SalesReportData;
}

export async function purchaseReport(db: D1Database, url: URL, userId: string): Promise<PurchaseReportData> {
  const { start, end } = reportRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const page = Number(url.searchParams.get("page") || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new HttpError(400, "Halaman tidak valid.");
  const where = "o.user_id=? AND o.status IN ('approved','shipped','completed') AND o.decided_at>=? AND o.decided_at<?";
  const results = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) orders,COALESCE(SUM(o.total),0) total,COALESCE(SUM(o.subtotal),0) subtotal,COALESCE(SUM(o.shipping_fee),0) shipping_fee FROM orders o WHERE ${where}`
      )
      .bind(userId, start, end),
    db
      .prepare(`SELECT date(o.decided_at/1000,'unixepoch','+7 hours') day,COUNT(*) orders,SUM(o.total) total FROM orders o WHERE ${where} GROUP BY day ORDER BY day`)
      .bind(userId, start, end),
    db
      .prepare(
        `SELECT i.product_id,i.name,i.unit,SUM(i.quantity) quantity,SUM(i.price*i.quantity) subtotal FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${where} GROUP BY i.product_id,i.name,i.unit ORDER BY quantity DESC,i.name LIMIT 10`
      )
      .bind(userId, start, end),
    db
      .prepare(
        `SELECT o.id,o.recipient,o.status,o.decided_at,o.subtotal,o.shipping_fee,o.total FROM orders o WHERE ${where} ORDER BY o.decided_at DESC,o.id DESC LIMIT 30 OFFSET ?`
      )
      .bind(userId, start, end, page * 30),
    db.prepare("SELECT status,COUNT(*) count FROM orders WHERE user_id=? GROUP BY status").bind(userId),
  ]);
  return {
    summary: results[0].results[0] as PurchaseReportData["summary"],
    daily: results[1].results as PurchaseReportData["daily"],
    products: results[2].results as PurchaseReportData["products"],
    transactions: results[3].results as PurchaseReportData["transactions"],
    orders: results[4].results as PurchaseReportData["orders"],
    page,
  };
}
