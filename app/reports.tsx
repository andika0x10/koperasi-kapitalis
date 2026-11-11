"use client";
import React, { useState } from "react";
import Link from "next/link";
import { money, date, roleLabel, statusLabel } from "../lib/types";
import type { SalesReportData } from "../lib/types";
import { useData, ErrorBox, Loading, Empty, Pagination, StatusBadge, Field } from "./ui";
function todayWib() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
export function SalesReport() {
  const [today] = useState(todayWib),
    [period, setPeriod] = useState("month"),
    [from, setFrom] = useState(() => today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [page, setPage] = useState(0);
  const valid = !!from && !!to && from <= to;
  const { data, error, loading } = useData<SalesReportData>(valid ? `/api/reports/sales?from=${from}&to=${to}&page=${page}` : null);
  const maximumDaily = data?.daily.reduce((maximum, day) => Math.max(maximum, day.total), 1) || 1;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Statistik toko</h1>
          <p>Pembayaran terverifikasi berdasarkan tanggal persetujuan dalam WIB.</p>
        </div>
      </div>
      <div className="report-filters">
        <Field label="Periode">
          <select
            value={period}
            onChange={(e) => {
              const value = e.target.value;
              setPeriod(value);
              setPage(0);
              if (value !== "custom") {
                setFrom(value === "today" ? today : today.slice(0, 7) + "-01");
                setTo(today);
              }
            }}
          >
            <option value="today">Hari ini</option>
            <option value="month">Bulan berjalan</option>
            <option value="custom">Rentang tanggal</option>
          </select>
        </Field>
        {period === "custom" && (
          <>
            <Field label="Tanggal mulai">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(0);
                }}
              />
            </Field>
            <Field label="Tanggal akhir">
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(0);
                }}
              />
            </Field>
          </>
        )}
      </div>
      {!valid ? (
        <ErrorBox message="Pilih rentang tanggal yang valid." />
      ) : error ? (
        <ErrorBox message={error} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <>
          <section className="operations-section">
            <div className="section-heading">
              <h2>Operasional saat ini</h2>
              <span>Tidak mengikuti filter tanggal</span>
            </div>
            <div className="operations-grid">
              <div>
                <h3>Pesanan</h3>
                <dl className="operational-counts">
                  {Object.entries(statusLabel).map(([status, label]) => (
                    <div key={status}>
                      <dt>{label}</dt>
                      <dd>{data.operations.orders.find((o) => o.status === status)?.count || 0}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3>Persediaan</h3>
                <dl className="operational-counts">
                  <div>
                    <dt>Barang habis</dt>
                    <dd>{data.operations.out_of_stock.length}</dd>
                  </div>
                  <div>
                    <dt>Stok menipis (1–5)</dt>
                    <dd>{data.operations.low_stock.length}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Lihat barang yang perlu diisi</summary>
                  <ul>
                    {[...data.operations.out_of_stock, ...data.operations.low_stock].map((p) => (
                      <li key={p.id}>
                        <Link href="/kelola/produk">{p.name}</Link>
                        <small>
                          {p.stock} {p.unit}
                        </small>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <div>
                <h3>Akun</h3>
                <dl className="operational-counts">
                  {Object.entries(roleLabel).map(([role, label]) => (
                    <div key={role}>
                      <dt>{label}</dt>
                      <dd>{data.operations.accounts.filter((a) => a.role === role).reduce((n, a) => n + a.count, 0)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="fine">Termasuk akun menunggu aktivasi atau password baru.</p>
              </div>
            </div>
          </section>
          <div className="section-heading sales-heading">
            <h2>Penjualan</h2>
            <span>
              {from} sampai {to}, WIB
            </span>
          </div>
          <dl className="report-summary">
            {[
              ["Pembayaran terverifikasi", money(data.summary.total)],
              ["Penjualan barang", money(data.summary.subtotal)],
              ["Ongkir", money(data.summary.shipping_fee)],
              ["Pesanan", data.summary.orders],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={String(value).length > 16 ? "long-amount" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          {!data.summary.orders ? (
            <Empty title="Belum ada penjualan pada periode ini">
              <p>Pembayaran yang disetujui akan muncul di sini. Coba periode lain.</p>
            </Empty>
          ) : (
            <>
              <div className="report-sections">
                <section className="detail-section">
                  <h2>Penjualan harian</h2>
                  <div className="daily-trend">
                    {data.daily.map((row) => (
                      <div className="daily-row" key={row.day}>
                        <span>
                          {row.day}
                          <small>{row.orders} pesanan</small>
                        </span>
                        <div className="daily-bar" aria-hidden="true">
                          <span style={{ width: `${Math.max(2, (row.total / maximumDaily) * 100)}%` }} />
                        </div>
                        <strong>{money(row.total)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="detail-section">
                  <h2>Produk terlaris</h2>
                  {data.products.map((p) => (
                    <div className="receipt-item" key={p.product_id + p.name + p.unit}>
                      <span>
                        {p.name}
                        <small>
                          {p.quantity} {p.unit}
                        </small>
                      </span>
                      <strong>{money(p.subtotal)}</strong>
                    </div>
                  ))}
                </section>
              </div>
              <section className="detail-section">
                <h2>Transaksi</h2>
                <div className="table-wrap">
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Pesanan</th>
                        <th>Pembayaran disetujui</th>
                        <th>Status</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link className="order-link" href={"/kelola/pesanan/" + o.id}>
                              {o.id.slice(0, 8)}
                            </Link>
                            <small>{o.recipient}</small>
                          </td>
                          <td data-label="Disetujui">{date(o.decided_at!)}</td>
                          <td>
                            <StatusBadge status={o.status} />
                          </td>
                          <td data-label="Total">{money(o.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} setPage={setPage} hasNext={(page + 1) * 30 < data.summary.orders} />
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
