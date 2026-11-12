"use client";
import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Settings, Session, DeliveryProfile, Coordinates } from "../lib/types";
import { date, roleLabel } from "../lib/types";
import { useApp, useData, Icon, ErrorBox, Loading, Field, ActionForm, PhotoUpload } from "./ui";
import { LocationMap } from "./location-map";
export function AuthPage({ register }: { register: boolean }) {
  const { api, refresh, me, notify } = useApp(),
    router = useRouter();
  useEffect(() => {
    if (me.user) router.replace(me.user.role === "owner" ? "/owner/statistik" : me.user.role === "staff" ? "/kelola/pesanan" : "/");
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
        <h2>{register ? "Buat akun pelanggan" : "Masuk ke akun"}</h2>
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
          {register ? "Sudah punya akun?" : "Belum punya akun?"} <Link href={register ? "/masuk" : "/daftar"}>{register ? "Masuk" : "Daftar sebagai pelanggan"}</Link>
        </p>
        {!register && <p className="fine">Lupa password? Minta link reset password kepada staf (pelanggan) atau owner (staf). Link berlaku 1 jam.</p>}
      </section>
    </div>
  );
}
export function SetPassword() {
  const { api, refresh, notify } = useApp(),
    router = useRouter();
  const [token, setToken] = useState(""),
    [account, setAccount] = useState<{ username: string; expires_at: number } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const value = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (!value) {
      setError("Link tidak lengkap. Minta link baru kepada staf (pelanggan) atau owner (staf).");
      setLoading(false);
      return;
    }
    api<{ username: string; expires_at: number }>("/api/password-links/validate", "POST", { token: value })
      .then((result) => {
        if (active) setAccount(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <div className="auth-layout password-layout">
      <section className="auth-intro">
        <h1>Password Anda, akses Anda.</h1>
        <p>Tentukan password untuk mengaktifkan kembali akses akun. Link berlaku 1 jam dan hanya dapat digunakan sekali.</p>
      </section>
      <section className="auth-panel">
        <h2>Atur password</h2>
        {loading ? (
          <Loading />
        ) : error ? (
          <>
            <ErrorBox message={error} />
            <Link href="/masuk" className="button secondary">
              Kembali ke masuk
            </Link>
          </>
        ) : (
          account && (
            <>
              <p>
                Untuk akun <strong>{account.username}</strong>. Berlaku sampai {date(account.expires_at)}.
              </p>
              <ActionForm
                label="Simpan password"
                onSubmit={async (f) => {
                  if (f.get("password") !== f.get("confirm")) throw new Error("Konfirmasi password belum sama.");
                  await api("/api/password-links/complete", "POST", { token, password: f.get("password") });
                  history.replaceState(history.state, "", "/atur-password");
                  await refresh();
                  notify("Password disimpan. Silakan masuk.");
                  router.replace("/masuk");
                }}
              >
                <Field label="Password baru" hint="12–128 karakter.">
                  <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
                </Field>
                <Field label="Ulangi password baru">
                  <input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
                </Field>
              </ActionForm>
            </>
          )
        )}
      </section>
    </div>
  );
}
export function AccountSettings() {
  const { me, api, changed, refresh, notify } = useApp(),
    router = useRouter(),
    sessions = useData<Session[]>("/api/sessions");
  const [section, setSection] = useState("akun"),
    [dirty, setDirty] = useState(false),
    [passwordVersion, setPasswordVersion] = useState(0),
    [usernameVersion, setUsernameVersion] = useState(0);
  const navigationState = useRef({ section, dirty });
  navigationState.current = { section, dirty };
  const sections = [
    ["akun", "Akun"],
    ...(me.user?.role === "buyer" ? [["profil", "Profil pengiriman"]] : []),
    ["keamanan", "Keamanan"],
    ["perangkat", "Perangkat"],
    ...(me.user?.role === "owner" ? [["pengiriman", "Pengiriman"]] : []),
    ...(me.user?.role === "owner" ? [["pembayaran", "Pembayaran"]] : []),
  ];
  useEffect(() => {
    const sync = () => {
      const value = location.hash.slice(1);
      const next = sections.some(([id]) => id === value) ? value : "akun";
      const previous = navigationState.current;
      if (next !== previous.section && previous.dirty && !window.confirm("Perubahan belum disimpan. Pindah bagian?")) {
        history.replaceState(history.state, "", "#" + previous.section);
        return;
      }
      if (next !== previous.section) setDirty(false);
      setSection(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [me.user?.role]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a");
      if (link && link.href !== location.href && !window.confirm("Perubahan belum disimpan. Tinggalkan bagian ini?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  const active = section;
  const select = (value: string) => {
    if (dirty && !window.confirm("Perubahan belum disimpan. Pindah bagian?")) return;
    navigationState.current = { section: value, dirty: false };
    setDirty(false);
    setSection(value);
    location.hash = value;
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pengaturan</h1>
          <p>Kelola data akun, pengiriman, dan perangkat yang memiliki akses.</p>
        </div>
      </div>
      <div className="settings-shell">
        <aside className="settings-navigation">
          <div className="settings-desktop">
            {sections.map(([id, label]) => (
              <button key={id} className={"settings-link" + (active === id ? " active" : "")} aria-current={active === id ? "page" : undefined} onClick={() => select(id)}>
                {label}
              </button>
            ))}
          </div>
          <select className="settings-select" aria-label="Bagian pengaturan" value={active} onChange={(e) => select(e.target.value)}>
            {sections.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </aside>
        <div className="settings-content" onChange={() => setDirty(true)}>
          {active === "profil" && me.user?.role === "buyer" && <DeliverySettings saved={() => setDirty(false)} markDirty={() => setDirty(true)} />}
          {active === "akun" && (
            <section className="detail-section">
              <h2>Akun</h2>
              <dl className="payment-details">
                <div>
                  <dt>Username</dt>
                  <dd>{me.user?.username}</dd>
                </div>
                <div>
                  <dt>Peran</dt>
                  <dd>{me.user ? roleLabel[me.user.role] : ""}</dd>
                </div>
              </dl>
              <ActionForm
                key={usernameVersion}
                label="Simpan username"
                onSubmit={async (f) => {
                  await api("/api/username", "PUT", { username: f.get("username"), current: f.get("current") });
                  await refresh();
                  changed();
                  setDirty(false);
                  setUsernameVersion((v) => v + 1);
                  notify("Username disimpan. Sesi perangkat lain telah dicabut.");
                }}
              >
                <Field label="Username baru" hint="3–32 huruf, angka, atau garis bawah. Perangkat lain akan keluar setelah username berubah.">
                  <input
                    name="username"
                    defaultValue={me.user?.username}
                    pattern="[a-zA-Z0-9_]{3,32}"
                    minLength={3}
                    maxLength={32}
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Password saat ini">
                  <input name="current" type="password" autoComplete="current-password" required maxLength={128} />
                </Field>
              </ActionForm>
            </section>
          )}
          {active === "keamanan" && (
            <section className="detail-section">
              <h2>Ganti password</h2>
              <p className="muted">Perangkat lain akan otomatis keluar setelah password diganti.</p>
              <ActionForm
                key={passwordVersion}
                label="Ganti password"
                onSubmit={async (f) => {
                  if (f.get("password") !== f.get("confirm")) throw new Error("Konfirmasi password belum sama.");
                  await api("/api/password", "POST", { current: f.get("current"), password: f.get("password") });
                  await refresh();
                  changed();
                  setDirty(false);
                  setPasswordVersion((value) => value + 1);
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
          )}
          {active === "perangkat" && (
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
              <ActionForm
                label="Keluar dari semua perangkat"
                onSubmit={async (f) => {
                  if (!window.confirm("Keluar dari semua perangkat, termasuk perangkat ini?")) return;
                  await api("/api/sessions/revoke", "POST", { all: true, current: f.get("current") });
                  setDirty(false);
                  await refresh();
                  router.push("/masuk");
                }}
              >
                <Field label="Password saat ini" hint="Masukkan password untuk keluar dari semua perangkat, termasuk perangkat ini.">
                  <input name="current" type="password" autoComplete="current-password" required minLength={12} maxLength={128} />
                </Field>
              </ActionForm>
            </section>
          )}
          {(active === "pengiriman" || active === "pembayaran") && me.user?.role === "owner" && (
            <StoreSettings key={active} section={active} saved={() => setDirty(false)} markDirty={() => setDirty(true)} />
          )}
        </div>
      </div>
    </>
  );
}
function deviceName(ua: string) {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Perangkat";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} di ${os}`;
}
function DeliverySettings({ saved, markDirty }: { saved: () => void; markDirty: () => void }) {
  const { data, loading, error } = useData<DeliveryProfile>("/api/profile");
  if (loading) return <Loading />;
  if (!data) return <ErrorBox message={error} />;
  return <DeliveryProfileForm key={JSON.stringify(data)} data={data} saved={saved} markDirty={markDirty} />;
}
function DeliveryProfileForm({ data, saved, markDirty }: { data: DeliveryProfile; saved: () => void; markDirty: () => void }) {
  const { api, changed, notify } = useApp();
  const [location, setLocation] = useState<Coordinates>({ latitude: data.latitude, longitude: data.longitude });
  return (
    <section className="detail-section">
      <h2>Profil pengiriman</h2>
      <p className="muted">Data ini mengisi checkout Anda secara otomatis. Anda bisa melengkapinya sekarang atau saat membuat pesanan.</p>
      <ActionForm
        label="Simpan profil pengiriman"
        onSubmit={async (f) => {
          await api("/api/profile", "PUT", { full_name: f.get("full_name"), whatsapp: f.get("whatsapp"), address: f.get("address"), ...location });
          saved();
          changed();
          notify("Profil pengiriman disimpan.");
        }}
      >
        <Field label="Nama lengkap">
          <input name="full_name" autoComplete="name" maxLength={100} defaultValue={data.full_name} />
        </Field>
        <Field label="Nomor WhatsApp" hint="Contoh: 081234567890 atau +6281234567890.">
          <input name="whatsapp" type="tel" autoComplete="tel" maxLength={25} defaultValue={data.whatsapp} />
        </Field>
        <Field label="Alamat lengkap">
          <textarea name="address" autoComplete="street-address" maxLength={1000} rows={4} defaultValue={data.address} />
        </Field>
        <LocationMap
          value={location}
          onChange={(value) => {
            setLocation(value);
            markDirty();
          }}
        />
      </ActionForm>
    </section>
  );
}
function ShippingSettings({ data, saved, markDirty }: { data: Settings; saved: () => void; markDirty: () => void }) {
  const { api, changed, notify } = useApp();
  const [mode, setMode] = useState(data.shipping_mode || "fixed");
  const [shippingFee, setShippingFee] = useState(String(data.shipping_fee ?? ""));
  const [ratePerKm, setRatePerKm] = useState(String(data.rate_per_km ?? ""));
  const [maxDistanceKm, setMaxDistanceKm] = useState(String(data.max_distance_km ?? ""));
  const [location, setLocation] = useState<Coordinates>({ latitude: data.store_latitude, longitude: data.store_longitude });
  const number = (value: string) => (value === "" ? null : Number(value));
  return (
    <section className="store-settings detail-section">
      <h2>Pengiriman</h2>
      <p className="muted">Lengkapi titik toko dan tarif sebelum mengaktifkan ongkir berdasarkan jarak.</p>
      <ActionForm
        label="Simpan pengaturan pengiriman"
        onSubmit={async () => {
          await api("/api/settings", "PUT", {
            shipping_mode: mode,
            shipping_fee: number(shippingFee),
            store_latitude: location.latitude,
            store_longitude: location.longitude,
            rate_per_km: number(ratePerKm),
            max_distance_km: number(maxDistanceKm),
          });
          saved();
          changed();
          notify("Pengaturan pengiriman disimpan.");
        }}
      >
        <Field label="Perhitungan ongkir">
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Settings["shipping_mode"]);
              markDirty();
            }}
          >
            <option value="fixed">Ongkir tetap</option>
            <option value="dynamic">Ongkir berdasarkan jarak</option>
          </select>
        </Field>
        {mode === "fixed" ? (
          <Field label="Ongkir tetap (Rp)" hint="Masukkan 0 untuk gratis ongkir.">
            <input name="shipping_fee" type="number" min={0} max={10000000} step={1} value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} required />
          </Field>
        ) : (
          <>
            <LocationMap
              label="Titik toko"
              value={location}
              onChange={(value) => {
                setLocation(value);
                markDirty();
              }}
            />
            <div className="two-fields">
              <Field label="Tarif per km (Rp)">
                <input name="rate_per_km" type="number" min={0} max={10000000} step={1} value={ratePerKm} onChange={(e) => setRatePerKm(e.target.value)} required />
              </Field>
              <Field label="Batas jarak pengiriman (km)">
                <input name="max_distance_km" type="number" min={0.001} max={20050} step="any" value={maxDistanceKm} onChange={(e) => setMaxDistanceKm(e.target.value)} required />
              </Field>
            </div>
            <p className="fine">
              Jarak garis lurus dari toko dibulatkan ke atas ke km penuh untuk menghitung ongkir. Batas pengiriman diperiksa sebelum pembulatan. Tarif 0 berarti gratis ongkir.
            </p>
          </>
        )}
        <p className="fine">Perubahan hanya berlaku untuk pesanan baru.</p>
      </ActionForm>
    </section>
  );
}
function StoreSettings({ section, saved, markDirty }: { section: string; saved: () => void; markDirty: () => void }) {
  const { api, changed, notify } = useApp();
  const { data, error, loading } = useData<Settings>("/api/settings");
  const [qris, setQris] = useState<string | null>(null);
  useEffect(() => {
    if (data) setQris(data.qris_id);
  }, [data]);
  if (loading) return <Loading />;
  if (!data) return <ErrorBox message={error} />;
  if (section === "pengiriman") return <ShippingSettings key={JSON.stringify(data)} data={data} saved={saved} markDirty={markDirty} />;
  return (
    <section className="store-settings detail-section">
      <h2>Pembayaran</h2>
      <p className="muted">Lengkapi minimal satu metode pembayaran untuk menerima pesanan.</p>
      <ActionForm
        key={JSON.stringify(data)}
        label="Simpan pembayaran"
        onSubmit={async (f) => {
          await api("/api/settings", "PUT", { bank_name: f.get("bank_name"), bank_account: f.get("bank_account"), bank_holder: f.get("bank_holder"), qris_id: qris });
          saved();
          changed();
          notify("Pembayaran disimpan.");
        }}
      >
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
        <PhotoUpload
          kind="qris"
          value={qris}
          onChange={(id) => {
            setQris(id);
            markDirty();
          }}
          label="Gambar QRIS statis"
        />
        <p className="fine">Perubahan hanya berlaku untuk pesanan baru. Pesanan lama menyimpan instruksi pembayaran saat checkout.</p>
      </ActionForm>
    </section>
  );
}
