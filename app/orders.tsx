"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { money, date, statusLabel } from "../lib/types";
import type { Order, Settings, Status } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Empty, Field, ActionForm, image, StatusBadge, Pagination, CopyButton } from "./ui";
export function Orders({ seller = false }: { seller?: boolean }) {
  const [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    { data, error, loading } = useData<Order[]>(`/api/orders?status=${status}&page=${page}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{seller ? "Pesanan masuk" : "Pesanan saya"}</h1>
          <p>{seller ? "Periksa bukti pembayaran, lalu lanjutkan pengiriman." : "Pantau pembayaran dan pengiriman barang Anda."}</p>
        </div>
        <select
          aria-label="Filter status pesanan"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Semua status</option>
          {Object.entries(statusLabel).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title={status ? "Tidak ada pesanan dengan status ini" : "Belum ada pesanan"}>
          <p>{seller ? "Pesanan buyer akan muncul di sini." : "Mulai dengan memilih kebutuhan Anda dari katalog."}</p>
          {!seller && (
            <Link href="/" className="button primary">
              Lihat produk
            </Link>
          )}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Pesanan</th>
                {seller && <th>Buyer</th>}
                <th>Waktu pemesanan</th>
                <th>Total</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link className="order-link" href={(seller ? "/seller" : "") + "/pesanan/" + o.id}>
                      #{o.id.slice(0, 8).toUpperCase()}
                    </Link>
                    <small className="mobile-only">{date(o.created_at)}</small>
                  </td>
                  {seller && <td data-label="Buyer">{o.username}</td>}
                  <td className="desktop-date">{date(o.created_at)}</td>
                  <td data-label="Total">
                    <strong>{money(o.total)}</strong>
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    <Link className="detail-link" aria-label={"Lihat pesanan " + o.id.slice(0, 8)} href={(seller ? "/seller" : "") + "/pesanan/" + o.id}>
                      Lihat <Icon name="arrow" size={16} />
                    </Link>
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
export function OrderDetail({ id }: { id: string }) {
  const { me, api, changed, notify } = useApp(),
    { data: o, error, loading } = useData<Order>("/api/orders/" + id);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(""),
    [now, setNow] = useState(Date.now()),
    [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const seller = me.user?.role === "seller";
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const overdue = !!o && o.status === "pending" && now >= o.expires_at;
  useEffect(() => {
    if (overdue) {
      const timer = setTimeout(changed, 1500);
      return () => clearTimeout(timer);
    }
  }, [overdue, changed]);
  if (loading && !o) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!o) return null;
  const payment = JSON.parse(o.payment_snapshot) as Settings,
    remaining = Math.max(0, Math.ceil((o.expires_at - now) / 1000));
  return (
    <>
      <Link className="back-link" href={seller ? "/seller" : "/pesanan"}>
        Kembali ke pesanan
      </Link>
      <div className="page-heading">
        <div>
          <h1>Pesanan #{o.id.slice(0, 8).toUpperCase()}</h1>
          <p>
            {date(o.created_at)}
            {seller ? ` · ${o.username}` : ""}
          </p>
        </div>
        <StatusBadge status={o.status} />
      </div>
      {seller && ["pending", "review", "approved", "shipped"].includes(o.status) && (
        <div className="next-action">
          <div>
            <strong>
              {o.status === "pending"
                ? "Menunggu pembayaran pembeli"
                : o.status === "review"
                  ? "Pembayaran perlu diperiksa"
                  : o.status === "approved"
                    ? "Pesanan siap dikirim"
                    : "Pengiriman sedang berlangsung"}
            </strong>
            <p>
              {o.status === "pending"
                ? "Tindakan tersedia setelah pembeli mengunggah bukti."
                : o.status === "review"
                  ? "Cocokkan bukti dengan mutasi rekening sebelum menyetujui."
                  : o.status === "approved"
                    ? "Tandai dikirim setelah barang diserahkan untuk pengiriman."
                    : "Tandai selesai setelah barang diterima pembeli."}
            </p>
          </div>
          {o.status !== "pending" && (
            <a className="button primary" href="#order-action">
              {o.status === "review" ? "Periksa pembayaran" : o.status === "approved" ? "Tandai dikirim" : "Tandai selesai"}
            </a>
          )}
        </div>
      )}
      <div className="order-layout">
        <section className="order-main">
          {o.status === "pending" && (
            <div className="deadline">
              <Icon name="clock" />
              <div>
                <strong>
                  {remaining
                    ? `Sisa waktu ${Math.floor(remaining / 3600)}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`
                    : "Waktu pembayaran habis"}
                </strong>
                <p>Unggah bukti sebelum {date(o.expires_at)}.</p>
              </div>
            </div>
          )}
          {o.status === "expired" && (
            <div className="alert">
              <p>Waktu pembayaran habis. Stok sudah dilepas. Buat pesanan baru untuk melanjutkan.</p>
            </div>
          )}
          {o.status === "rejected" && (
            <div className="alert error">
              <div>
                <strong>Pesanan ditolak</strong>
                <p>{o.reason}</p>
                <p>Keputusan final. Anda perlu membuat pesanan baru.</p>
              </div>
            </div>
          )}
          {o.status === "review" && (
            <div className="alert">
              <div>
                <strong>Bukti pembayaran sudah diterima.</strong>
                <p>{seller ? "Periksa bukti dan total sebelum mengambil keputusan final." : "Menunggu seller memeriksa pembayaran Anda. Bukti dan pesanan tidak dapat diubah."}</p>
              </div>
            </div>
          )}
          <section className="detail-section">
            <h2>Barang pesanan</h2>
            {o.items?.map((i) => (
              <div className="receipt-item" key={i.id}>
                <span>
                  <strong>{i.name}</strong>
                  <small>
                    {i.quantity} {i.unit} × {money(i.price)}
                  </small>
                </span>
                <strong>{money(i.quantity * i.price)}</strong>
              </div>
            ))}
            <div className="receipt-lines">
              <div>
                <span>Subtotal</span>
                <span>{money(o.subtotal)}</span>
              </div>
              <div>
                <span>Ongkir</span>
                <span>{money(o.shipping_fee)}</span>
              </div>
              <div className="receipt-total">
                <span>Total</span>
                <strong>{money(o.total)}</strong>
              </div>
            </div>
          </section>
          <section className="detail-section">
            <h2>Alamat pengiriman</h2>
            <strong>{o.recipient}</strong>
            <p>{o.phone}</p>
            <p className="preserve">{o.address}</p>
          </section>
          {(o.status === "pending" || o.proof_id) && (
            <section className="detail-section">
              <h2>{o.payment_method === "bank" ? "Transfer bank" : "Pembayaran QRIS"}</h2>
              {o.payment_method === "bank" ? (
                <dl className="payment-details">
                  <div>
                    <dt>Bank</dt>
                    <dd>{payment.bank_name}</dd>
                  </div>
                  <div>
                    <dt>Nomor rekening</dt>
                    <dd className="account-number">
                      {payment.bank_account}
                      <CopyButton value={payment.bank_account} label="Nomor rekening" />
                    </dd>
                  </div>
                  <div>
                    <dt>Atas nama</dt>
                    <dd>{payment.bank_holder}</dd>
                  </div>
                  <div>
                    <dt>Nominal</dt>
                    <dd>
                      <strong>{money(o.total)}</strong>
                    </dd>
                  </div>
                </dl>
              ) : (
                <>
                  <img className="qris-image" src={image(payment.qris_id!)} alt="Kode QRIS untuk pembayaran" />
                  <p>
                    Bayar tepat <strong>{money(o.total)}</strong>.
                  </p>
                </>
              )}
              {o.proof_id ? (
                <div className="proof">
                  <h3>Bukti pembayaran</h3>
                  <a href={image(o.proof_id)} target="_blank" rel="noreferrer">
                    <img src={image(o.proof_id)} alt="Bukti pembayaran yang diunggah buyer" />
                  </a>
                  <small>Klik gambar untuk melihat ukuran penuh.</small>
                </div>
              ) : !seller && o.status === "pending" && remaining > 0 ? (
                <div className="upload-section">
                  <h3>Unggah bukti pembayaran</h3>
                  <p className="muted">JPEG, PNG, atau WebP. Maksimal 1,5 MB. Hanya sekali unggah.</p>
                  <input
                    aria-label="Bukti pembayaran"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      setUploadError("");
                      const f = e.target.files?.[0];
                      if (f) {
                        if (f.size > 1500000) {
                          setUploadError("Gambar maksimal 1,5 MB.");
                          e.target.value = "";
                          setFile(null);
                        } else setFile(f);
                      }
                    }}
                  />
                  {preview && <img className="upload-preview" src={preview} alt="Pratinjau bukti yang akan diunggah" />}
                  <ErrorBox message={uploadError} />
                  <button
                    className="button primary"
                    disabled={!file || uploading}
                    onClick={async () => {
                      if (!file || !window.confirm("Bukti tidak dapat diganti setelah diunggah. Unggah bukti ini?")) return;
                      setUploading(true);
                      setUploadError("");
                      try {
                        await api("/api/orders/" + o.id + "/proof", "POST", file);
                        setFile(null);
                        changed();
                        notify("Bukti diterima. Menunggu pemeriksaan seller.");
                      } catch (e) {
                        setUploadError((e as Error).message);
                      } finally {
                        setUploading(false);
                      }
                    }}
                  >
                    {uploading ? "Mengunggah…" : "Unggah bukti pembayaran"}
                  </button>
                </div>
              ) : null}
            </section>
          )}
          {seller && o.status === "review" && (
            <section className="decision-panel" id="order-action">
              <h2>Keputusan pembayaran</h2>
              <p>Periksa mutasi rekening Anda sebelum mengambil keputusan final.</p>
              <div className="button-row">
                <button className={"button " + (decision === "approved" ? "primary" : "secondary")} onClick={() => setDecision("approved")}>
                  Setujui pembayaran
                </button>
                <button className={"button " + (decision === "rejected" ? "danger" : "secondary")} onClick={() => setDecision("rejected")}>
                  Tolak pesanan
                </button>
              </div>
              {decision && (
                <ActionForm
                  key={decision}
                  label={decision === "approved" ? "Konfirmasi persetujuan" : "Konfirmasi penolakan"}
                  onSubmit={async (f) => {
                    if (!window.confirm("Keputusan ini final dan tidak dapat diubah. Lanjutkan?")) return;
                    await api("/api/orders/" + o.id + "/decision", "POST", { status: decision, reason: f.get("reason") });
                    setDecision(null);
                    changed();
                    notify("Keputusan disimpan.");
                  }}
                >
                  <Field label={decision === "rejected" ? "Alasan penolakan" : "Catatan persetujuan (opsional)"}>
                    <textarea name="reason" maxLength={1000} required={decision === "rejected"} rows={3} />
                  </Field>
                </ActionForm>
              )}
            </section>
          )}
          {seller && o.status === "approved" && (
            <section className="detail-section" id="order-action">
              <h2>Siap dikirim</h2>
              <ActionForm
                label="Tandai dikirim"
                onSubmit={async (f) => {
                  if (!window.confirm("Tandai pesanan ini sudah dikirim?")) return;
                  await api("/api/orders/" + o.id + "/ship", "POST", { courier: f.get("courier") });
                  changed();
                  notify("Pesanan ditandai dikirim.");
                }}
              >
                <Field label="Nama kurir">
                  <input name="courier" maxLength={80} required />
                </Field>
                <p>Konfirmasi setelah barang diserahkan untuk pengiriman.</p>
              </ActionForm>
            </section>
          )}
          {(o.status === "shipped" || o.status === "completed") && (
            <section className="detail-section" id="order-action">
              <h2>Informasi pengiriman</h2>
              {o.courier ? (
                <dl className="payment-details">
                  <div>
                    <dt>Nama kurir</dt>
                    <dd>{o.courier}</dd>
                  </div>
                </dl>
              ) : (
                <p>Pesanan sudah dikirim.</p>
              )}
              {seller && o.status === "shipped" && (
                <ActionForm
                  label="Tandai selesai"
                  onSubmit={async () => {
                    if (!window.confirm("Tandai pesanan ini selesai?")) return;
                    await api("/api/orders/" + o.id + "/complete", "POST", {});
                    changed();
                    notify("Pesanan selesai.");
                  }}
                >
                  <p>Pastikan pengiriman sudah selesai sebelum menutup pesanan.</p>
                </ActionForm>
              )}
            </section>
          )}
        </section>
        <aside className="timeline">
          <h2>Riwayat pesanan</h2>
          <ol>
            {o.events?.map((e) => (
              <li key={e.id}>
                <span className="timeline-dot" />
                <strong>{statusLabel[e.status]}</strong>
                <small>{date(e.created_at)}</small>
                {e.note && <p className="preserve">{e.note}</p>}
              </li>
            ))}
          </ol>
          <p className="fine">Isi pesanan dan bukti pembayaran terkunci. Keputusan pembayaran bersifat final.</p>
          {!seller && ["expired", "rejected", "completed"].includes(o.status) && (
            <Link className="button secondary full" href="/">
              Kembali ke katalog
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}
