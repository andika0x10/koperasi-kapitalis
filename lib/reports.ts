import type { SalesReportData } from "./types";
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
  ]);
  return { summary: results[0].results[0], daily: results[1].results, products: results[2].results, transactions: results[3].results, page: rawPage } as unknown as SalesReportData;
}
