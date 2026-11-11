export async function productPhotos<T extends { id: string }>(db: D1Database, products: T[]): Promise<(T & { photo_ids: string[] })[]> {
  if (!products.length) return [];
  const photos = await db.prepare("SELECT product_id,attachment_id FROM product_photos ORDER BY product_id,position").all<{ product_id: string; attachment_id: string }>();
  const byProduct = new Map<string, string[]>();
  for (const p of photos.results) byProduct.set(p.product_id, [...(byProduct.get(p.product_id) || []), p.attachment_id]);
  return products.map((p) => ({ ...p, photo_ids: byProduct.get(p.id) || [] }));
}

export function unusedProductPhotos(db: D1Database, before = Date.now() - 86400000) {
  return db.prepare("DELETE FROM attachments WHERE kind='product' AND created_at<? AND NOT EXISTS(SELECT 1 FROM product_photos WHERE attachment_id=attachments.id)").bind(before);
}
