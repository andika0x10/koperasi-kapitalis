"use client";
import React, { useState, useRef } from "react";
import { money } from "../lib/types";
import type { Product } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Empty, Field, ActionForm, image, Overlay } from "./ui";
import { ProductPhotos } from "./photos";
import { DeleteDialog } from "./users";
export function ManageProducts() {
  const { api, changed, notify } = useApp(),
    { data, error, loading } = useData<{ products: Product[] }>("/api/products?all=1"),
    [edit, setEdit] = useState<Product | "new" | null>(null),
    [q, setQ] = useState(""),
    [deleting, setDeleting] = useState<Product | null>(null);
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
                <th>Foto</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="table-product">
                      {p.photo_ids[0] ? (
                        <img src={image(p.photo_ids[0])} alt="" />
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
                  <td data-label="Foto">{p.photo_ids.length}/5</td>
                  <td>
                    <div className="button-row">
                      <button className="text-button" onClick={() => setEdit(p)}>
                        Edit
                      </button>
                      <button className="text-button danger-text" onClick={() => setDeleting(p)}>
                        Hapus permanen
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
      {deleting && (
        <DeleteDialog
          name={deleting.name}
          kind="barang"
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await api("/api/products/" + deleting.id, "DELETE", { revision: deleting.revision });
            changed();
            notify("Barang dihapus permanen.");
          }}
        />
      )}
      {edit && <ProductEditor product={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
function ProductEditor({ product, onClose }: { product: Product | "new"; onClose: () => void }) {
  const { api, changed, notify } = useApp(),
    p = product === "new" ? null : product,
    [photos, setPhotos] = useState(p?.photo_ids || []),
    [uploadBusy, setUploadBusy] = useState(false);
  const saved = useRef(false);
  return (
    <Overlay open onClose={onClose} title={p ? "Edit produk" : "Tambah produk"} className="product-overlay">
      <ActionForm
        disabled={uploadBusy}
        label={p ? "Simpan perubahan" : "Tambah produk"}
        onSubmit={async (f) => {
          await api(p ? "/api/products/" + p.id : "/api/products", p ? "PUT" : "POST", {
            name: f.get("name"),
            description: f.get("description"),
            category: f.get("category"),
            unit: f.get("unit"),
            price: Number(f.get("price")),
            stock: Number(f.get("stock")),
            photo_ids: photos,
            revision: p?.revision,
          });
          saved.current = true;
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
        <ProductPhotos initial={p?.photo_ids || []} onChange={setPhotos} onBusy={setUploadBusy} saved={saved} />
      </ActionForm>
    </Overlay>
  );
}
