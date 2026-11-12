import { test, expect, type Page } from "@playwright/test";

type Role = "public" | "buyer" | "staff" | "owner";
const widths = [320, 390, 768, 849, 850, 1149, 1150, 1440, 1920];
const products = [
  { id: "rice", name: "Beras keluarga 5 kg", category: "Bahan pokok", price: 75000, stock: 12, unit: "karung", photo_ids: ["portrait", "landscape"] },
  { id: "oil", name: "Minyak goreng", category: "Dapur", price: 18000, stock: 0, unit: "liter", photo_ids: ["landscape"] },
  { id: "soap", name: "Sabun cuci pakaian", category: "Rumah tangga", price: 22000, stock: 8, unit: "bungkus", photo_ids: ["square"] },
  { id: "sugar", name: "Gula pasir", category: "Bahan pokok", price: 17000, stock: 4, unit: "kg", photo_ids: [] },
  { id: "tea", name: "Teh keluarga " + "Pilihan".repeat(16), category: "Dapur", price: 12500, stock: 20, unit: "kotak", photo_ids: ["portrait"] },
  { id: "coffee", name: "Kopi bubuk", category: "Dapur", price: 28000, stock: 6, unit: "bungkus", photo_ids: ["landscape"] },
].map((product) => ({ ...product, description: "Kebutuhan harian keluarga.", revision: 1 }));

async function fixture(page: Page, role: Role, single = false) {
  let loggedOut = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/attachments/")) {
      const kind = path.split("/").at(-1);
      const [width, height] = kind === "portrait" ? [600, 1000] : kind === "landscape" ? [1200, 600] : [600, 600];
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e6e6e6"/><rect x="${width * 0.2}" y="${height * 0.15}" width="${width * 0.6}" height="${height * 0.7}" rx="20" fill="#ff6f12"/><path d="M0 ${height / 2}h${width}" stroke="#242424" stroke-width="12"/></svg>`,
      });
    }
    if (path === "/api/me")
      return route.fulfill({
        json: {
          user: role === "public" || loggedOut ? null : { id: role, username: role === "buyer" ? "pelanggan" : role, role, status: "active", created_at: 0 },
          csrf: "catalog-test",
        },
      });
    if (path === "/api/products") return route.fulfill({ json: { products: single ? products.slice(0, 1) : products, categories: ["Bahan pokok", "Dapur", "Rumah tangga"] } });
    if (path === "/api/cart") return route.fulfill({ json: [] });
    if (path === "/api/sessions") return route.fulfill({ json: [] });
    if (path === "/api/logout") {
      loggedOut = true;
      return route.fulfill({ json: {} });
    }
    throw new Error(`API katalog yang belum dimock: ${path}`);
  });
}

async function ready(page: Page, count: number) {
  await expect(page.locator(".product")).toHaveCount(count);
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(page: Page, role: Role, width: number) {
  const operator = role === "staff" || role === "owner";
  const layout = await page.locator(".catalog-page").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const grid = el.querySelector(".product-grid")!;
    return {
      width: rect.width,
      left: rect.left,
      right: rect.right,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      gap: getComputedStyle(grid).columnGap,
      scroll: document.documentElement.scrollWidth,
    };
  });
  expect(layout.scroll).toBeLessThanOrEqual(width + 1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(width + 1);
  if (operator) {
    await expect(page.locator(".header-inner .account-menu")).toHaveCount(0);
    expect(layout.width).toBeLessThanOrEqual(1200);
    await expect(page.locator(".management-sidebar"))[width >= 1150 ? "toBeVisible" : "toBeHidden"]();
    await expect(page.getByRole("button", { name: "Buka menu navigasi" }))[width < 1150 ? "toBeVisible" : "toBeHidden"]();
    if (width >= 1150) expect(layout.left).toBe(268);
    if (width >= 850) {
      expect(layout.columns).toBe(Math.floor((layout.width + 20) / 260));
      expect(layout.gap).toBe("20px");
    } else expect(layout.columns).toBe(2);
  } else await expect(page.locator(".management-sidebar")).toHaveCount(0);

  for (const card of await page.locator(".product").all()) {
    const photo = card.locator(".product-photo");
    const bounds = (await photo.boundingBox())!;
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
    const content = photo.locator(".product-gallery-trigger, .photo-placeholder");
    const contentBounds = (await content.boundingBox())!;
    expect(contentBounds.width).toBeCloseTo(bounds.width, 0);
    expect(contentBounds.height).toBeCloseTo(bounds.height, 0);
    const title = (await card.locator("h2").boundingBox())!;
    expect(title.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    const price = (await card.locator(".product-bottom").boundingBox())!;
    expect(price.y).toBeGreaterThanOrEqual(title.y + title.height);
    for (const image of await photo.locator("img").all()) await expect(image).toHaveCSS("object-fit", "cover");
  }
  const heading = (await page.locator(".catalog-heading").boundingBox())!;
  const tools = (await page.locator(".catalog-tools").boundingBox())!;
  expect(tools.x).toBeCloseTo(heading.x, 0);
  expect(tools.y).toBeGreaterThanOrEqual(heading.y + heading.height);
}

for (const role of ["staff", "owner", "public", "buyer"] as const) {
  for (const width of widths) {
    for (const single of [false, true]) {
      test(`${role}: katalog ${single ? "satu" : "banyak"} produk ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await fixture(page, role, single);
        await page.goto("/");
        await ready(page, single ? 1 : products.length);
        await geometry(page, role, width);
        if ([390, 1440, 1920].includes(width) && (!single || role === "staff")) {
          // Decode lazy images before capturing a deterministic full-page baseline.
          await page.locator(".product-photo img").evaluateAll(async (images) => {
            await Promise.all(
              images.map((el) => {
                const img = el as HTMLImageElement;
                img.loading = "eager";
                return img.decode();
              })
            );
          });
          await expect(page).toHaveScreenshot(`catalog-${role}-${single ? "single" : "many"}-${width}.png`, { fullPage: true, animations: "disabled" });
        }
      });
    }
  }
}

for (const role of ["staff", "owner"] as const) {
  test(`${role}: tautan dan panel akun konsisten di desktop dan menu HP`, async ({ page }) => {
    await fixture(page, role);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await ready(page, products.length);
    const sidebar = page.locator(".management-sidebar");
    const destinations = await sidebar.locator("a").evaluateAll((links) => links.map((link) => ({ text: link.textContent?.trim(), href: link.getAttribute("href") })));
    expect(destinations.map((link) => link.text)).toEqual(
      role === "owner" ? ["Statistik", "Pesanan", "Produk", "Pengguna", "Log aktivitas", "Pengaturan"] : ["Pesanan", "Produk", "Pelanggan", "Pengaturan"]
    );
    for (const width of [320, 390, 768, 850, 1149]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "Buka menu navigasi" }).click();
      const menu = page.getByRole("dialog", { name: "Menu", exact: true });
      await expect(menu).toBeVisible();
      expect(await menu.locator("a").evaluateAll((links) => links.map((link) => ({ text: link.textContent?.trim(), href: link.getAttribute("href") })))).toEqual(destinations);
      const positions = await menu
        .locator("a")
        .evaluateAll((links) => links.map((link) => ({ top: link.getBoundingClientRect().top, bottom: link.getBoundingClientRect().bottom })));
      for (let index = 1; index < positions.length; index++) expect(positions[index].top).toBeGreaterThanOrEqual(positions[index - 1].bottom - 1);
      await expect(menu.getByRole("link", { name: "Pengaturan", exact: true })).toHaveCount(1);
      await expect(menu.locator(".sidebar-avatar")).toHaveText("");
      await expect(menu.getByRole("button", { name: "Keluar", exact: true })).toBeVisible();
      expect(await menu.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 390) await expect(menu).toHaveScreenshot(`navigation-${role}-390.png`, { animations: "disabled" });
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Buka menu navigasi" }).click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await menu.getByRole("link", { name: "Pengaturan", exact: true }).click();
    await expect(page).toHaveURL(/\/pengaturan$/);
    await expect(menu).toBeHidden();
    await page.getByRole("button", { name: "Buka menu navigasi" }).click();
    await expect(menu.getByRole("link", { name: "Pengaturan", exact: true })).toHaveAttribute("aria-current", "page");
    await page.setViewportSize({ width: 1150, height: 900 });
    await expect(menu).toBeHidden();
    await expect(sidebar.getByRole("link", { name: "Pengaturan", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });

  test(`${role}: pencarian, kategori, galeri, menu dan resize`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await fixture(page, role);
    await page.goto("/");
    await ready(page, products.length);
    const before = (await page.locator(".product").first().boundingBox())!.width;
    await page.getByLabel("Cari barang", { exact: true }).fill("Beras");
    await ready(page, 1);
    expect((await page.locator(".product").first().boundingBox())!.width).toBeCloseTo(before, 0);
    await page.getByRole("button", { name: "Hapus pencarian" }).click();
    await page.getByLabel("Kategori", { exact: true }).selectOption("Rumah tangga");
    await ready(page, 1);
    await expect(page.locator(".product h2")).toHaveText("Sabun cuci pakaian");
    await page.getByLabel("Kategori", { exact: true }).selectOption("");
    const trigger = page.getByRole("button", { name: "Lihat foto Beras keluarga 5 kg", exact: true });
    await trigger.click();
    await expect(page.locator(".gallery-main")).toHaveCSS("object-fit", "contain");
    await page.getByRole("button", { name: "Berikutnya", exact: true }).click();
    await expect(page.locator(".gallery-main")).toHaveAttribute("alt", "Beras keluarga 5 kg, foto 2");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    for (const width of [1149, 390, 1150, 849, 850]) {
      await page.setViewportSize({ width, height: 900 });
      await geometry(page, role, width);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    const menu = page.getByRole("button", { name: "Buka menu navigasi" });
    await menu.click();
    const dialog = page.getByRole("dialog", { name: "Menu", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Pesanan", exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Pengaturan", exact: true })).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Keluar", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    const sidebar = page.locator(".management-sidebar");
    const settings = sidebar.getByRole("link", { name: "Pengaturan", exact: true });
    await expect(settings).toHaveCount(1);
    await settings.click();
    await expect(page).toHaveURL(/\/pengaturan$/);
    await expect(settings).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main h1")).toHaveText("Pengaturan");
    const [logout] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/logout")),
      sidebar.getByRole("button", { name: "Keluar", exact: true }).click(),
    ]);
    expect(logout.method()).toBe("POST");
    await expect(page.locator(".management-sidebar")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });
}
