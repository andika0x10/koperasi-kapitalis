import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinates, distanceKm, profile, shippingQuote, whatsapp } from "../lib/delivery";
import type { Settings } from "../lib/types";
import { findPlaces, parsePlaces } from "../lib/geocoding";

test("place search validates provider data and encodes user queries", async () => {
  const valid = { geometry: { type: "Point", coordinates: [106.8, -6.2] }, properties: { name: "Pasar", city: "Jakarta", street: "Jalan Melati", housenumber: "12" } };
  assert.deepEqual(parsePlaces({ features: [null, { ...valid, geometry: { type: "Point", coordinates: [181, 0] } }, valid] }), [
    { name: "Pasar", address: "Pasar, Jalan Melati 12, Jakarta", latitude: -6.2, longitude: 106.8 },
  ]);
  assert.deepEqual(parsePlaces({ features: [] }), []);
  assert.throws(() => parsePlaces({}));
  const result = await findPlaces("Pasar & Jakarta", "https://example.com/api/", async (url, options) => {
    assert.equal(new URL(String(url)).searchParams.get("q"), "Pasar & Jakarta");
    assert.equal(new URL(String(url)).searchParams.get("limit"), "5");
    assert.equal(options?.redirect, "manual");
    return Response.json({ features: [valid] });
  });
  assert.equal(result[0].latitude, -6.2);
  for (const response of [new Response("", { status: 503 }), new Response("invalid"), new Response("x".repeat(131073))])
    await assert.rejects(
      findPlaces("Jakarta", "https://example.com/api/", async () => response),
      /Pencarian alamat belum tersedia/
    );
  await assert.rejects(
    findPlaces("Jakarta", "https://example.com/api/", async () => {
      throw new Error("timeout");
    }),
    /pilih pin secara manual/
  );
});

const settings: Settings = {
  shipping_mode: "dynamic",
  store_latitude: 0,
  store_longitude: 0,
  rate_per_km: 2000,
  max_distance_km: 10,
  shipping_fee: 5000,
  bank_name: "",
  bank_account: "",
  bank_holder: "",
  qris_id: null,
};
const latitudeAtKm = (km: number) => ((km / 6371.0088) * 180) / Math.PI;
test("delivery distance, rounding, exact boundaries and zero rate", () => {
  assert.equal(distanceKm(0, 0, 0, 0), 0);
  assert.ok(Math.abs(distanceKm(0, 179.99, 0, -179.99) - 2.2239) < 0.001);
  for (const [km, billable] of [
    [0, 0],
    [0.00000001, 1],
    [0.2, 1],
    [1, 1],
    [1.00001, 2],
    [2.3, 3],
    [10, 10],
  ]) {
    const quote = shippingQuote(settings, latitudeAtKm(km), 0);
    assert.equal(quote.billable_km, billable);
    assert.equal(quote.shipping_fee, billable * 2000);
  }
  assert.throws(() => shippingQuote(settings, latitudeAtKm(10.0001), 0), /di luar area/);
  assert.equal(shippingQuote({ ...settings, rate_per_km: 0 }, latitudeAtKm(2.3), 0).shipping_fee, 0);
  assert.equal(shippingQuote({ ...settings, shipping_mode: "fixed", max_distance_km: null }, latitudeAtKm(20), 0).shipping_fee, 5000);
  assert.throws(() => shippingQuote({ ...settings, store_latitude: null }, 0, 0), /lokasi/);
  assert.throws(() => shippingQuote({ ...settings, rate_per_km: null }, 0, 0), /Tarif/);
});
test("profile allows incomplete values, validates coordinate pairs and normalizes WhatsApp", () => {
  for (const raw of ["081234567890", "6281234567890", "+6281234567890", "0812-3456-7890"]) assert.equal(whatsapp(raw), "+6281234567890");
  for (const raw of ["abc123456", "0812+34567890", "12345678", "+00012345678"]) assert.throws(() => whatsapp(raw));
  assert.equal(whatsapp(""), "");
  assert.throws(() => whatsapp("", true));
  assert.equal(profile({ full_name: "", whatsapp: "", address: "" }).latitude, null);
  assert.throws(() => coordinates(0, null, false));
  for (const lat of [NaN, Infinity, 91, "0"]) assert.throws(() => coordinates(lat, 0));
  assert.throws(() => coordinates(0, 181));
  assert.deepEqual(coordinates(0, 0), { latitude: 0, longitude: 0 });
});
