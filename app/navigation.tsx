"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useApp, useData, Icon, Overlay } from "./ui";
import type { CartItem } from "../lib/types";
import { isOperator, roleLabel } from "../lib/types";
export function Navigation({ path, logout }: { path: string; logout: () => Promise<void> }) {
  const { me } = useApp(),
    operator = isOperator(me.user?.role);
  const [mobile, setMobile] = useState(false),
    [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const cart = useData<CartItem[]>(me.user?.role === "buyer" ? "/api/cart" : null);
  const count = cart.data?.reduce((sum, p) => sum + p.quantity, 0) || 0;
  useEffect(() => {
    setMobile(false);
    setAccount(false);
  }, [path, me.user?.id]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccount(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAccount(false);
        trigger.current?.focus();
      }
    };
    if (account) {
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", escape);
    }
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [account]);
  useEffect(() => {
    const query = matchMedia(operator ? "(min-width: 1150px)" : "(min-width: 850px)");
    const change = () => {
      if (query.matches) setMobile(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [operator]);
  const links = operator
    ? [
        ...(me.user?.role === "owner" ? [["/owner/statistik", "Statistik"]] : []),
        ["/kelola/pesanan", "Pesanan"],
        ["/kelola/produk", "Produk"],
        ...(me.user?.role === "staff" ? [["/kelola/pelanggan", "Pelanggan"]] : []),
        ...(me.user?.role === "owner"
          ? [
              ["/owner/pengguna", "Pengguna"],
              ["/owner/log-aktivitas", "Log aktivitas"],
            ]
          : []),
      ]
    : [
        ["/", "Produk"],
        ["/keranjang", "Keranjang"],
        ...(me.user
          ? [
              ["/pesanan", "Pesanan saya"],
              ["/statistik", "Statistik"],
            ]
          : []),
      ];
  const nav = (
    <nav className="primary-navigation" aria-label="Navigasi utama">
      {links.map(([href, label]) => {
        const active = path === href || (href === "/kelola/pesanan" && path.startsWith("/kelola/pesanan/")) || (href === "/pesanan" && path.startsWith("/pesanan/"));
        return (
          <Link key={href} href={href} className={"nav-link" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={() => setMobile(false)}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
  const accountLinks = me.user ? (
    <>
      <div className="account-identity">
        <strong>{me.user.username}</strong>
        <small>{roleLabel[me.user.role]}</small>
      </div>
      <Link
        className="nav-link"
        href="/pengaturan"
        onClick={() => {
          setMobile(false);
          setAccount(false);
        }}
      >
        Pengaturan
      </Link>
      <button
        className="nav-link"
        onClick={() => {
          setMobile(false);
          setAccount(false);
          void logout();
        }}
      >
        Keluar
      </button>
    </>
  ) : (
    <>
      <Link className="nav-link" href="/masuk" onClick={() => setMobile(false)}>
        Masuk
      </Link>
      <Link className="button primary" href="/daftar" onClick={() => setMobile(false)}>
        Daftar
      </Link>
    </>
  );
  const managementNavigation = (
    <div className="management-navigation">
      <p className="sidebar-identity">{me.user?.role === "owner" ? "Kelola toko" : "Operasional toko"}</p>
      {nav}
      <div className="sidebar-account" aria-label="Akun Anda">
        <div className="sidebar-account-identity">
          <span className="sidebar-avatar" aria-hidden="true" />
          <div>
            <strong>{me.user?.username}</strong>
            <small>{me.user ? roleLabel[me.user.role] : ""}</small>
          </div>
        </div>
        <Link className="sidebar-account-action" href="/pengaturan" aria-current={path === "/pengaturan" ? "page" : undefined} onClick={() => setMobile(false)}>
          <Icon name="settings" size={18} />
          <span>Pengaturan</span>
        </Link>
        <button
          className="sidebar-account-action"
          onClick={() => {
            setMobile(false);
            void logout();
          }}
        >
          <Icon name="logout" size={18} />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );
  return (
    <header className="header">
      <div className="header-inner">
        <Link href={me.user?.role === "owner" ? "/owner/statistik" : operator ? "/kelola/pesanan" : "/"} className="wordmark">
          Koperasi{" "}
          <strong>
            Kapitalis<span>.</span>
          </strong>
        </Link>
        <div className="desktop-navigation">{nav}</div>
        <div className="header-actions">
          {!operator && (
            <Link
              href="/keranjang"
              className="header-cart"
              aria-label={cart.error ? "Keranjang, jumlah belum tersedia" : `Keranjang, ${count} barang`}
              aria-current={path === "/keranjang" ? "page" : undefined}
            >
              <Icon name="bag" />
              <span>{cart.error ? "!" : count}</span>
            </Link>
          )}
          {!operator && (
            <div className="account-menu" ref={accountRef}>
              {me.user ? (
                <>
                  <button ref={trigger} className="account-trigger" aria-expanded={account} aria-controls="account-menu" onClick={() => setAccount(!account)}>
                    <Icon name="user" />
                    <span>{me.user.username}</span>
                  </button>
                  {account && (
                    <div id="account-menu" className="account-dropdown">
                      {accountLinks}
                    </div>
                  )}
                </>
              ) : (
                accountLinks
              )}
            </div>
          )}
          <button className="menu-toggle icon-button" aria-label="Buka menu navigasi" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      {operator && <aside className="management-sidebar">{managementNavigation}</aside>}
      <Overlay open={mobile} onClose={() => setMobile(false)} title="Menu" className="navigation-overlay">
        <div id="mobile-menu">
          {operator ? (
            managementNavigation
          ) : (
            <>
              {nav}
              <div className="mobile-account">{accountLinks}</div>
            </>
          )}
        </div>
      </Overlay>
    </header>
  );
}
