import type { DeliveryProfile, Settings, ShippingQuote } from "./types";
import { HttpError, integer, text } from "./security";

export const emptyProfile: DeliveryProfile = { full_name: "", whatsapp: "", address: "", latitude: null, longitude: null };

export function coordinates(latitude: unknown, longitude: unknown, required = true) {
  if (latitude == null && longitude == null && !required) return { latitude: null, longitude: null };
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    throw new HttpError(400, "Pilih titik lokasi yang valid pada peta.");
  return { latitude, longitude };
}

export function whatsapp(value: unknown, required = false) {
  const raw = text(value, "Nomor WhatsApp", 25, required ? 8 : 0);
  if (!raw) return "";
  if (!/^[+\d\s()-]+$/.test(raw)) throw new HttpError(400, "Nomor WhatsApp tidak valid.");
  let number = raw.replace(/[\s()-]/g, "");
  if (number.startsWith("08")) number = "+62" + number.slice(1);
  else if (number.startsWith("628")) number = "+" + number;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new HttpError(400, "Gunakan nomor WhatsApp seperti 081234567890 atau +6281234567890.");
  return number;
}

export function profile(data: Record<string, unknown>, required = false): DeliveryProfile {
  return {
    full_name: text(data.full_name, "Nama lengkap", 100, required ? 1 : 0),
    whatsapp: whatsapp(data.whatsapp, required),
    address: text(data.address, "Alamat lengkap", 1000, required ? 15 : 0),
    ...coordinates(data.latitude, data.longitude, required),
  };
}

export function saveProfile(db: D1Database, userId: string, p: DeliveryProfile) {
  return db
    .prepare(
      `INSERT INTO delivery_profiles(user_id,full_name,whatsapp,address,latitude,longitude) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name,whatsapp=excluded.whatsapp,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude`
    )
    .bind(userId, p.full_name, p.whatsapp, p.address, p.latitude, p.longitude);
}

export function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function dynamicSettings(config: Settings) {
  coordinates(config.store_latitude, config.store_longitude);
  integer(config.rate_per_km, "Tarif per km", 0, 10000000);
  if (typeof config.max_distance_km !== "number" || !Number.isFinite(config.max_distance_km) || config.max_distance_km <= 0 || config.max_distance_km > 20050)
    throw new HttpError(400, "Batas jarak harus lebih dari 0 dan maksimal 20.050 km.");
}

export function shippingQuote(config: Settings, latitude: unknown, longitude: unknown): ShippingQuote {
  const destination = coordinates(latitude, longitude);
  const origin = { latitude: config.store_latitude ?? null, longitude: config.store_longitude ?? null };
  if (config.shipping_mode !== "dynamic") {
    if (config.shipping_fee === null) throw new HttpError(409, "Toko belum mengatur ongkir.");
    return { mode: "fixed", method: "fixed", origin, destination, distance_km: null, billable_km: null, rate_per_km: null, shipping_fee: config.shipping_fee };
  }
  dynamicSettings(config);
  const distance = distanceKm(origin.latitude!, origin.longitude!, destination.latitude!, destination.longitude!);
  if (distance > config.max_distance_km! + 1e-9) throw new HttpError(400, `Lokasi di luar area pengiriman. Batas jarak ${config.max_distance_km} km dari toko.`);
  // Remove only floating-point noise at integer kilometre boundaries.
  const billable = distance === 0 ? 0 : Math.max(1, Math.ceil(distance - 1e-9));
  return {
    mode: "dynamic",
    method: "haversine",
    origin,
    destination,
    distance_km: distance,
    billable_km: billable,
    rate_per_km: config.rate_per_km!,
    shipping_fee: billable * config.rate_per_km!,
  };
}
