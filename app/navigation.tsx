"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useApp, useData, Icon, Overlay } from "./ui";
import type { CartItem } from "../lib/types";
export function Navigation({ path, logout }: { path: string; logout: () => Promise<void> }) {
  const { me } = useApp(),
    seller = me.user?.role === "seller";
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
    const query = matchMedia("(min-width: 850px)");
    const change = () => {
      if (query.matches) setMobile(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const links = seller
    ? [
        ["/seller", "Pesanan"],
        ["/seller/produk", "Produk"],
        ["/seller/users", "Pengguna"],
        ["/seller/laporan", "Laporan"],
      ]
    : [["/", "Produk"], ["/keranjang", "Keranjang"], ...(me.user ? [["/pesanan", "Pesanan saya"]] : [])];
  const nav = (
    <nav className="primary-navigation" aria-label="Navigasi utama">
      {links.map(([href, label]) => {
        const active = path === href || (href === "/seller" && path.startsWith("/seller/pesanan/")) || (href === "/pesanan" && path.startsWith("/pesanan/"));
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
        <small>{seller ? "Seller" : "Buyer"}</small>
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
  return (
    <header className="header">
      <div className="header-inner">
        <Link href={seller ? "/seller" : "/"} className="wordmark">
          Koperasi{" "}
          <strong>
            Kapitalis<span>.</span>
          </strong>
        </Link>
        <div className="desktop-navigation">{nav}</div>
        <div className="header-actions">
          {!seller && (
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
          <button className="menu-toggle icon-button" aria-label="Buka menu navigasi" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      <Overlay open={mobile} onClose={() => setMobile(false)} title="Menu" className="navigation-overlay">
        <div id="mobile-menu">
          {nav}
          <div className="mobile-account">{accountLinks}</div>
        </div>
      </Overlay>
    </header>
  );
}
