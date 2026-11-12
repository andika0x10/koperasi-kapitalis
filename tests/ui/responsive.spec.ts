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
  photo_ids: ["photo-ui-1", "photo-ui-2"],
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

async function fixture(page: Page, role: "public" | "buyer" | "owner" | "staff", state = "filled") {
  let quantity = 1,
    uploads = 0;
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
    const user = { id: role, username: "username_pengujian_panjang_1234567", role, status: "active", created_at: now };
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
    else if (path === "/api/profile") data = { full_name: "", whatsapp: "", address: "", latitude: null, longitude: null };
    else if (path === "/api/orders") data = state === "empty" ? [] : rows;
    else if (path.startsWith("/api/orders/")) data = order;
    else if (path === "/api/sessions") data = [{ id: "session", device: "Mozilla/5.0 (Linux; Android 15) Chrome/130", current: true, created_at: now, last_seen: now }];
    else if (path === "/api/users")
      data =
        request.method() === "POST"
          ? { username: request.postDataJSON().username, url: "http://127.0.0.1:4180/atur-password#token=" + "a".repeat(64), expires_at: now + 3600000 }
          : state === "empty"
            ? []
            : Array.from({ length: 30 }, (_, i) => ({ ...user, id: "user-" + i, role: i % 2 ? "buyer" : "staff", status: ["active", "pending", "reset_required"][i % 3] }));
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
    else if (path === "/api/attachments") data = { id: "uploaded-" + ++uploads };
    else if (/^\/api\/users\/[^/]+\/reset$/.test(path))
      data = { username: user.username, url: "http://127.0.0.1:4180/atur-password#token=" + "b".repeat(64), expires_at: now + 3600000 };
    else if (path === "/api/password-links/validate") data = { username: "staf_baru", expires_at: now + 3600000 };
    else if (path === "/api/reports/sales" || path === "/api/reports/purchases")
      data = {
        summary: { orders: state === "empty" ? 0 : 100, total: order.total * 100, subtotal: order.subtotal * 100, shipping_fee: 1000000 },
        daily: [{ day: "2026-11-08", orders: 100, total: order.total * 100 }],
        products: [{ product_id: product.id, name: longName, unit: product.unit, quantity: 999, subtotal: order.subtotal }],
        transactions: state === "empty" ? [] : rows,
        page: 0,
        orders: [{ status: "pending", count: 5 }],
        operations: {
          orders: [
            { status: "review", count: 12 },
            { status: "pending", count: 5 },
          ],
          out_of_stock: [{ id: "short", name: "Minyak goreng", stock: 0, unit: "liter" }],
          low_stock: [{ id: product.id, name: longName, stock: 3, unit: product.unit }],
          accounts: [
            { role: "owner", status: "active", count: 1 },
            { role: "staff", status: "active", count: 4 },
            { role: "buyer", status: "active", count: 30 },
          ],
        },
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
  for (const role of ["public", "buyer", "owner", "staff"] as const) {
    test(`${role}: seluruh halaman pada ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await fixture(page, role);
      const paths =
        role === "public"
          ? ["/", "/masuk", "/daftar"]
          : role === "buyer"
            ? ["/", "/keranjang", "/checkout", "/pesanan", "/pesanan/order-ui", "/pengaturan#akun", "/pengaturan#profil", "/pengaturan#keamanan", "/pengaturan#perangkat"]
            : [
                "/",
                "/kelola/pesanan",
                "/kelola/produk",
                "/owner/pengguna",
                "/owner/log-aktivitas",
                "/owner/statistik",
                "/kelola/pesanan/order-ui",
                ...["akun", "keamanan", "perangkat", "pengiriman", "pembayaran"].map((s) => "/pengaturan#" + s),
              ].filter((path) => role === "owner" || (!path.startsWith("/owner") && !path.endsWith("#pembayaran")));
      for (const path of paths) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.locator("main h1").first()).toBeVisible();
          await expect(page.locator("main .loading")).toHaveCount(0);
          if (path === "/owner/log-aktivitas") await page.getByText("Lihat detail", { exact: true }).click();
          if (path === "/owner/pengguna") {
            const label = await page
              .locator('.users-table td[data-label="Username"]')
              .first()
              .evaluate((el) => getComputedStyle(el, "::before").content);
            expect(label).toBe(width <= 620 ? '"Username"' : "none");
          }
          await noOverflow(page);
          if (path === "/owner/statistik") {
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
  await page
    .locator(".product")
    .getByRole("button", { name: "Tambah " + longName, exact: true })
    .click();
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
  await fixture(page, "owner");
  await page.goto("/kelola/produk");
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
  for (const role of ["public", "buyer", "owner", "staff"] as const)
    test(`${role}: kondisi ${state} pada mobile`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await fixture(page, role, state);
      const paths =
        role === "public"
          ? ["/"]
          : role === "buyer"
            ? ["/", "/keranjang", "/pesanan"]
            : ["/", "/kelola/pesanan", "/kelola/produk", "/owner/pengguna", "/owner/log-aktivitas", "/owner/statistik"].filter(
                (path) => role === "owner" || !path.startsWith("/owner")
              );
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

test("aksi owner dan link aktivasi pada mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "owner");
  await page.goto("/kelola/produk");
  await page.getByRole("button", { name: "Tambah produk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah produk", exact: true });
  await dialog.getByLabel("Nama barang", { exact: true }).fill("Barang pengujian");
  await dialog.getByLabel("Kategori", { exact: true }).fill("Dapur");
  await dialog.getByLabel("Satuan", { exact: true }).fill("kg");
  await dialog.getByLabel("Harga (Rp)", { exact: true }).fill("12000");
  await dialog.getByRole("button", { name: "Tambah produk", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".toast")).toHaveText(/Produk ditambahkan/);
  await page.goto("/owner/pengguna");
  await page.getByRole("button", { name: "Tambah staf", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Tambah staf", exact: true });
  await create.getByLabel("Username", { exact: true }).fill("staf_ui_test");
  await expect(create.locator('input[type="password"]')).toHaveCount(0);
  await create.getByRole("button", { name: "Buat akun dan link aktivasi", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Bagikan link password" });
  await expect(link.getByLabel("Link aktivasi atau reset")).toHaveValue(/atur-password#token=/);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("activation-link-320.png") });
});

for (const role of ["buyer", "owner"] as const)
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
      await page.goto((role === "owner" ? "/kelola" : "") + "/pesanan/order-ui");
      await expect(page.locator("main h1")).toBeVisible();
      if (role === "owner" && status === "review") await page.getByRole("button", { name: "Tolak pesanan", exact: true }).click();
      await noOverflow(page);
    }
  });

test("galeri foto: thumbnail, keyboard, fokus dan mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await fixture(page, "buyer");
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Lihat foto " + longName, exact: true });
  await trigger.click();
  const gallery = page.getByRole("dialog", { name: longName, exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator(".gallery-main")).toHaveAttribute("src", "/api/attachments/photo-ui-1");
  await gallery.getByRole("button", { name: "Berikutnya", exact: true }).click();
  await expect(gallery.locator(".gallery-main")).toHaveAttribute("src", "/api/attachments/photo-ui-2");
  await page.keyboard.press("ArrowLeft");
  await expect(gallery.locator(".gallery-main")).toHaveAttribute("src", "/api/attachments/photo-ui-1");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("gallery-390.png") });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

const testImage = {
  name: "barang.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8m8AAAAASUVORK5CYII=", "base64"),
};

test("multi foto: gagal sebagian, tambah ulang, urutkan dan simpan", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await fixture(page, "staff");
  let upload = 0;
  await page.route("**/api/attachments?kind=product", async (route) => {
    upload++;
    await route.fulfill(upload === 2 ? { status: 400, json: { error: "Unggahan kedua ditolak. Pilih ulang file." } } : { status: 201, json: { id: "new-photo-" + upload } });
  });
  await page.goto("/kelola/produk");
  await page.getByRole("button", { name: "Tambah produk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah produk", exact: true });
  for (const [label, value] of [
    ["Nama barang", "Beras"],
    ["Kategori", "Dapur"],
    ["Satuan", "kg"],
    ["Harga (Rp)", "15000"],
  ])
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByLabel("Tambah foto", { exact: true }).setInputFiles([testImage, { ...testImage, name: "gagal.png" }]);
  await expect(dialog.getByText("Unggahan kedua ditolak. Pilih ulang file.")).toBeVisible();
  await expect(dialog.locator(".photo-list li")).toHaveCount(1);
  await dialog.getByLabel("Tambah foto", { exact: true }).setInputFiles({ ...testImage, name: "ulang.png" });
  await expect(dialog.locator(".photo-list li")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Pindahkan foto 2 ke kiri", exact: true }).click();
  await expect(dialog.locator(".photo-list img").first()).toHaveAttribute("src", "/api/attachments/new-photo-3");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("multi-photo-390.png") });
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/products" && r.method() === "POST");
  await dialog.getByRole("button", { name: "Tambah produk", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.photo_ids).toEqual(["new-photo-3", "new-photo-1"]);
  expect(body.archived).toBeUndefined();
  await expect(dialog).not.toBeVisible();
});

test("tutup editor membuang unggahan draft", async ({ page }) => {
  await fixture(page, "staff");
  await page.goto("/kelola/produk");
  await page.getByRole("button", { name: "Tambah produk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah produk", exact: true });
  await dialog.getByLabel("Tambah foto", { exact: true }).setInputFiles(testImage);
  await expect(dialog.locator(".photo-list li")).toHaveCount(1);
  const discard = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/api/attachments/uploaded-1"));
  await page.keyboard.press("Escape");
  await discard;
});

test("hapus barang menampilkan pesanan penghambat di dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "staff");
  await page.route("**/api/products/product-ui", (route) =>
    route.fulfill({ status: 409, json: { error: "Selesaikan pesanan terkait sebelum menghapus barang.", orders: [{ id: "blocked-order" }] } })
  );
  await page.goto("/kelola/produk");
  await page.getByRole("button", { name: "Hapus permanen", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Hapus barang permanen", exact: true });
  await dialog.getByRole("button", { name: "Hapus permanen", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Pesanan blocked-", exact: true })).toHaveAttribute("href", "/kelola/pesanan/blocked-order");
  await noOverflow(page);
});

test("halaman link password: konfirmasi, token dalam body dan kembali masuk", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await fixture(page, "public");
  const token = "a".repeat(64);
  await page.goto("/atur-password#token=" + token);
  await expect(page.getByText("staf_baru", { exact: true })).toBeVisible();
  await page.getByLabel("Password baru", { exact: true }).fill("password-baru-123");
  await page.getByLabel("Ulangi password baru", { exact: true }).fill("password-salah-123");
  await page.getByRole("button", { name: "Simpan password", exact: true }).click();
  await expect(page.getByText("Konfirmasi password belum sama.")).toBeVisible();
  await page.getByLabel("Ulangi password baru", { exact: true }).fill("password-baru-123");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("set-password-320.png") });
  const complete = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/password-links/complete");
  await page.getByRole("button", { name: "Simpan password", exact: true }).click();
  const req = await complete;
  expect(req.postDataJSON()).toEqual({ token, password: "password-baru-123" });
  expect(req.url()).not.toContain(token);
  await expect(page).toHaveURL(/\/masuk$/);
});

test("link kedaluwarsa menjelaskan langkah berikutnya", async ({ page }) => {
  await fixture(page, "public");
  await page.route("**/api/password-links/validate", (route) =>
    route.fulfill({ status: 400, json: { error: "Link sudah kedaluwarsa, digunakan, atau dibatalkan. Minta link baru kepada owner." } })
  );
  await page.goto("/atur-password#token=" + "a".repeat(64));
  await expect(page.getByText(/Minta link baru kepada owner/)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("akses staf dan pengalihan URL lama", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await fixture(page, "staff");
  await page.goto("/seller/produk");
  await expect(page).toHaveURL(/\/kelola\/produk$/);
  await page.getByRole("button", { name: "Buka menu navigasi" }).click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(menu.getByRole("link", { name: "Pesanan", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Pengguna", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Statistik", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/owner/statistik");
  await expect(page.getByRole("heading", { name: "Halaman tidak tersedia" })).toBeVisible();
  await page.goto("/pengaturan#pembayaran");
  await expect(page.getByRole("heading", { name: "Akun", exact: true })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`close controls stay top right at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, "buyer");
    await page.goto("/");
    await page
      .locator(".product")
      .getByRole("button", { name: "Tambah " + longName, exact: true })
      .click();
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    const check = async () => {
      const container = (await toast.boundingBox())!;
      const close = (await toast.getByRole("button", { name: "Tutup pemberitahuan" }).boundingBox())!;
      expect(close.width).toBeGreaterThanOrEqual(44);
      expect(close.height).toBeGreaterThanOrEqual(44);
      expect(container.x + container.width - close.x - close.width).toBeLessThanOrEqual(18);
      expect(close.y - container.y).toBeLessThanOrEqual(14);
    };
    await check();
    await toast
      .locator("span")
      .first()
      .evaluate((el) => (el.textContent = "Pemberitahuan panjang untuk pelanggan. ".repeat(15)));
    await check();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`close-${width}.png`) });
    await toast.getByRole("button").click();
    await expect(toast).toBeHidden();
  });
}

test("staff can block and unblock customers with reset hidden while blocked", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page, "staff");
  let blocked = false;
  await page.route("**/api/users**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/block")) blocked = true;
    else if (path.endsWith("/unblock")) blocked = false;
    else return route.fulfill({ json: [{ id: "buyer-block", username: "pelanggan_uji", role: "buyer", status: "active", is_blocked: blocked ? 1 : 0, created_at: now }] });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/kelola/pelanggan");
  await page.getByRole("button", { name: "Blokir", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Blokir pelanggan", exact: true });
  await expect(dialog.getByText(/otomatis dibatalkan dan stok dikembalikan/)).toBeVisible();
  await dialog.getByRole("button", { name: "Blokir pelanggan", exact: true }).click();
  await expect(page.locator(".users-table .status")).toHaveText("Diblokir");
  await expect(page.getByRole("button", { name: "Buat link reset", exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole("button", { name: "Buka blokir", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Buka blokir", exact: true }).click();
  await expect(page.locator(".users-table .status")).toHaveText("Aktif");
  await expect(page.getByRole("button", { name: "Buat link reset", exact: true })).toBeVisible();
});

test("customer statistics and staff customer recovery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page, "buyer");
  await page.goto("/statistik");
  await expect(page.getByRole("heading", { name: "Statistik belanja", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Produk paling sering dibeli" })).toBeVisible();
  await expect(page.locator(".order-link").first()).toHaveAttribute("href", /^\/pesanan\//);
  await noOverflow(page);
  await fixture(page, "staff");
  await page.goto("/kelola/pelanggan");
  await expect(page.getByRole("heading", { name: "Pelanggan", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tambah pelanggan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hapus permanen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Buat link reset", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Buat link reset", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Buat link baru", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Bagikan link password" })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`dialog and nested notification close controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, "staff");
    await page.goto("/kelola/pelanggan");
    await page.getByRole("button", { name: "Buat link reset", exact: true }).first().click();
    let dialog = page.getByRole("dialog", { name: "Buat link reset", exact: true });
    const header = dialog.locator(".modal-header");
    await header.locator("h2").evaluate((el) => (el.textContent = "Judul popup sangat panjang untuk menguji posisi tombol tutup pada layar kecil"));
    const headingBox = (await header.boundingBox())!;
    const closeBox = (await header.getByRole("button").boundingBox())!;
    expect(headingBox.x + headingBox.width - closeBox.x - closeBox.width).toBeLessThanOrEqual(1);
    expect(closeBox.y - headingBox.y).toBeLessThanOrEqual(1);
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("button", { name: "Buat link baru", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Bagikan link password" });
    await dialog.getByRole("button", { name: "Salin link", exact: true }).click();
    const toast = dialog.locator(".toast");
    await expect(toast).toBeVisible();
    const toastBox = (await toast.boundingBox())!;
    const dismissBox = (await toast.getByRole("button").boundingBox())!;
    expect(toastBox.x + toastBox.width - dismissBox.x - dismissBox.width).toBeLessThanOrEqual(18);
    expect(dismissBox.y - toastBox.y).toBeLessThanOrEqual(14);
    await page.screenshot({ path: info.outputPath(`nested-toast-${width}.png`) });
    await toast.getByRole("button").click();
    await expect(toast).toBeHidden();
    await dialog.getByRole("button", { name: "Tutup Bagikan link password", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}

for (const state of ["filled", "empty", "error", "loading"]) {
  test(`purchase statistics ${state}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await fixture(page, "buyer", state);
    await page.goto("/statistik");
    await expect(page.getByRole("heading", { name: "Statistik belanja", exact: true })).toBeVisible();
    if (state === "loading") await expect(page.locator("main .loading")).toBeVisible();
    else if (state === "error") await expect(page.getByText(/Permintaan belum berhasil/)).toBeVisible();
    else if (state === "empty") await expect(page.getByRole("heading", { name: "Belum ada belanja terverifikasi pada periode ini" })).toBeVisible();
    else {
      await expect(page.getByRole("heading", { name: "Belanja harian" })).toBeVisible();
      await page.screenshot({ path: info.outputPath("purchases-320.png") });
      await page.setViewportSize({ width: 1440, height: 900 });
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath("purchases-1440.png") });
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByLabel("Periode", { exact: true }).selectOption("custom");
      await page.getByLabel("Tanggal mulai", { exact: true }).fill("2026-12-31");
      await expect(page.getByText("Pilih rentang tanggal yang valid.")).toBeVisible();
    }
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`purchases-${state}.png`) });
  });
}
