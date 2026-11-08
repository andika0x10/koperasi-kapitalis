"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Settings, Session } from "../lib/types";
import { date } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Field, ActionForm, PhotoUpload } from "./ui";
export function AuthPage({ register }: { register: boolean }) {
  const { api, refresh, me, notify } = useApp(),
    router = useRouter();
  useEffect(() => {
    if (me.user) router.replace(me.user.must_change_password ? "/pengaturan" : me.user.role === "seller" ? "/seller" : "/");
  }, [me.user, router]);
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <span className="intro-line" />
        <h1>{register ? "Mulai dari kebutuhan Anda." : "Selamat datang kembali."}</h1>
        <p>{register ? "Satu akun untuk memesan barang, mengunggah bukti pembayaran, dan mengikuti pengiriman." : "Keranjang, pesanan, dan kabar pengiriman Anda ada di sini."}</p>
        <div className="auth-note">
          <Icon name="bag" size={28} />
          <span>
            Belanja kebutuhan sehari-hari.
            <br />
            Bayar lewat transfer atau QRIS.
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <h2>{register ? "Buat akun buyer" : "Masuk ke akun"}</h2>
        <p className="muted">Cukup username dan password. Tanpa email.</p>
        <ActionForm
          key={register ? "register" : "login"}
          label={register ? "Buat akun" : "Masuk"}
          onSubmit={async (f) => {
            if (register && f.get("password") !== f.get("confirm")) throw new Error("Konfirmasi password belum sama.");
            await api(register ? "/api/register" : "/api/login", "POST", { username: f.get("username"), password: f.get("password") });
            await refresh();
            if (register) notify("Akun berhasil dibuat. Selamat berbelanja.");
          }}
        >
          <Field label="Username" hint="3–32 huruf kecil, angka, atau garis bawah.">
            <input name="username" autoComplete="username" pattern="[a-zA-Z0-9_]{3,32}" minLength={3} maxLength={32} required autoCapitalize="none" spellCheck={false} />
          </Field>
          <Field label="Password" hint={register ? "Gunakan 12–128 karakter." : undefined}>
            <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={12} maxLength={128} required />
          </Field>
          {register && (
            <Field label="Ulangi password">
              <input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </Field>
          )}
        </ActionForm>
        <p className="auth-switch">
          {register ? "Sudah punya akun?" : "Belum punya akun?"} <Link href={register ? "/masuk" : "/daftar"}>{register ? "Masuk" : "Daftar sebagai buyer"}</Link>
        </p>
        {!register && <p className="fine">Lupa password? Minta seller mereset password akun Anda.</p>}
      </section>
    </div>
  );
}
export function AccountSettings() {
  const { me, api, changed, refresh, notify } = useApp(),
    router = useRouter(),
    sessions = useData<Session[]>("/api/sessions");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pengaturan akun</h1>
          <p>Kelola password dan perangkat yang memiliki akses.</p>
        </div>
        <span className="account-chip">{me.user?.username}</span>
      </div>
      {!!me.user?.must_change_password && (
        <div className="alert">
          <p>Anda memakai password sementara. Ganti password sebelum melanjutkan.</p>
        </div>
      )}
      <div className="settings-layout">
        <section className="detail-section">
          <h2>Ganti password</h2>
          <p className="muted">Perangkat lain akan otomatis keluar setelah password diganti.</p>
          <ActionForm
            label="Ganti password"
            onSubmit={async (f) => {
              if (f.get("password") !== f.get("confirm")) throw new Error("Konfirmasi password belum sama.");
              await api("/api/password", "POST", { current: f.get("current"), password: f.get("password") });
              await refresh();
              changed();
              notify("Password diganti. Sesi perangkat lain telah dicabut.");
            }}
          >
            <Field label="Password saat ini">
              <input name="current" type="password" autoComplete="current-password" required maxLength={128} />
            </Field>
            <Field label="Password baru" hint="12–128 karakter. Gunakan password yang belum dipakai di tempat lain.">
              <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </Field>
            <Field label="Ulangi password baru">
              <input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
            </Field>
          </ActionForm>
        </section>
        <section className="detail-section">
          <h2>Sesi perangkat</h2>
          <ErrorBox message={sessions.error} />
          {sessions.loading ? (
            <Loading />
          ) : (
            sessions.data?.map((s) => (
              <div className="session" key={s.id}>
                <div>
                  <strong>
                    {deviceName(s.device)} {s.current && <span className="role-tag">Perangkat ini</span>}
                  </strong>
                  <small>Aktif {date(s.last_seen)}</small>
                  <small>Masuk {date(s.created_at)}</small>
                </div>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("/api/sessions/revoke", "POST", { id: s.id });
                      if (s.current) {
                        await refresh();
                        router.push("/masuk");
                      }
                      changed();
                      notify("Sesi dicabut.");
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Cabut sesi
                </button>
              </div>
            ))
          )}
          <button
            className="button secondary"
            onClick={async () => {
              if (!window.confirm("Keluar dari semua perangkat, termasuk perangkat ini?")) return;
              try {
                await api("/api/sessions/revoke", "POST", { all: true });
                await refresh();
                router.push("/masuk");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            Keluar dari semua perangkat
          </button>
        </section>
      </div>
      {me.user?.role === "seller" && !me.user.must_change_password && <StoreSettings />}
    </>
  );
}
function deviceName(ua: string) {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Perangkat";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} di ${os}`;
}
function StoreSettings() {
  const { api, changed, notify } = useApp(),
    { data, error, loading } = useData<Settings>("/api/settings"),
    [qris, setQris] = useState<string | null>(null);
  useEffect(() => {
    if (data) setQris(data.qris_id);
  }, [data]);
  if (loading) return <Loading />;
  if (!data) return <ErrorBox message={error} />;
  return (
    <section className="store-settings detail-section">
      <h2>Pengaturan toko</h2>
      <p className="muted">Checkout aktif setelah ongkir dan minimal satu metode pembayaran lengkap.</p>
      <ActionForm
        key={JSON.stringify(data)}
        label="Simpan pengaturan toko"
        onSubmit={async (f) => {
          await api("/api/settings", "PUT", {
            shipping_fee: Number(f.get("shipping_fee")),
            bank_name: f.get("bank_name"),
            bank_account: f.get("bank_account"),
            bank_holder: f.get("bank_holder"),
            qris_id: qris,
          });
          changed();
          notify("Pengaturan toko disimpan.");
        }}
      >
        <Field label="Ongkir tetap (Rp)" hint="Masukkan 0 untuk gratis ongkir.">
          <input name="shipping_fee" type="number" min={0} max={10000000} step={1} defaultValue={data.shipping_fee ?? ""} required />
        </Field>
        <div className="two-fields">
          <Field label="Nama bank">
            <input name="bank_name" maxLength={80} defaultValue={data.bank_name} />
          </Field>
          <Field label="Nomor rekening">
            <input name="bank_account" maxLength={80} defaultValue={data.bank_account} />
          </Field>
        </div>
        <Field label="Nama pemilik rekening">
          <input name="bank_holder" maxLength={120} defaultValue={data.bank_holder} />
        </Field>
        <p className="fine">Lengkapi ketiga kolom rekening untuk mengaktifkan transfer bank, atau kosongkan semuanya.</p>
        <PhotoUpload kind="qris" value={qris} onChange={setQris} label="Gambar QRIS statis" />
        <p className="fine">Perubahan hanya berlaku untuk pesanan baru. Pesanan lama menyimpan instruksi pembayaran saat checkout.</p>
      </ActionForm>
    </section>
  );
}
