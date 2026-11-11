"use client";
import React, { useState } from "react";
import Link from "next/link";
import type { User, PasswordLink } from "../lib/types";
import { date, roleLabel } from "../lib/types";
import { ActionForm, CopyButton, Empty, ErrorBox, Field, Loading, Overlay, Pagination, useApp, useData } from "./ui";

export function DeleteDialog({ name, kind, onClose, onDelete }: { name: string; kind: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [orders, setOrders] = useState<{ id: string }[]>([]);
  return (
    <Overlay open onClose={onClose} title={`Hapus ${kind} permanen`} className="delete-overlay">
      <p>
        <strong>{name}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan. Riwayat transaksi dan audit tetap tersimpan.
      </p>
      <ActionForm
        label="Hapus permanen"
        className="danger-form"
        onSubmit={async () => {
          try {
            await onDelete();
            onClose();
          } catch (e) {
            setOrders((e as { orders?: { id: string }[] }).orders || []);
            throw e;
          }
        }}
      >
        {orders.length > 0 && (
          <div className="blocking-orders">
            <p>Pesanan yang perlu diselesaikan:</p>
            {orders.map((o) => (
              <Link key={o.id} href={"/kelola/pesanan/" + o.id}>
                Pesanan {o.id.slice(0, 8)}
              </Link>
            ))}
          </div>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Batal
        </button>
      </ActionForm>
    </Overlay>
  );
}

export function Users() {
  const { api, changed, notify } = useApp();
  const [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    [creating, setCreating] = useState<"staff" | "buyer" | null>(null),
    [link, setLink] = useState<PasswordLink | null>(null),
    [deleting, setDeleting] = useState<User | null>(null),
    [resetting, setResetting] = useState<User | null>(null);
  const { data, error, loading } = useData<(User & { created_at: number })[]>(`/api/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}&page=${page}`);
  const labels = { pending: "Menunggu aktivasi", active: "Aktif", reset_required: "Menunggu password baru" };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pengguna</h1>
          <p>Atur akses staf dan bantu pelanggan mengakses akunnya.</p>
        </div>
        <div className="button-row">
          <button className="button primary" onClick={() => setCreating("staff")}>
            Tambah staf
          </button>
          <button className="button secondary" onClick={() => setCreating("buyer")}>
            Tambah pelanggan
          </button>
        </div>
      </div>
      <div className="management-filters">
        <Field label="Cari username">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Cari pengguna…"
          />
        </Field>
        <Field label="Peran">
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Semua peran</option>
            <option value="staff">Staf</option>
            <option value="buyer">Pelanggan</option>
            <option value="owner">Owner</option>
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
            <option value="">Semua status</option>
            {Object.entries(labels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : data?.length ? (
        <>
          <div className="table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Peran</th>
                  <th>Status akun</th>
                  <th>Dibuat</th>
                  <th>Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Username">
                      <strong>{u.username}</strong>
                    </td>
                    <td data-label="Peran">{roleLabel[u.role]}</td>
                    <td data-label="Status akun">
                      <span className={"status " + (u.status === "active" ? "approved" : "pending")}>{labels[u.status]}</span>
                    </td>
                    <td data-label="Dibuat">{date(u.created_at)}</td>
                    <td data-label="Tindakan">
                      {u.role !== "owner" ? (
                        <div className="button-row">
                          <button className="text-button" onClick={() => setResetting(u)}>
                            {u.status === "pending" ? "Buat link aktivasi" : "Buat link reset"}
                          </button>
                          <button className="text-button danger-text" onClick={() => setDeleting(u)}>
                            Hapus permanen
                          </button>
                        </div>
                      ) : (
                        <small>Dikelola melalui pengaturan akun</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} setPage={setPage} hasNext={data.length === 30} />
        </>
      ) : (
        !error && (
          <Empty title="Pengguna tidak ditemukan">
            <p>Coba username atau filter lain.</p>
          </Empty>
        )
      )}
      {creating && (
        <Overlay open onClose={() => setCreating(null)} title={"Tambah " + roleLabel[creating].toLowerCase()}>
          <p>Pengguna menentukan password sendiri melalui link yang berlaku 1 jam.</p>
          <ActionForm
            label="Buat akun dan link aktivasi"
            onSubmit={async (f) => {
              const result = await api<PasswordLink>("/api/users", "POST", { username: f.get("username"), role: creating });
              setCreating(null);
              setLink(result);
              changed();
              notify("Akun dibuat. Bagikan link aktivasi.");
            }}
          >
            <Field label="Username" hint="3–32 huruf kecil, angka, atau garis bawah.">
              <input name="username" required autoFocus autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" />
            </Field>
          </ActionForm>
        </Overlay>
      )}
      {resetting && (
        <Overlay open onClose={() => setResetting(null)} title={resetting.status === "pending" ? "Buat link aktivasi" : "Buat link reset"}>
          <p>
            Buat link baru untuk <strong>{resetting.username}</strong>? Password lama, link sebelumnya, dan seluruh sesi langsung dinonaktifkan.
          </p>
          <ActionForm
            label="Buat link baru"
            onSubmit={async () => {
              const result = await api<PasswordLink>("/api/users/" + resetting.id + "/reset", "POST", {});
              setResetting(null);
              setLink(result);
              changed();
            }}
          >
            <p className="fine">Link berlaku 1 jam dan hanya dapat dipakai sekali.</p>
          </ActionForm>
        </Overlay>
      )}
      {link && (
        <Overlay open onClose={() => setLink(null)} title="Bagikan link password">
          <div className="password-link">
            <p>
              Untuk <strong>{link.username}</strong>
            </p>
            <p>Berlaku sampai {date(link.expires_at)}. Salin sebelum menutup dialog ini.</p>
            <Field label="Link aktivasi atau reset">
              <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <CopyButton value={link.url} label="Link" />
            <p className="fine">Hanya bagikan kepada pemilik akun. Link memberi akses untuk menentukan password.</p>
          </div>
        </Overlay>
      )}
      {deleting && (
        <DeleteDialog
          name={deleting.username}
          kind="akun"
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await api("/api/users/" + deleting.id, "DELETE");
            changed();
            notify("Akun dihapus permanen.");
          }}
        />
      )}
    </>
  );
}
