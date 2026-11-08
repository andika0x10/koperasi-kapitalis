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
  const { api, notify, changed, me } = useApp();
  const [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [status, setStatus] = useState("active"),
    [page, setPage] = useState(0);
  const { data, error, loading } = useData<(User & { created_at: number; deleted_at: number | null })[]>(
    `/api/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}&page=${page}`
  );
  const [create, setCreate] = useState(false),
    [credential, setCredential] = useState<{ username: string; password: string } | null>(null),
    [busy, setBusy] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pengguna</h1>
          <p>Kelola akses buyer dan seller di koperasi.</p>
        </div>
        <button className="button primary" aria-expanded={create} onClick={() => setCreate(!create)}>
          {create ? "Tutup formulir" : "Tambah pengguna"}
        </button>
      </div>
      {create && (
        <section className="account-create detail-section">
          <h2>Tambah pengguna</h2>
          <ActionForm
            label="Buat akun"
            onSubmit={async (f) => {
              const result = await api<{ username: string; password: string }>("/api/users", "POST", { username: f.get("username"), role: f.get("role") });
              setCredential(result);
              setCreate(false);
              changed();
              notify("Akun dibuat. Sampaikan password sementara secara privat.");
            }}
          >
            <Field label="Username" hint="3–32 huruf, angka, atau garis bawah.">
              <input name="username" required pattern="[a-zA-Z0-9_]{3,32}" minLength={3} maxLength={32} autoCapitalize="none" autoComplete="off" />
            </Field>
            <Field label="Role" hint="Role tidak dapat diubah setelah akun dibuat.">
              <select name="role" defaultValue="buyer">
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </select>
            </Field>
            <p className="muted">Password sementara dibuat otomatis. Pemilik wajib menggantinya saat masuk pertama kali.</p>
          </ActionForm>
        </section>
      )}
      <div className="management-filters">
        <Field label="Cari username">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Cari username…"
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Semua role</option>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
          </select>
        </Field>
        <Field label="Status akun">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="active">Aktif</option>
            <option value="deleted">Terhapus</option>
            <option value="all">Semua status</option>
          </select>
        </Field>
      </div>
      <ErrorBox message={error} />
      {credential && (
        <div className="credential alert" role="status">
          <div>
            <strong>Password sementara untuk {credential.username}</strong>
            <code>{credential.password}</code>
            <p>Ditampilkan sekali. Sampaikan secara privat; pemilik wajib mengganti password saat masuk.</p>
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
          <p>Ubah pencarian atau filter, atau tambahkan pengguna baru.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Terdaftar</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td data-label="Username">
                    <strong>{u.username}</strong>
                    {u.id === me.user?.id && <small>Akun Anda</small>}
                    {!!u.must_change_password && !u.deleted_at && <small>Wajib ganti password</small>}
                  </td>
                  <td data-label="Role">{u.role === "seller" ? "Seller" : "Buyer"}</td>
                  <td data-label="Status">
                    {u.deleted_at ? (
                      <>
                        <span>Akun terhapus</span>
                        <small>{date(u.deleted_at)}</small>
                      </>
                    ) : (
                      "Aktif"
                    )}
                  </td>
                  <td data-label="Terdaftar">{date(u.created_at)}</td>
                  <td data-label="Tindakan">
                    {!u.deleted_at && u.id !== me.user?.id ? (
                      <div className="row-actions">
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={async () => {
                            if (!window.confirm(`Reset password ${u.username}? Semua sesi akun ini akan dicabut.`)) return;
                            setBusy(u.id);
                            try {
                              const result = await api<{ password: string }>("/api/users/" + u.id + "/reset", "POST", {});
                              setCredential({ username: u.username, password: result.password });
                              changed();
                            } catch (e) {
                              notify((e as Error).message);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          className="text-button danger-text"
                          disabled={!!busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Hapus akun ${u.username} secara permanen? Akses dan semua sesi akan dicabut. Akun tidak dapat dipulihkan. Pesanan tetap diproses dan riwayat tersimpan.`
                              )
                            )
                              return;
                            setBusy(u.id);
                            try {
                              await api("/api/users/" + u.id, "DELETE");
                              changed();
                              notify("Akun dihapus. Semua sesinya telah dicabut.");
                            } catch (e) {
                              notify((e as Error).message);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Hapus akun
                        </button>
                      </div>
                    ) : (
                      <span className="muted">{u.deleted_at ? "Tidak dapat dipulihkan" : "Kelola di Pengaturan"}</span>
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
