import { test, expect, type Page } from "@playwright/test";

// All API calls are intercepted: UI coverage never changes a real account or order.
const now = Date.now();
const longName = "Beras kebutuhan keluarga kemasan besar " + "Super".repeat(22);
const product = {
  id: "product-ui",
  name: longName,
  description: "Kebutuhan sehari-hari untuk keluarga. ".repeat(8),
  category: "Bahan pokok " + "Pilihan".repeat(7),
  unit: "kemasan keluarga",
  price: 100000000,
  stock: 999,
  revision: 1,
  photo_id: null,
  archived: 0,
};
const settings = { shipping_fee: 10000, bank_name: "Bank pengujian", bank_account: "12345678901234567890", bank_holder: "Nama pemilik rekening pengujian", qris_id: "qris-ui" };
const order = {
  id: "order-ui-12345678",
  user_id: "buyer",
  username: "username_pengujian_panjang_1234567",
  status: "pending",
  recipient: "Nama penerima " + "Panjang".repeat(12),
  phone: "081234567890",
  address: "Alamat pengiriman lengkap ".repeat(15),
  total: 99900010000,
  subtotal: 99900000000,
  shipping_fee: 10000,
  payment_method: "bank",
  payment_snapshot: JSON.stringify(settings),
  created_at: now,
  decided_at: now,
  expires_at: now + 3600000,
  items: [{ product_id: product.id, name: longName, unit: product.unit, quantity: 999, price: product.price }],
  events: [{ id: "event-ui", status: "pending", created_at: now, actor_username: "username_pengujian_panjang_1234567", note: "Catatan riwayat ".repeat(15) }],
};

async function fixture(page: Page, role: "public" | "buyer" | "seller", state = "filled") {
  let quantity = 1;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.startsWith("/api/attachments/")) {
      const height = path.endsWith("proof-ui") ? 900 : 600;
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 ${height}"><rect width="600" height="${height}" fill="#f6f6f6"/><path d="M30 30h180v180H30zM390 30h180v180H390zM30 390h180v180H30z" fill="#242424"/><text x="30" y="300" font-size="30">Gambar pengujian UI</text></svg>`,
      });
    }
    const user = { id: role, username: "username_pengujian_panjang_1234567", role, must_change_password: 0, created_at: now };
    const rows = Array.from({ length: 30 }, (_, i) => ({
      ...order,
      id: `order-ui-${i}`,
      status: ["pending", "review", "approved", "shipped", "completed", "rejected", "expired"][i % 7],
    }));
    if (state === "error" && path !== "/api/me") return route.fulfill({ status: 500, json: { error: "Permintaan belum berhasil. Silakan coba kembali. ".repeat(5) } });
    if (state === "loading" && path !== "/api/me") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (page.isClosed()) return;
    }
    let data: unknown = {};
    if (path === "/api/me") data = { user: role === "public" ? null : user, csrf: "ui-only" };
    else if (path === "/api/products")
      data = {
        products: state === "empty" ? [] : [product, { ...product, id: "short", name: "Minyak goreng", price: 18000, category: "Dapur", stock: 0 }],
        categories: [product.category, "Dapur"],
      };
    else if (path === "/api/cart") {
      if (request.method() === "PUT") quantity = request.postDataJSON().quantity;
      data = state === "empty" || !quantity ? [] : [{ ...product, quantity }];
    } else if (path === "/api/settings") data = settings;
    else if (path === "/api/orders") data = state === "empty" ? [] : rows;
    else if (path.startsWith("/api/orders/")) data = order;
    else if (path === "/api/sessions") data = [{ id: "session", device: "Mozilla/5.0 (Linux; Android 15) Chrome/130", current: true, created_at: now, last_seen: now }];
    else if (path === "/api/users")
      data =
        request.method() === "POST"
          ? { username: request.postDataJSON().username, password: "Temporary_UI_password_123456789" }
          : state === "empty"
            ? []
            : Array.from({ length: 30 }, (_, i) => ({ ...user, id: "user-" + i, role: i % 2 ? "buyer" : "seller" }));
    else if (path === "/api/audit-logs")
      data =
        state === "empty"
          ? []
          : [
              {
                id: "audit",
                actor_username: user.username,
                actor_id: "actor-" + "x".repeat(70),
                target_id: "target-" + "x".repeat(100),
                target_type: "product",
                action: "product.update",
                outcome: "success",
                created_at: now,
                details: JSON.stringify({ before: { name: longName }, after: { name: longName + " diperbarui" } }),
              },
            ];
    else if (path === "/api/reports/sales")
      data = {
        summary: { orders: state === "empty" ? 0 : 100, total: order.total * 100, subtotal: order.subtotal * 100, shipping_fee: 1000000 },
        daily: [{ day: "2026-11-08", orders: 100, total: order.total * 100 }],
        products: [{ product_id: product.id, name: longName, unit: product.unit, quantity: 999, subtotal: order.subtotal }],
        transactions: state === "empty" ? [] : rows,
        page: 0,
      };
    else if (path === "/api/checkout") data = { id: order.id };
    await route.fulfill({ json: data });
  });
}

async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "absolute" && !el.closest(".table-wrap, dialog:not([open]), .sr-only");
      })
      .slice(0, 8)
      .map((el) => el.tagName + "." + el.className),
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  for (const dialog of await page.locator("dialog[open]").all()) {
    const dimensions = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      content: el.scrollWidth,
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(overflow.viewport + 1);
  }
}

const widths = [320, 375, 390, 430, 619, 620, 621, 699, 700, 701, 768, 849, 850, 851, 1024, 1149, 1150, 1151, 1440];
for (const width of widths) {
  for (const role of ["public", "buyer", "seller"] as const) {
    test(`${role}: seluruh halaman pada ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await fixture(page, role);
      const paths =
        role === "public"
          ? ["/", "/masuk", "/daftar"]
          : role === "buyer"
            ? ["/", "/keranjang", "/checkout", "/pesanan", "/pesanan/order-ui", "/pengaturan#akun", "/pengaturan#keamanan", "/pengaturan#perangkat"]
            : [
                "/",
                "/seller",
                "/seller/produk",
                "/seller/users",
                "/seller/log-aktivitas",
                "/seller/laporan",
                "/seller/pesanan/order-ui",
                ...["akun", "keamanan", "perangkat", "pengiriman", "pembayaran"].map((s) => "/pengaturan#" + s),
              ];
      for (const path of paths) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.locator("main h1").first()).toBeVisible();
          await expect(page.locator("main .loading")).toHaveCount(0);
          if (path === "/seller/log-aktivitas") await page.getByText("Lihat detail", { exact: true }).click();
          if (path === "/seller/users") {
            const label = await page
              .locator('.users-table td[data-label="Username"]')
              .first()
              .evaluate((el) => getComputedStyle(el, "::before").content);
            expect(label).toBe(width <= 620 ? '"Username"' : "none");
          }
          await noOverflow(page);
          if (path === "/seller/laporan") {
            for (const amount of await page.locator(".report-summary dd").all()) {
              const size = await amount.evaluate((el) => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }));
              expect(size.height).toBeLessThanOrEqual(size.line + 1);
            }
          }
          if ([320, 390, 768, 850, 1024, 1440].includes(width)) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: info.outputPath(path.replace(/[^a-z0-9]/gi, "_") + ".png"), fullPage: true });
          }
        });
      }
    });
  }
}

test("notifikasi, keranjang, checkout, dan perubahan orientasi", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "buyer");
  await page.goto("/");
  await page.getByRole("button", { name: "Tambah " + longName, exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  const t = (await toast.boundingBox())!,
    c = (await page.locator(".mobile-cart").boundingBox())!;
  expect(t.x).toBeCloseTo(320 - t.x - t.width, 0);
  expect(t.x).toBeGreaterThanOrEqual(16);
  expect(t.y + t.height).toBeLessThanOrEqual(c.y - 10);
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("toast-320.png") });
  await page.getByRole("button", { name: "Tutup pemberitahuan" }).click();
  await page.locator(".mobile-cart").click();
  await expect(page.locator(".cart-overlay")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const cart = page.locator(".cart-overlay");
  await cart.getByRole("button", { name: "Tambah " + longName, exact: true }).click();
  await expect(cart.locator(".quantity span")).toHaveText("3");
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".mobile-cart")).toBeFocused();
  await page.locator(".mobile-cart").click();
  await page.setViewportSize({ width: 850, height: 390 });
  await expect(page.locator(".cart-overlay")).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page.goto("/checkout");
  await page.setViewportSize({ width: 320, height: 400 });
  await expect(page.locator(".receipt-total strong")).toBeVisible();
  const total = await page
    .locator(".receipt-total strong")
    .evaluate((el) => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(total.height).toBeLessThanOrEqual(total.lineHeight + 1);
  await page.getByLabel("Nama penerima", { exact: true }).fill("Penerima pengujian");
  await page.getByLabel("Nomor HP", { exact: true }).fill("081234567890");
  await page.getByLabel("Alamat lengkap", { exact: true }).fill("Jalan pengujian nomor 123, Jakarta");
  await noOverflow(page);
  await page.getByRole("button", { name: /Buat pesanan/ }).click();
  await expect(page).toHaveURL(/\/pesanan\/order-ui/);
});

test("dialog produk dan menu: scroll, fokus, layar pendek, reduced motion", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 300 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page, "seller");
  await page.goto("/seller/produk");
  const trigger = page.getByRole("button", { name: "Tambah produk", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Tambah produk", exact: true });
  await expect(dialog).toBeVisible();
  await noOverflow(page);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await dialog.getByRole("button", { name: "Tambah produk", exact: true }).scrollIntoViewIfNeeded();
  const rect = (await dialog.getByRole("button", { name: "Tambah produk", exact: true }).boundingBox())!;
  expect(rect.y + rect.height).toBeLessThanOrEqual(300);
  await page.screenshot({ path: info.outputPath("product-dialog-short.png") });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Buka menu navigasi" }).click();
  await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Buka menu navigasi" })).toBeFocused();
});

for (const state of ["empty", "error", "loading"]) {
  for (const role of ["public", "buyer", "seller"] as const)
    test(`${role}: kondisi ${state} pada mobile`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await fixture(page, role, state);
      const paths =
        role === "public"
          ? ["/"]
          : role === "buyer"
            ? ["/", "/keranjang", "/pesanan"]
            : ["/", "/seller", "/seller/produk", "/seller/users", "/seller/log-aktivitas", "/seller/laporan"];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator("main h1").first()).toBeVisible();
        if (state === "loading") await expect(page.locator("main .loading").first()).toBeVisible();
        else await expect(page.locator("main .loading")).toHaveCount(0);
        await noOverflow(page);
      }
    });
}

test("error keranjang terlihat dan dapat ditutup di dalam dialog", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "buyer");
  await page.route("**/api/cart", async (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 409, json: { error: "Stok barang berubah. Kurangi jumlah barang sebelum melanjutkan. ".repeat(3) } });
    return route.fallback();
  });
  await page.goto("/");
  await page.locator(".mobile-cart").click();
  const dialog = page.locator(".cart-overlay");
  await dialog.getByRole("button", { name: "Tambah " + longName, exact: true }).click();
  await expect(dialog.locator(".toast")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("cart-error-320.png") });
  await dialog.getByRole("button", { name: "Tutup pemberitahuan" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("aksi seller dan password sementara pada mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "seller");
  await page.goto("/seller/produk");
  await page.getByRole("button", { name: "Tambah produk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah produk", exact: true });
  await dialog.getByLabel("Nama barang", { exact: true }).fill("Barang pengujian");
  await dialog.getByLabel("Kategori", { exact: true }).fill("Dapur");
  await dialog.getByLabel("Satuan", { exact: true }).fill("kg");
  await dialog.getByLabel("Harga (Rp)", { exact: true }).fill("12000");
  await dialog.getByRole("button", { name: "Tambah produk", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".toast")).toHaveText(/Produk ditambahkan/);
  await page.goto("/seller/users");
  await page.getByRole("button", { name: "Tambah pengguna", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("buyer_ui_test");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await expect(page.locator(".credential code")).toHaveText("Temporary_UI_password_123456789");
  await noOverflow(page);
  await page.locator(".credential").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("temporary-password-320.png") });
});

for (const role of ["buyer", "seller"] as const)
  test(`${role}: seluruh status detail pesanan`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await fixture(page, role);
    for (const status of ["pending", "review", "approved", "shipped", "completed", "rejected", "expired"]) {
      await page.route("**/api/orders/order-ui", (route) =>
        route.fulfill({
          json: {
            ...order,
            status,
            payment_method: status === "pending" ? "qris" : "bank",
            proof_id: status === "pending" ? null : "proof-ui",
            courier: "Kurir pengujian",
            reason: "Alasan penolakan ".repeat(10),
          },
        })
      );
      await page.goto((role === "seller" ? "/seller" : "") + "/pesanan/order-ui");
      await expect(page.locator("main h1")).toBeVisible();
      if (role === "seller" && status === "review") await page.getByRole("button", { name: "Tolak pesanan", exact: true }).click();
      await noOverflow(page);
    }
  });
