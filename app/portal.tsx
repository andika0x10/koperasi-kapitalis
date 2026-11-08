"use client";
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "../lib/types";
import { Context, Icon, Loading, ErrorBox, Empty } from "./ui";
import { Catalog, Checkout, CartPage } from "./shop";
import { Orders, OrderDetail } from "./orders";
import { AuthPage, AccountSettings } from "./account";
import { ManageProducts, Users } from "./seller";
import { Navigation } from "./navigation";
import { AuditLogs } from "./audit-logs";
import { SalesReport } from "./reports";
export default function Portal() {
  const [me, setMe] = useState<{ user: User | null; csrf: string | null }>({ user: null, csrf: null }),
    [ready, setReady] = useState(false),
    [bootError, setBootError] = useState(""),
    [notice, setNotice] = useState(""),
    [noticeTarget, setNoticeTarget] = useState<HTMLDialogElement | null>(null),
    [version, setVersion] = useState(0);
  const path = usePathname(),
    router = useRouter();
  const refresh = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Aplikasi belum dapat terhubung. Muat ulang halaman.");
    setMe(await response.json());
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setBootError(e.message))
      .finally(() => setReady(true));
  }, [refresh]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    if (!notice) {
      setNoticeTarget(null);
      return;
    }
    // Native dialogs occupy the top layer; keep notifications inside the active
    // dialog so errors stay visible and their close button remains interactive.
    const sync = () => setNoticeTarget([...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1) || null);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [notice]);
  const api = useCallback(
    async <T,>(url: string, method = "GET", data?: unknown): Promise<T> => {
      const file = data instanceof File;
      const res = await fetch(url, {
        method,
        cache: "no-store",
        headers: {
          ...(method !== "GET" ? { "x-csrf-token": me.csrf || "" } : {}),
          ...(data !== undefined ? { "content-type": file ? (data as File).type : "application/json" } : {}),
        },
        body: data === undefined ? undefined : file ? (data as File) : JSON.stringify(data),
      });
      const payload = await res.json().catch(() => ({ error: "Respons tidak valid. Coba lagi." }));
      if (!res.ok) {
        if (res.status === 401 && !["/api/login", "/api/register"].includes(url)) {
          setMe({ user: null, csrf: null });
          router.push("/masuk");
        }
        throw Object.assign(new Error((payload as { error?: string }).error || "Permintaan gagal."), { status: res.status });
      }
      return payload as T;
    },
    [me.csrf, router]
  );
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (ready && me.user?.must_change_password && path !== "/pengaturan") router.replace("/pengaturan");
  }, [ready, me.user, path, router]);
  async function logout() {
    try {
      await api("/api/logout", "POST");
      setMe({ user: null, csrf: null });
      changed();
      router.push("/");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const notification = notice ? (
    <div className="toast" role="status">
      <span>{notice}</span>
      <button aria-label="Tutup pemberitahuan" onClick={() => setNotice("")}>
        <Icon name="close" size={17} />
      </button>
    </div>
  ) : null;
  return (
    <Context.Provider value={{ me, api, refresh, notify: setNotice, version, changed }}>
      <div className="site">
        <a className="skip-link" href="#main">
          Lewati ke konten
        </a>
        <Navigation path={path} logout={logout} />
        <main className="main" id="main">
          {!ready ? <Loading /> : bootError ? <ErrorBox message={bootError} /> : <Screen path={path} />}
        </main>
        <footer className="footer">
          <span>Koperasi Kapitalis</span>
          <span>Kebutuhan sehari-hari, dalam satu tempat.</span>
          <span>Harga dalam Rupiah</span>
        </footer>
        {noticeTarget ? createPortal(notification, noticeTarget) : notification}
      </div>
    </Context.Provider>
  );
}
function Screen({ path }: { path: string }) {
  const me = React.useContext(Context).me;
  if (path === "/masuk" || path === "/daftar") return <AuthPage register={path === "/daftar"} />;
  if (path === "/") return <Catalog />;
  if (!me.user)
    return (
      <Empty title="Masuk untuk melanjutkan">
        <p>Lihat pesanan dan kelola akun setelah masuk.</p>
        <Link href="/masuk" className="button primary">
          Masuk
        </Link>
      </Empty>
    );
  if (me.user.must_change_password || path === "/pengaturan") return <AccountSettings />;
  if (path.startsWith("/seller") && me.user.role !== "seller")
    return (
      <Empty title="Halaman tidak tersedia">
        <Link href="/">Kembali ke produk</Link>
      </Empty>
    );
  if (path === "/seller") return <Orders seller />;
  if (path === "/seller/produk") return <ManageProducts />;
  if (path === "/seller/laporan") return <SalesReport />;
  if (path === "/keranjang" && me.user.role === "buyer") return <CartPage />;
  if (path === "/seller/log-aktivitas") return <AuditLogs />;
  if (path === "/seller/users") return <Users />;
  if (path === "/checkout" && me.user.role === "buyer") return <Checkout />;
  if (path === "/pesanan") return <Orders />;
  const match = path.match(/^\/(?:seller\/)?pesanan\/([^/]+)$/);
  if (match) return <OrderDetail key={match[1]} id={match[1]} />;
  return (
    <Empty title="Halaman tidak ditemukan">
      <Link href="/">Kembali ke produk</Link>
    </Empty>
  );
}
