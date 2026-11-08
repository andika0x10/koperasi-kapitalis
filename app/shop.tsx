"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Product, CartItem, Settings } from "../lib/types";
import { money } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Empty, Field, ActionForm, image } from "./ui";
export function Catalog() {
  const { me, api, notify, changed } = useApp(),
    router = useRouter();
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [busy, setBusy] = useState(""),
    [cartOpen, setCartOpen] = useState(false);
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
    <>
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
                    {p.photo_id ? (
                      <img src={image(p.photo_id)} alt={p.name} loading="lazy" />
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
                    {me.user?.role !== "seller" && (
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
              <p>{q || category ? "Coba kata lain atau tampilkan semua kategori." : "Seller belum menambahkan barang. Silakan kembali lagi nanti."}</p>
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
        {me.user?.role !== "seller" && (
          <aside className={"cart-panel " + (cartOpen ? "open" : "")}>
            <div className="cart-top">
              <h2>
                <Icon name="bag" />
                Keranjang Anda <span>{count}</span>
              </h2>
              <button className="mobile-only icon-button" aria-label="Tutup keranjang" onClick={() => setCartOpen(false)}>
                <Icon name="close" />
              </button>
            </div>
            <Cart cart={cart.data || []} error={cart.error} onClose={() => setCartOpen(false)} />
          </aside>
        )}
      </div>
      {me.user?.role !== "seller" && (
        <button className="mobile-cart" onClick={() => setCartOpen(true)}>
          <span>
            <Icon name="bag" />
            Keranjang ({count})
          </span>
          <strong>{money(cart.data?.reduce((s, p) => s + p.price * p.quantity, 0) || 0)}</strong>
        </button>
      )}
      {cartOpen && <button className="cart-backdrop" aria-label="Tutup keranjang" onClick={() => setCartOpen(false)} />}
    </>
  );
}
function Cart({ cart, error, onClose }: { cart: CartItem[]; error?: string; onClose: () => void }) {
  const { me, api, changed, notify } = useApp(),
    [busy, setBusy] = useState("");
  async function quantity(p: CartItem, n: number) {
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
  const invalid = cart.some((p) => p.archived || p.quantity > p.stock);
  return (
    <>
      <ErrorBox message={error} />
      {cart.length ? (
        <>
          <div className="cart-items">
            {cart.map((p) => (
              <div className="cart-item" key={p.id}>
                <div className="cart-item-name">
                  <strong>{p.name}</strong>
                  <small>
                    {money(p.price)} / {p.unit}
                  </small>
                  {(!!p.archived || p.quantity > p.stock) && <small className="danger-text">{p.archived ? "Tidak tersedia" : `Tersisa ${p.stock}. Kurangi jumlah.`}</small>}
                </div>
                <div className="cart-controls">
                  <div className="quantity">
                    <button type="button" disabled={busy === p.id} aria-label={"Kurangi " + p.name} onClick={() => quantity(p, p.quantity - 1)}>
                      <Icon name="minus" size={14} />
                    </button>
                    <span>{p.quantity}</span>
                    <button
                      type="button"
                      disabled={busy === p.id || p.quantity >= p.stock || !!p.archived}
                      aria-label={"Tambah " + p.name}
                      onClick={() => quantity(p, p.quantity + 1)}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                  <strong>{money(p.price * p.quantity)}</strong>
                </div>
                {!!p.archived && (
                  <button className="text-button danger-text" onClick={() => quantity(p, 0)}>
                    Hapus barang
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(cart.reduce((s, p) => s + p.price * p.quantity, 0))}</strong>
            </div>
            <p>Ongkir ditambahkan saat checkout.</p>
            {invalid ? (
              <p className="danger-text">Sesuaikan barang yang tidak tersedia sebelum melanjutkan.</p>
            ) : (
              <Link className="button primary full" href="/checkout" onClick={onClose}>
                Lanjut ke checkout
                <Icon name="arrow" size={17} />
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
          {!me.user && (
            <Link href="/masuk" className="button secondary" onClick={onClose}>
              Masuk untuk berbelanja
            </Link>
          )}
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
    settings = useData<Settings>("/api/settings");
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
  if (c?.shipping_fee === null || (!bank && !qris))
    return (
      <Empty title="Checkout belum tersedia">
        <p>Seller sedang menyiapkan ongkir dan metode pembayaran.</p>
        <Link href="/">Kembali ke katalog</Link>
      </Empty>
    );
  const subtotal = cart.data.reduce((s, p) => s + p.price * p.quantity, 0),
    total = subtotal + (c?.shipping_fee || 0);
  return (
    <>
      <Link className="back-link" href="/">
        Kembali ke keranjang
      </Link>
      <div className="page-heading">
        <div>
          <h1>Checkout</h1>
          <p>Periksa alamat dan jumlah sebelum membuat pesanan.</p>
        </div>
      </div>
      <div className="checkout-layout">
        <section>
          <ActionForm
            label="Buat pesanan"
            onSubmit={async (f) => {
              const order = await api<{ id: string }>("/api/checkout", "POST", {
                key: key.current,
                recipient: f.get("recipient"),
                phone: f.get("phone"),
                address: f.get("address"),
                payment_method: method,
                expected_total: total,
              });
              sessionStorage.removeItem("kk_checkout_key");
              changed();
              router.push("/pesanan/" + order.id);
            }}
          >
            <section className="form-section">
              <h2>Alamat pengiriman</h2>
              <div className="two-fields">
                <Field label="Nama penerima">
                  <input name="recipient" autoComplete="name" maxLength={100} required />
                </Field>
                <Field label="Nomor HP">
                  <input name="phone" type="tel" autoComplete="tel" minLength={8} maxLength={25} required />
                </Field>
              </div>
              <Field label="Alamat lengkap" hint="Sertakan jalan, nomor rumah, kelurahan, kecamatan, kota, provinsi, dan kode pos.">
                <textarea name="address" autoComplete="street-address" rows={4} minLength={15} maxLength={1000} required />
              </Field>
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
          <h2>Ringkasan pesanan</h2>
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
          <div className="receipt-lines">
            <div>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div>
              <span>Ongkir tetap</span>
              <span>{money(c?.shipping_fee || 0)}</span>
            </div>
            <div className="receipt-total">
              <span>Total pembayaran</span>
              <strong>{money(total)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
