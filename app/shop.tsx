"use client";
import { isOperator } from "../lib/types";
import { ProductGallery } from "./photos";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Product, CartItem, Settings, DeliveryProfile, Coordinates, ShippingQuote } from "../lib/types";
import { LocationMap } from "./location-map";
import { money } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Empty, Field, ActionForm, image, Overlay } from "./ui";
export function Catalog() {
  const { me, api, notify, changed } = useApp(),
    router = useRouter();
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [busy, setBusy] = useState(""),
    [cartOpen, setCartOpen] = useState(false),
    [gallery, setGallery] = useState<Product | null>(null);
  const mobileCartRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const bar = mobileCartRef.current;
    const site = bar?.closest<HTMLElement>(".site");
    if (!bar || !site) return;
    const observer = new ResizeObserver(() => {
      site.style.setProperty("--mobile-cart-height", `${bar.getBoundingClientRect().height}px`);
    });
    observer.observe(bar);
    const query = matchMedia("(min-width: 850px)");
    const closeOnDesktop = () => {
      if (query.matches) setCartOpen(false);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => {
      observer.disconnect();
      site.style.removeProperty("--mobile-cart-height");
      query.removeEventListener("change", closeOnDesktop);
    };
  }, [me.user?.role]);
  const { data, error, loading } = useData<{ products: Product[]; categories: string[] }>("/api/products"),
    cart = useData<CartItem[]>(me.user?.role === "buyer" ? "/api/cart" : null);
  const products = data?.products.filter((p) => (!category || p.category === category) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))) || [];
  const count = cart.data?.reduce((s, p) => s + p.quantity, 0) || 0;
  async function add(p: Product) {
    if (!me.user) {
      router.push("/masuk");
      return;
    }
    setBusy(p.id);
    try {
      const qty = (cart.data?.find((c) => c.id === p.id)?.quantity || 0) + 1;
      await api("/api/cart", "PUT", { product_id: p.id, quantity: qty });
      changed();
      notify(`${p.name} ditambahkan ke keranjang.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="catalog-page">
      {gallery && <ProductGallery name={gallery.name} photos={gallery.photo_ids} onClose={() => setGallery(null)} />}
      <div className="page-heading catalog-heading">
        <div>
          <h1>Kebutuhan sehari-hari</h1>
          <p>Temukan barangnya, atur jumlahnya, lalu pesan.</p>
        </div>
        <span className="catalog-count">{data?.products.length || 0} barang tersedia</span>
      </div>
      <div className="catalog-layout">
        <section className="catalog">
          <div className="catalog-tools">
            <div className="search">
              <Icon name="search" size={20} />
              <input aria-label="Cari barang" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kebutuhan Anda…" />
              {q && (
                <button aria-label="Hapus pencarian" onClick={() => setQ("")}>
                  <Icon name="close" size={17} />
                </button>
              )}
            </div>
            <select aria-label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Semua kategori</option>
              {data?.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <ErrorBox message={error} />
          {loading && !data ? (
            <Loading />
          ) : products.length ? (
            <div className="product-grid">
              {products.map((p) => (
                <article className="product" key={p.id}>
                  <div className="product-photo">
                    {p.photo_ids[0] ? (
                      <button className="product-gallery-trigger" aria-label={"Lihat foto " + p.name} onClick={() => setGallery(p)}>
                        <img src={image(p.photo_ids[0])} alt={p.name} loading="lazy" />
                        {p.photo_ids.length > 1 && <span className="photo-count">{p.photo_ids.length} foto</span>}
                      </button>
                    ) : (
                      <div className="photo-placeholder">
                        <Icon name="box" size={48} />
                        <span>Foto belum tersedia</span>
                      </div>
                    )}
                    {!p.stock && <span className="sold-out">Stok habis</span>}
                  </div>
                  <div className="product-meta">
                    <span>{p.category}</span>
                    <span>Stok {p.stock}</span>
                  </div>
                  <h2>{p.name}</h2>
                  {p.description && <p className="product-description">{p.description}</p>}
                  <div className="product-bottom">
                    <div>
                      <strong>{money(p.price)}</strong>
                      <small>per {p.unit}</small>
                    </div>
                    {!isOperator(me.user?.role) && (
                      <button className="add-button" aria-label={"Tambah " + p.name} disabled={!p.stock || busy === p.id} onClick={() => add(p)}>
                        <Icon name="plus" size={18} />
                        <span>{busy === p.id ? "…" : "Tambah"}</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title={q || category ? "Barang tidak ditemukan" : "Katalog sedang disiapkan"}>
              <p>{q || category ? "Coba kata lain atau tampilkan semua kategori." : "Staf belum menambahkan barang. Silakan kembali lagi nanti."}</p>
              {(q || category) && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setQ("");
                    setCategory("");
                  }}
                >
                  Tampilkan semua barang
                </button>
              )}
            </Empty>
          )}
        </section>
        {!isOperator(me.user?.role) && (
          <aside className="cart-panel">
            <h2 className="cart-top">
              Keranjang Anda <span>{count}</span>
            </h2>
            <Cart cart={cart.data || []} error={cart.error} loading={cart.loading} compact />
          </aside>
        )}
      </div>
      {!isOperator(me.user?.role) && (
        <button ref={mobileCartRef} className="mobile-cart" onClick={() => setCartOpen(true)}>
          <span>
            <Icon name="bag" />
            Keranjang ({count})
          </span>
          <strong>{money(cart.data?.reduce((s, p) => s + p.price * p.quantity, 0) || 0)}</strong>
        </button>
      )}
      <Overlay open={cartOpen} onClose={() => setCartOpen(false)} title="Keranjang Anda" className="cart-overlay">
        <Cart cart={cart.data || []} error={cart.error} loading={cart.loading} compact onClose={() => setCartOpen(false)} />
      </Overlay>
    </div>
  );
}
function Cart({ cart, error, loading, compact = false, onClose }: { cart: CartItem[]; error?: string; loading?: boolean; compact?: boolean; onClose?: () => void }) {
  const { me, api, changed, notify } = useApp(),
    [busy, setBusy] = useState("");
  async function quantity(p: CartItem, n: number) {
    if (busy || loading) return;
    setBusy(p.id);
    try {
      await api("/api/cart", "PUT", { product_id: p.id, quantity: n });
      changed();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (loading && !cart.length) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const invalid = cart.some((p) => p.quantity > p.stock);
  return (
    <>
      <ErrorBox message={error} />
      {cart.length ? (
        <>
          <div className="cart-items">
            {cart.map((p) => (
              <div className="cart-item" key={p.id}>
                {!compact &&
                  (p.photo_ids[0] ? (
                    <img className="cart-photo" src={image(p.photo_ids[0])} alt={p.name} />
                  ) : (
                    <span className="cart-photo placeholder">
                      <Icon name="box" />
                    </span>
                  ))}
                <div className="cart-item-name">
                  <strong>{p.name}</strong>
                  <small>
                    {money(p.price)} / {p.unit}
                  </small>
                  {p.quantity > p.stock && <small className="danger-text">{`Tersisa ${p.stock}. Kurangi jumlah.`}</small>}
                </div>
                <div className="cart-controls">
                  <div className="quantity">
                    <button type="button" disabled={!!busy || loading} aria-label={"Kurangi " + p.name} onClick={() => quantity(p, p.quantity - 1)}>
                      <Icon name="minus" size={14} />
                    </button>
                    <span>{p.quantity}</span>
                    <button
                      type="button"
                      disabled={!!busy || loading || p.quantity >= Math.min(p.stock, 999)}
                      aria-label={"Tambah " + p.name}
                      onClick={() => quantity(p, p.quantity + 1)}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                  <strong>{money(p.price * p.quantity)}</strong>
                </div>
                {
                  <button className="text-button danger-text" disabled={!!busy || loading} onClick={() => quantity(p, 0)}>
                    Hapus barang
                  </button>
                }
              </div>
            ))}
          </div>
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(cart.reduce((s, p) => s + p.price * p.quantity, 0))}</strong>
            </div>
            <p>Ongkir ditambahkan saat checkout.</p>
            {busy || loading ? (
              <p role="status">Aktualisasi keranjang…</p>
            ) : invalid ? (
              <p className="danger-text">Sesuaikan barang yang tidak tersedia sebelum melanjutkan.</p>
            ) : (
              <Link className="button primary full" href="/checkout" onClick={onClose}>
                Lanjut ke checkout
                <Icon name="arrow" size={17} />
              </Link>
            )}
            {compact && (
              <Link href="/keranjang" className="button secondary full" onClick={onClose}>
                Lihat keranjang
              </Link>
            )}
            <small>Stok ditahan setelah checkout.</small>
          </div>
        </>
      ) : (
        <div className="cart-empty">
          <Icon name="bag" size={36} />
          <h3>Masih kosong</h3>
          <p>Tambahkan barang yang Anda perlukan dari katalog.</p>
          <Link href={me.user ? "/" : "/masuk"} className="button secondary" onClick={onClose}>
            {me.user ? "Pilih barang" : "Masuk untuk berbelanja"}
          </Link>
        </div>
      )}
      <div className="cart-foot">
        <Icon name="clock" size={17} />
        <span>Setelah checkout, unggah bukti pembayaran dalam 1 jam.</span>
      </div>
    </>
  );
}
export function Checkout() {
  const { api, changed } = useApp(),
    router = useRouter(),
    cart = useData<CartItem[]>("/api/cart"),
    settings = useData<Settings>("/api/settings"),
    profile = useData<DeliveryProfile>("/api/profile");
  const [checkoutError, setCheckoutError] = useState("");
  const [itemsOpen, setItemsOpen] = useState(false);
  useEffect(() => {
    const query = matchMedia("(min-width: 850px)");
    const sync = () => setItemsOpen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [draft, setDraft] = useState({ recipient: "", phone: "", address: "" });
  const [location, setLocation] = useState<Coordinates>({ latitude: null, longitude: null });
  const edited = useRef(new Set<string>());
  const hydrated = useRef(false);
  useEffect(() => {
    if (!profile.data || hydrated.current) return;
    hydrated.current = true;
    const p = profile.data;
    setDraft((current) => ({
      recipient: edited.current.has("recipient") ? current.recipient : p.full_name,
      phone: edited.current.has("phone") ? current.phone : p.whatsapp,
      address: edited.current.has("address") ? current.address : p.address,
    }));
    if (!edited.current.has("location")) setLocation({ latitude: p.latitude, longitude: p.longitude });
  }, [profile.data]);
  const quoteKey = JSON.stringify([location.latitude, location.longitude, settings.data]);
  const [estimate, setEstimate] = useState<{ key: string; quote?: ShippingQuote; error?: string } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (location.latitude == null || location.longitude == null || !settings.data) return;
    const timer = setTimeout(() => {
      api<ShippingQuote>("/api/shipping/quote", "POST", location)
        .then((quote) => {
          if (active) setEstimate({ key: quoteKey, quote });
        })
        .catch((error) => {
          if (active) setEstimate({ key: quoteKey, error: error.message });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, quoteKey, quoteAttempt]);
  const quote = estimate?.key === quoteKey ? estimate.quote : undefined;
  const quoteError = estimate?.key === quoteKey ? estimate.error : undefined;
  const [method, setMethod] = useState("bank"),
    key = useRef("");
  useEffect(() => {
    const existing = sessionStorage.getItem("kk_checkout_key");
    key.current = existing || crypto.randomUUID();
    sessionStorage.setItem("kk_checkout_key", key.current);
  }, []);
  const c = settings.data,
    bank = !!(c?.bank_name && c.bank_account && c.bank_holder),
    qris = !!c?.qris_id;
  useEffect(() => {
    if (!bank && qris) setMethod("qris");
  }, [bank, qris]);
  if (cart.loading || settings.loading) return <Loading />;
  if (cart.error || settings.error) return <ErrorBox message={cart.error || settings.error} />;
  if (!cart.data?.length)
    return (
      <Empty title="Keranjang masih kosong">
        <Link className="button primary" href="/">
          Pilih barang
        </Link>
      </Empty>
    );
  if ((c?.shipping_mode !== "dynamic" && c?.shipping_fee === null) || (!bank && !qris))
    return (
      <Empty title="Checkout belum tersedia">
        <p>Toko sedang menyiapkan ongkir dan metode pembayaran.</p>
        <Link href="/">Kembali ke katalog</Link>
      </Empty>
    );
  const subtotal = cart.data.reduce((s, p) => s + p.price * p.quantity, 0),
    total = quote ? subtotal + quote.shipping_fee : null;
  return (
    <>
      <Link className="back-link" href="/keranjang">
        Kembali ke keranjang
      </Link>
      <div className="page-heading">
        <div>
          <h1>Checkout</h1>
          <p>Periksa alamat dan jumlah sebelum membuat pesanan.</p>
        </div>
      </div>
      <ErrorBox message={checkoutError} />
      <ErrorBox message={profile.error ? "Profil belum dapat dimuat. Anda tetap dapat mengisi data pengiriman secara manual." : ""} />
      <div className="checkout-layout">
        <section>
          <ActionForm
            label="Buat pesanan"
            submitDisabled={!quote}
            onSubmit={async (f) => {
              if (!quote || total === null) return;
              setCheckoutError("");
              let order: { id: string };
              try {
                order = await api<{ id: string }>("/api/checkout", "POST", {
                  key: key.current,
                  recipient: f.get("recipient"),
                  phone: f.get("phone"),
                  address: f.get("address"),
                  latitude: location.latitude,
                  longitude: location.longitude,
                  payment_method: method,
                  expected_total: total,
                });
              } catch (error) {
                setCheckoutError((error as Error).message);
                if ((error as { status?: number }).status === 409) changed();
                return;
              }
              sessionStorage.removeItem("kk_checkout_key");
              changed();
              router.push("/pesanan/" + order.id);
            }}
          >
            <section className="form-section">
              <h2>Alamat pengiriman</h2>
              <div className="two-fields">
                <Field label="Nama lengkap">
                  <input
                    name="recipient"
                    value={draft.recipient}
                    onChange={(e) => {
                      edited.current.add("recipient");
                      setDraft({ ...draft, recipient: e.target.value });
                    }}
                    autoComplete="name"
                    maxLength={100}
                    required
                  />
                </Field>
                <Field label="Nomor WhatsApp" hint="Contoh: 081234567890.">
                  <input
                    name="phone"
                    value={draft.phone}
                    onChange={(e) => {
                      edited.current.add("phone");
                      setDraft({ ...draft, phone: e.target.value });
                    }}
                    type="tel"
                    autoComplete="tel"
                    minLength={8}
                    maxLength={25}
                    required
                  />
                </Field>
              </div>
              <Field label="Alamat lengkap" hint="Sertakan jalan, nomor rumah, kelurahan, kecamatan, kota, provinsi, dan kode pos.">
                <textarea
                  name="address"
                  value={draft.address}
                  onChange={(e) => {
                    edited.current.add("address");
                    setDraft({ ...draft, address: e.target.value });
                  }}
                  autoComplete="street-address"
                  rows={4}
                  minLength={15}
                  maxLength={1000}
                  required
                />
              </Field>
              <LocationMap
                value={location}
                center={{ latitude: c?.store_latitude ?? null, longitude: c?.store_longitude ?? null }}
                onChange={(value) => {
                  edited.current.add("location");
                  setLocation(value);
                }}
              />
              <p className="fine">Data pengiriman otomatis disimpan ke profil setelah pesanan berhasil dibuat.</p>
              <ErrorBox message={quoteError} />
              {quoteError && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEstimate(null);
                    setQuoteAttempt((n) => n + 1);
                    changed();
                  }}
                >
                  Hitung ulang ongkir
                </button>
              )}
            </section>
            <section className="form-section">
              <h2>Metode pembayaran</h2>
              <div className="payment-choices">
                {bank && (
                  <label className={method === "bank" ? "payment-choice selected" : "payment-choice"}>
                    <input type="radio" name="method" value="bank" checked={method === "bank"} onChange={() => setMethod("bank")} />
                    <span>
                      <strong>Transfer bank</strong>
                      <small>{c?.bank_name}</small>
                    </span>
                  </label>
                )}
                {qris && (
                  <label className={method === "qris" ? "payment-choice selected" : "payment-choice"}>
                    <input type="radio" name="method" value="qris" checked={method === "qris"} onChange={() => setMethod("qris")} />
                    <span>
                      <strong>QRIS</strong>
                      <small>Pindai kode setelah checkout</small>
                    </span>
                  </label>
                )}
              </div>
            </section>
            <div className="alert">
              <Icon name="clock" />
              <div>
                <strong>Bayar dan unggah bukti dalam 1 jam.</strong>
                <p>Pesanan tidak dapat diedit atau dibatalkan. Bukti hanya dapat diunggah sekali. Periksa kembali sebelum melanjutkan.</p>
              </div>
            </div>
          </ActionForm>
        </section>
        <aside className="receipt">
          <details className="checkout-items" open={itemsOpen} onToggle={(e) => setItemsOpen(e.currentTarget.open)}>
            <summary>Ringkasan barang ({cart.data.length})</summary>
            {cart.data.map((p) => (
              <div className="receipt-item" key={p.id}>
                <span>
                  {p.name}
                  <small>
                    {p.quantity} {p.unit} × {money(p.price)}
                  </small>
                </span>
                <strong>{money(p.price * p.quantity)}</strong>
              </div>
            ))}
          </details>
          <div className="receipt-lines">
            <div>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div>
              <span>{c?.shipping_mode === "dynamic" ? "Ongkir berdasarkan jarak" : "Ongkir tetap"}</span>
              <span>{quote ? money(quote.shipping_fee) : "Belum dihitung"}</span>
            </div>
            {quote?.mode === "dynamic" && (
              <div className="shipping-calculation">
                <span>
                  Jarak garis lurus dari toko: {quote.distance_km!.toLocaleString("id-ID", { maximumFractionDigits: 3 })} km
                  <br />
                  {quote.billable_km} km × {money(quote.rate_per_km!)} / km
                </span>
              </div>
            )}
            {!quote && (
              <p className="fine" role="status">
                {quoteError || (location.latitude == null || location.longitude == null ? "Pilih titik pengiriman untuk menghitung ongkir." : "Menghitung ongkir…")}
              </p>
            )}
            <div className="receipt-total">
              <span>Total pembayaran</span>
              <strong>{total === null ? "—" : money(total)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function CartPage() {
  const cart = useData<CartItem[]>("/api/cart");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Keranjang</h1>
          <p>Periksa barang dan jumlah sebelum checkout.</p>
        </div>
        <Link className="button secondary" href="/">
          Lanjut belanja
        </Link>
      </div>
      <section className="cart-page">
        <Cart cart={cart.data || []} error={cart.error} loading={cart.loading} />
      </section>
    </>
  );
}
