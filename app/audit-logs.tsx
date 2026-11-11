"use client";
import React, { useState } from "react";
import { date, roleLabel } from "../lib/types";
import { auditLabels } from "../lib/audit-labels";
import { useData, Field, ErrorBox, Loading, Empty, Pagination } from "./ui";
type Entry = {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  target_id: string | null;
  target_type: string | null;
  outcome: string;
  details: string | null;
  created_at: number;
};
const fieldLabels: Record<string, string> = {
  username: "Username",
  role: "Role",
  deleted_at: "Dihapus pada",
  name: "Nama",
  description: "Deskripsi",
  category: "Kategori",
  unit: "Satuan",
  price: "Harga",
  stock: "Stok",
  photo_id: "Foto",
  photo_ids: "Foto barang",
  expires_at: "Berlaku sampai",
  archived: "Diarsipkan",
  shipping_fee: "Ongkir",
  bank_name: "Bank",
  bank_account: "Rekening",
  bank_holder: "Pemilik rekening",
  qris_id: "QRIS",
  quantity: "Jumlah",
  status: "Status",
  courier: "Kurir",
  total: "Total",
  payment_method: "Metode pembayaran",
  kind: "Jenis gambar",
  bytes: "Ukuran",
  all: "Semua sesi",
  count: "Jumlah sesi",
  code: "Kode respons",
};
function Values({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return <span>{value === null ? "—" : String(value)}</span>;
  return (
    <dl className="audit-values">
      {Object.entries(value).map(([key, v]) => (
        <div key={key}>
          <dt>{fieldLabels[key] || key}</dt>
          <dd>
            {key === "deleted_at" && typeof v === "number"
              ? date(v)
              : v === null
                ? "—"
                : key === "role" && typeof v === "string" && v in roleLabel
                  ? roleLabel[v as keyof typeof roleLabel]
                  : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Details({ entry }: { entry: Entry }) {
  if (!entry.details) return <p className="muted">Detail tidak tersedia untuk catatan ini.</p>;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(entry.details);
  } catch {
    return <p>Detail tidak tersedia.</p>;
  }
  return "before" in value || "after" in value ? (
    <div className="audit-diff">
      <div>
        <h3>Sebelum</h3>
        <Values value={value.before ?? null} />
      </div>
      <div>
        <h3>Sesudah</h3>
        <Values value={value.after ?? null} />
      </div>
    </div>
  ) : (
    <Values value={value} />
  );
}
export function AuditLogs() {
  const [actor, setActor] = useState(""),
    [action, setAction] = useState(""),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(0);
  const params = new URLSearchParams({ actor, action, q, page: String(page), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data, error, loading } = useData<Entry[]>("/api/audit-logs?" + params);
  const change = (setter: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(0);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Log aktivitas</h1>
          <p>Riwayat perubahan dan keamanan akun, disimpan selama 365 hari. Waktu ditampilkan dalam WIB.</p>
        </div>
      </div>
      <div className="management-filters audit-filters">
        <Field label="Pelaku">
          <input type="search" value={actor} onChange={change(setActor)} placeholder="Username atau ID pengguna" />
        </Field>
        <Field label="Tindakan">
          <select value={action} onChange={change(setAction)}>
            <option value="">Semua tindakan</option>
            {Object.entries(auditLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cari objek">
          <input type="search" value={q} onChange={change(setQ)} placeholder="ID objek atau detail perubahan" />
        </Field>
        <Field label="Dari tanggal">
          <input type="date" value={from} onChange={change(setFrom)} />
        </Field>
        <Field label="Sampai tanggal">
          <input type="date" value={to} min={from || undefined} onChange={change(setTo)} />
        </Field>
        <button
          className="button secondary"
          onClick={() => {
            setActor("");
            setAction("");
            setQ("");
            setFrom("");
            setTo("");
            setPage(0);
          }}
        >
          Bersihkan filter
        </button>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Belum ada aktivitas yang sesuai">
          <p>Ubah filter untuk melihat catatan lain. Aktivitas baru akan muncul di sini.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Pelaku</th>
                <th>Tindakan dan objek</th>
                <th>Hasil</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td data-label="Waktu">{date(e.created_at)}</td>
                  <td data-label="Pelaku">
                    <strong>{e.actor_username ?? "Tidak tersedia"}</strong>
                    {e.actor_id && <small>{e.actor_id}</small>}
                  </td>
                  <td data-label="Tindakan dan objek">
                    <strong>{auditLabels[e.action] || e.action}</strong>
                    <small>
                      {e.target_type
                        ? ({ user: "Pengguna", order: "Pesanan", product: "Produk", settings: "Pengaturan", cart: "Keranjang", attachment: "Gambar", request: "Permintaan" }[
                            e.target_type
                          ] || e.target_type) + ": "
                        : ""}
                      {e.target_id || "—"}
                    </small>
                    <details>
                      <summary>Lihat detail</summary>
                      <Details entry={e} />
                    </details>
                  </td>
                  <td data-label="Hasil">
                    <span className={e.outcome === "failure" ? "danger-text" : ""}>{e.outcome === "failure" ? "Gagal / ditolak" : "Berhasil"}</span>
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
