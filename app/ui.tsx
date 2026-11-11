"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import type { User, Status } from "../lib/types";
import { statusLabel } from "../lib/types";
export type App = {
  me: { user: User | null; csrf: string | null };
  api: <T = any>(url: string, method?: string, data?: unknown) => Promise<T>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  version: number;
  changed: () => void;
};
export const Context = createContext<App>(null!);
export const useApp = () => useContext(Context);
export const image = (id: string) => `/api/attachments/${id}`;
export function useData<T>(url: string | null) {
  const { api, version } = useApp();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    api<T>(url)
      .then((d) => {
        if (active) setData(d);
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
  }, [url, version, api]);
  return { data, error, loading };
}
export function Icon({ name, size = 22 }: { name: "bag" | "search" | "plus" | "minus" | "box" | "close" | "arrow" | "clock" | "user" | "menu"; size?: number }) {
  const paths = {
    bag: (
      <>
        <path d="M5 7h14l1 13H4L5 7Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    box: (
      <>
        <path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" />
        <path d="m3 7 9 4 9-4M12 11v10M7 5l10 4" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
export function ErrorBox({ message }: { message?: string }) {
  return message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> Memuat…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="box" size={32} />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<any>, { id, "aria-describedby": hint ? id + "-hint" : undefined }) : children}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={"status " + status}>
      <span />
      {statusLabel[status]}
    </span>
  );
}
export function ActionForm({
  children,
  onSubmit,
  label = "Simpan",
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className={"form " + className}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError("");
        setBusy(true);
        try {
          await onSubmit(data);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || disabled}>
        {children}
        <ErrorBox message={error} />
        <button className="button primary" disabled={busy}>
          {busy ? "Memproses…" : label}
        </button>
      </fieldset>
    </form>
  );
}
export function Pagination({ page, setPage, hasNext }: { page: number; setPage: (n: number) => void; hasNext: boolean }) {
  return page > 0 || hasNext ? (
    <div className="pagination">
      <button className="button secondary small" disabled={!page} onClick={() => setPage(page - 1)}>
        Sebelumnya
      </button>
      <span>Halaman {page + 1}</span>
      <button className="button secondary small" disabled={!hasNext} onClick={() => setPage(page + 1)}>
        Berikutnya
      </button>
    </div>
  ) : null;
}
export function PhotoUpload({ kind, value, onChange, label }: { kind: "product" | "qris"; value: string | null; onChange: (id: string | null) => void; label: string }) {
  const { api } = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="field">
      <label>{label}</label>
      {value && <img className="edit-photo" src={image(value)} alt={label} />}
      <input
        aria-label={label}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={async (e) => {
          const input = e.currentTarget,
            file = input.files?.[0];
          if (!file) return;
          setError("");
          if (file.size > 1500000) {
            setError("Gambar maksimal 1,5 MB.");
            input.value = "";
            return;
          }
          setBusy(true);
          try {
            const result = await api<{ id: string }>("/api/attachments?kind=" + kind, "POST", file);
            onChange(result.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
            input.value = "";
          }
        }}
      />
      <small>{busy ? "Mengunggah gambar…" : "JPEG, PNG, atau WebP. Maksimal 1,5 MB."}</small>
      {value && (
        <button className="text-button fit" type="button" onClick={() => onChange(null)}>
          Lepas gambar
        </button>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

export function Overlay({ open, onClose, title, children, className = "" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={"overlay " + className}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div className="overlay-content">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={"Tutup " + title} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { notify } = useApp();
  return (
    <button
      type="button"
      className="text-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          notify(label + " disalin.");
        } catch {
          notify("Belum bisa menyalin. Pilih dan salin teks secara manual.");
        }
      }}
    >
      Salin {label.toLowerCase()}
    </button>
  );
}
