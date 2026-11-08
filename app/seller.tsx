"use client";
import React, { useState, useEffect, useRef } from "react";
import { money, date } from "../lib/types";
import type { User, Product } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Empty, Field, ActionForm, image, PhotoUpload, Pagination } from "./ui";
export function ManageProducts() {
  const { api, changed, notify } = useApp(),
    { data, error, loading } = useData<{ products: Product[] }>("/api/products?all=1"),
    [edit, setEdit] = useState<Product | "new" | null>(null),
    [q, setQ] = useState("");
  const products = data?.products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Kelola produk</h1>
          <p>Atur barang, harga, dan stok yang dapat dipesan.</p>
        </div>
        <button className="button primary" onClick={() => setEdit("new")}>
          <Icon name="plus" size={18} />
          Tambah produk
        </button>
      </div>
      <div className="search manage-search">
        <Icon name="search" size={20} />
        <input aria-label="Cari produk" placeholder="Cari nama barang…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : products.length ? (
        <div className="table-wrap">
          <table className="products-table">
            <thead>
              <tr>
                <th>Barang</th>
                <th>Harga</th>
                <th>Stok tersedia</th>
                <th>Status</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="table-product">
                      {p.photo_id ? (
                        <img src={image(p.photo_id)} alt="" />
                      ) : (
                        <span>
                          <Icon name="box" />
                        </span>
                      )}
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {p.category} / {p.unit}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Harga">{money(p.price)}</td>
                  <td data-label="Stok">
                    {p.stock} {p.unit}
                  </td>
                  <td>{p.archived ? <span className="status expired">Diarsipkan</span> : <span className="status approved">Aktif</span>}</td>
                  <td>
                    <div className="button-row">
                      <button className="text-button" onClick={() => setEdit(p)}>
                        Edit
                      </button>
                      <button
                        className="text-button muted"
                        onClick={async () => {
                          if (!window.confirm(p.archived ? "Aktifkan kembali produk ini?" : "Arsipkan produk ini dari katalog?")) return;
                          try {
                            await api("/api/products/" + p.id, "PUT", { ...p, archived: !p.archived });
                            changed();
                            notify(p.archived ? "Produk diaktifkan." : "Produk diarsipkan.");
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        {p.archived ? "Aktifkan" : "Arsipkan"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={q ? "Produk tidak ditemukan" : "Belum ada barang di katalog"}>
          <p>Mulai dengan menambahkan kebutuhan sehari-hari yang Anda jual.</p>
          <button className="button primary" onClick={() => setEdit("new")}>
            Tambah produk pertama
          </button>
        </Empty>
      )}
      {edit && <ProductEditor product={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
function ProductEditor({ product, onClose }: { product: Product | "new"; onClose: () => void }) {
  const { api, changed, notify } = useApp(),
    p = product === "new" ? null : product,
    [photo, setPhoto] = useState(p?.photo_id || null),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="product-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id="product-title">{p ? "Edit produk" : "Tambah produk"}</h2>
        <button type="button" className="icon-button" aria-label="Tutup formulir produk" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <ActionForm
        label={p ? "Simpan perubahan" : "Tambah produk"}
        onSubmit={async (f) => {
          await api(p ? "/api/products/" + p.id : "/api/products", p ? "PUT" : "POST", {
            name: f.get("name"),
            description: f.get("description"),
            category: f.get("category"),
            unit: f.get("unit"),
            price: Number(f.get("price")),
            stock: Number(f.get("stock")),
            photo_id: photo,
            revision: p?.revision,
            archived: !!p?.archived,
          });
          changed();
          notify(p ? "Produk diperbarui." : "Produk ditambahkan.");
          onClose();
        }}
      >
        <Field label="Nama barang">
          <input name="name" defaultValue={p?.name} maxLength={150} required autoFocus />
        </Field>
        <Field label="Deskripsi">
          <textarea name="description" rows={3} maxLength={3000} defaultValue={p?.description} />
        </Field>
        <div className="two-fields">
          <Field label="Kategori">
            <input name="category" defaultValue={p?.category} maxLength={60} required placeholder="Contoh: Bahan pokok" />
          </Field>
          <Field label="Satuan">
            <input name="unit" defaultValue={p?.unit} maxLength={40} required placeholder="Contoh: kemasan 1 kg" />
          </Field>
        </div>
        <div className="two-fields">
          <Field label="Harga (Rp)">
            <input name="price" type="number" min={1} max={100000000} step={1} defaultValue={p?.price} required />
          </Field>
          <Field label="Stok tersedia" hint="Di luar stok yang sedang ditahan pesanan.">
            <input name="stock" type="number" min={0} max={999999} step={1} defaultValue={p?.stock ?? 0} required />
          </Field>
        </div>
        <PhotoUpload kind="product" value={photo} onChange={setPhoto} label="Foto barang" />
      </ActionForm>
    </dialog>
  );
}
export function Users() {
  const { api, notify } = useApp(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    { data, error, loading } = useData<(User & { created_at: number })[]>(`/api/users?q=${encodeURIComponent(q)}&page=${page}`),
    [credential, setCredential] = useState<{ username: string; password: string } | null>(null),
    [busy, setBusy] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pengguna</h1>
          <p>Lihat akun terdaftar dan bantu buyer memulihkan akses.</p>
        </div>
      </div>
      <div className="search manage-search">
        <Icon name="search" size={20} />
        <input
          aria-label="Cari username"
          value={q}
          placeholder="Cari username…"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <ErrorBox message={error} />
      {credential && (
        <div className="credential alert">
          <div>
            <strong>Password sementara untuk {credential.username}</strong>
            <code>{credential.password}</code>
            <p>Salin dan sampaikan secara privat kepada pemilik akun. Password ini hanya ditampilkan sekarang. Semua sesi lamanya telah dicabut.</p>
            <button className="button secondary small" onClick={() => setCredential(null)}>
              Sudah disalin, tutup
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Pengguna tidak ditemukan">
          <p>Coba username lain.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Terdaftar</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {!!u.must_change_password && <small>Wajib ganti password</small>}
                  </td>
                  <td>{u.role === "seller" ? "Seller" : "Buyer"}</td>
                  <td>{date(u.created_at)}</td>
                  <td>
                    {u.role === "buyer" ? (
                      <button
                        className="text-button"
                        disabled={busy === u.id}
                        onClick={async () => {
                          if (!window.confirm(`Reset password ${u.username}? Semua sesinya akan dicabut.`)) return;
                          setBusy(u.id);
                          try {
                            const result = await api<{ password: string }>("/api/users/" + u.id + "/reset", "POST", {});
                            setCredential({ username: u.username, password: result.password });
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        {busy === u.id ? "Memproses…" : "Reset password"}
                      </button>
                    ) : (
                      <span className="muted">Akun utama</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} setPage={setPage} hasNext={data?.length === 30} />
    </>
  );
}
