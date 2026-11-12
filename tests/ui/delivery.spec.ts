import { test, expect, type Page } from "@playwright/test";

const location = { latitude: -6.2, longitude: 106.8 };
const profile = { full_name: "Andi Pratama", whatsapp: "+6281234567890", address: "Jalan Melati 12, Jakarta Selatan 12345", ...location };
const settings = {
  shipping_mode: "dynamic",
  shipping_fee: 5000,
  store_latitude: -6.21,
  store_longitude: 106.8,
  rate_per_km: 2000,
  max_distance_km: 10,
  bank_name: "Bank uji",
  bank_account: "123456",
  bank_holder: "Koperasi Kapitalis",
  qris_id: null,
};
const quote = { mode: "dynamic", method: "haversine", origin: location, destination: location, distance_km: 2.3, billable_km: 3, rate_per_km: 2000, shipping_fee: 6000 };
const item = { id: "rice", name: "Beras keluarga", unit: "kg", price: 10000, stock: 5, quantity: 1, photo_ids: [] };
type Options = { role?: string; empty?: boolean; profileGate?: Promise<void>; tileFailure?: boolean; conflict?: boolean; legacy?: boolean };
async function fixture(page: Page, options: Options = {}) {
  const writes: { path: string; data: any }[] = [];
  let currentSettings = { ...settings };
  let currentProfile = options.empty ? { full_name: "", whatsapp: "", address: "", latitude: null, longitude: null } : { ...profile };
  let first = true;
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    options.tileFailure
      ? route.abort()
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee5"/><path d="M0 80H256M90 0V256" stroke="#fff" stroke-width="12"/><path d="M0 80H256M90 0V256" stroke="#c8c8c8" stroke-width="1"/></svg>',
        })
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const data = request.method() === "GET" ? null : request.postDataJSON();
    if (data) writes.push({ path, data });
    if (path === "/api/me") return route.fulfill({ json: { user: { id: "buyer", username: "andi", role: options.role || "buyer", status: "active" }, csrf: "test" } });
    if (path === "/api/settings") {
      if (data) currentSettings = { ...currentSettings, ...data };
      return route.fulfill({ json: currentSettings });
    }
    if (path === "/api/profile") {
      if (data) currentProfile = data;
      if (options.profileGate) await options.profileGate;
      return route.fulfill({ json: currentProfile });
    }
    if (path === "/api/cart") return route.fulfill({ json: [item] });
    if (path === "/api/places") return route.fulfill({ json: [{ name: "Pasar Minggu", address: "Pasar Minggu, Jakarta, Indonesia", latitude: -6.28, longitude: 106.83 }] });
    if (path === "/api/sessions") return route.fulfill({ json: [] });
    if (path === "/api/shipping/quote")
      return route.fulfill({ json: { ...quote, destination: data, rate_per_km: currentSettings.rate_per_km, shipping_fee: 3 * currentSettings.rate_per_km } });
    if (path === "/api/checkout") {
      if (options.conflict && first) {
        first = false;
        currentSettings.rate_per_km = 3000;
        return route.fulfill({ status: 409, json: { error: "Harga atau ongkir berubah. Periksa total terbaru." } });
      }
      return route.fulfill({ json: { id: "delivery-order" } });
    }
    if (path === "/api/orders/delivery-order")
      return route.fulfill({
        json: {
          id: "delivery-order",
          user_id: "buyer",
          recipient: profile.full_name,
          phone: profile.whatsapp,
          address: profile.address,
          ...(options.legacy ? {} : location),
          status: "pending",
          subtotal: 10000,
          shipping_fee: 6000,
          total: 16000,
          payment_method: "bank",
          payment_snapshot: JSON.stringify(settings),
          created_at: Date.now(),
          expires_at: Date.now() + 3600000,
          items: [item],
          events: [],
        },
      });
    throw new Error(`Unexpected API: ${path}`);
  });
  return writes;
}

for (const width of [390, 1440]) {
  test(`delivery checkout, profile and owner layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto("/checkout");
    await expect(page.getByLabel("Nama lengkap", { exact: true })).toHaveValue(profile.full_name);
    await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeEnabled();
    await expect(page.getByText("Jarak garis lurus dari toko:", { exact: false })).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon")).toBeVisible();
    const formBounds = (await page.locator(".checkout-layout > section").boundingBox())!;
    const receiptBounds = (await page.locator(".checkout-layout > .receipt").boundingBox())!;
    if (width < 850) expect(receiptBounds.y).toBeGreaterThan(formBounds.y + formBounds.height);
    else expect(receiptBounds.x).toBeGreaterThan(formBounds.x + formBounds.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.test-artifacts/delivery-checkout-${width}.png`, fullPage: true });
    await page.goto("/pengaturan#profil");
    await expect(page.getByLabel("Nomor WhatsApp", { exact: true })).toHaveValue(profile.whatsapp);
    await page.getByLabel("Nama lengkap", { exact: true }).fill("Andi Baru");
    await page.getByRole("button", { name: "Simpan profil pengiriman" }).click();
    await expect(page.getByText("Profil pengiriman disimpan.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await fixture(page, { role: "owner" });
    await page.goto("/pengaturan#pengiriman");
    await page.reload();
    await expect(page.getByLabel("Tarif per km (Rp)", { exact: true })).toHaveValue("2000");
    await expect(page.locator(".leaflet-marker-icon")).toBeVisible();
    await page.screenshot({ path: `.test-artifacts/delivery-owner-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
test("late profile response preserves edited fields and checkout sends destination", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes = await fixture(page, { profileGate: gate });
  await page.goto("/checkout");
  await page.getByLabel("Nama lengkap", { exact: true }).fill("Nama yang diketik");
  release();
  await expect(page.getByLabel("Nomor WhatsApp", { exact: true })).toHaveValue(profile.whatsapp);
  await expect(page.getByLabel("Nama lengkap", { exact: true })).toHaveValue("Nama yang diketik");
  await page.getByRole("button", { name: "Buat pesanan", exact: true }).click();
  await expect(page).toHaveURL(/pesanan\/delivery-order/);
  expect(writes.find((write) => write.path === "/api/checkout")?.data).toMatchObject({ recipient: "Nama yang diketik", ...location, expected_total: 16000 });
  expect(writes.filter((write) => write.path === "/api/profile")).toHaveLength(0);
  await expect(page.getByRole("link", { name: "Buka di Maps" })).toHaveAttribute("href", /-6.2,106.8/);
});
test("location denial permits manual pin and keyboard coordinate selection", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) => fail({ code: 1 }) } });
  });
  await fixture(page, { empty: true });
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Gunakan lokasi saya" }).click();
  await expect(page.getByRole("alert")).toContainText("Pilih pin secara manual");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByRole("region", { name: "Peta titik pengiriman" }).click({ position: { x: 120, y: 100 } });
  await expect(page.getByLabel("Latitude titik pengiriman")).not.toHaveValue("");
  await page.getByLabel("Latitude titik pengiriman").fill("-6.2");
  await page.getByLabel("Longitude titik pengiriman").fill("106.8");
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeEnabled();
  const pin = (await page.locator(".leaflet-marker-icon").boundingBox())!;
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await page.mouse.down();
  await page.mouse.move(pin.x + pin.width / 2 + 50, pin.y + pin.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("Latitude titik pengiriman")).not.toHaveValue("-6.2");
});
test("device location works with the application permission policy", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -6.25, longitude: 106.85 });
  await fixture(page, { empty: true });
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Gunakan lokasi saya" }).click();
  await expect(page.getByLabel("Latitude titik pengiriman")).toHaveValue("-6.25");
  await expect(page.getByLabel("Longitude titik pengiriman")).toHaveValue("106.85");
});
test("quote errors block checkout and can be retried", async ({ page }) => {
  await fixture(page);
  let first = true;
  await page.route("**/api/shipping/quote", (route) => {
    if (first) {
      first = false;
      return route.fulfill({ status: 400, json: { error: "Lokasi di luar area pengiriman. Batas jarak 10 km dari toko." } });
    }
    return route.fulfill({ json: quote });
  });
  await page.goto("/checkout");
  await expect(page.getByRole("alert")).toContainText("di luar area pengiriman");
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Hitung ulang ongkir" }).click();
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeEnabled();
});
test("map tile failure keeps manual coordinates usable", async ({ page }) => {
  await fixture(page, { tileFailure: true });
  await page.goto("/checkout");
  await expect(page.getByRole("alert")).toContainText("Peta gagal dimuat");
  await page.getByLabel("Latitude titik pengiriman").fill("-6.25");
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeEnabled();
});
test("tariff conflict shows refreshed total and requires another checkout action", async ({ page }) => {
  const writes = await fixture(page, { conflict: true });
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Buat pesanan", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Periksa total terbaru");
  await expect(page.locator(".receipt-total")).toContainText("19.000");
  expect(writes.filter((write) => write.path === "/api/checkout")).toHaveLength(1);
  await page.getByRole("button", { name: "Buat pesanan", exact: true }).click();
  await expect(page).toHaveURL(/pesanan\/delivery-order/);
  expect(writes.filter((write) => write.path === "/api/checkout")[1].data.expected_total).toBe(19000);
});
test("staff has no shipping settings and legacy orders need no coordinates", async ({ page }) => {
  await fixture(page, { role: "staff", legacy: true });
  await page.goto("/pengaturan#pengiriman");
  await expect(page.getByRole("heading", { name: "Akun", exact: true })).toBeVisible();
  await expect(page.getByLabel("Tarif per km (Rp)", { exact: true })).toHaveCount(0);
  await page.goto("/kelola/pesanan/delivery-order");
  await expect(page.getByText(profile.address, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka di Maps" })).toHaveCount(0);
});
for (const [role, width, path, label] of [
  ["buyer", 390, "/checkout", "titik pengiriman"],
  ["owner", 1440, "/pengaturan#pengiriman", "titik toko"],
] as const) {
  test(`address search moves ${role} pin at ${width}px without submitting the form`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await fixture(page, { role });
    let searches = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/places") searches++;
    });
    await page.goto(path);
    await page.getByLabel("Cari alamat atau nama tempat").fill("Pasar Minggu Jakarta");
    expect(searches).toBe(0);
    await page.getByLabel("Cari alamat atau nama tempat").press("Enter");
    await expect(page.getByRole("list", { name: "Hasil pencarian alamat" })).toBeVisible();
    await page.getByRole("button", { name: "Pasar Minggu Pasar Minggu, Jakarta, Indonesia" }).click();
    await expect(page.getByLabel(`Latitude ${label}`)).toHaveValue("-6.28");
    await expect(page.getByLabel(`Longitude ${label}`)).toHaveValue("106.83");
    await expect(page.locator(".leaflet-marker-icon")).toBeVisible();
    await expect(page.getByText(/Pin dipindahkan ke Pasar Minggu/)).toBeVisible();
    expect(searches).toBe(1);
    expect(writes.filter((write) => ["/api/checkout", "/api/settings", "/api/profile"].includes(write.path))).toHaveLength(0);
    if (role === "buyer") await expect(page.getByLabel("Alamat lengkap", { exact: true })).toHaveValue(profile.address);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.test-artifacts/address-search-${role}-${width}.png`, fullPage: true });
  });
}
test("address search empty results and service errors preserve the selected location", async ({ page }) => {
  await fixture(page);
  let attempt = 0;
  await page.route("**/api/places?*", (route) =>
    ++attempt === 1 ? route.fulfill({ json: [] }) : route.fulfill({ status: 503, json: { error: "Pencarian alamat belum tersedia. Coba lagi atau pilih pin secara manual." } })
  );
  await page.goto("/checkout");
  await page.getByLabel("Cari alamat atau nama tempat").fill("Alamat tidak dikenal");
  await page.getByRole("button", { name: "Cari alamat", exact: true }).click();
  await expect(page.getByText(/Alamat belum ditemukan/)).toBeVisible();
  await page.getByRole("button", { name: "Cari alamat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Pencarian alamat belum tersedia");
  await expect(page.getByLabel("Latitude titik pengiriman")).toHaveValue("-6.2");
  await expect(page.getByRole("button", { name: "Buat pesanan", exact: true })).toBeEnabled();
});
