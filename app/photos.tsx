"use client";
import React, { useEffect, useRef, useState } from "react";
import { ErrorBox, Field, Overlay, image, useApp } from "./ui";

export function ProductPhotos({
  initial,
  onChange,
  onBusy,
  saved,
}: {
  initial: string[];
  onChange: (ids: string[]) => void;
  onBusy: (busy: boolean) => void;
  saved: React.RefObject<boolean>;
}) {
  const { api } = useApp();
  const [ids, setIds] = useState(initial),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState<{ name: string; status: string; error?: string }[]>([]),
    [error, setError] = useState("");
  const current = useRef(initial),
    uploaded = useRef(new Set<string>()),
    mounted = useRef(true),
    apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const id of uploaded.current) if (!saved.current || !current.current.includes(id)) void apiRef.current("/api/attachments/" + id, "DELETE").catch(() => {});
    };
  }, [saved]);
  function update(next: string[]) {
    current.current = next;
    setIds(next);
    onChange(next);
  }
  function move(index: number, delta: number) {
    const next = [...current.current];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    update(next);
  }
  return (
    <section className="photo-editor" aria-label="Foto barang">
      <div className="section-heading">
        <h3>Foto barang</h3>
        <span>{ids.length}/5 foto</span>
      </div>
      <p className="fine">Foto pertama menjadi sampul. JPEG, PNG, atau WebP; maksimal 1,5 MB per foto.</p>
      <ol className="photo-list">
        {ids.map((id, index) => (
          <li key={id}>
            <img src={image(id)} alt={`Foto barang ${index + 1}`} />
            <strong>{index === 0 ? "Sampul" : `Foto ${index + 1}`}</strong>
            <div className="photo-controls">
              <button type="button" className="text-button" disabled={busy || index === 0} aria-label={`Pindahkan foto ${index + 1} ke kiri`} onClick={() => move(index, -1)}>
                Kiri
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy || index === ids.length - 1}
                aria-label={`Pindahkan foto ${index + 1} ke kanan`}
                onClick={() => move(index, 1)}
              >
                Kanan
              </button>
              <button
                type="button"
                className="text-button danger-text"
                disabled={busy}
                aria-label={`Hapus foto ${index + 1}`}
                onClick={() => {
                  update(current.current.filter((p) => p !== id));
                  if (uploaded.current.has(id)) void api("/api/attachments/" + id, "DELETE").catch(() => {});
                }}
              >
                Hapus
              </button>
            </div>
          </li>
        ))}
      </ol>
      <Field label="Tambah foto">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy || ids.length === 5}
          onChange={async (e) => {
            const selected = Array.from(e.currentTarget.files || []);
            e.currentTarget.value = "";
            setError("");
            if (selected.length + current.current.length > 5) {
              setError("Maksimal 5 foto per barang. Pilih lebih sedikit file.");
              return;
            }
            const rows = selected.map((f) => ({ name: f.name, status: "Menunggu", error: undefined as string | undefined }));
            setFiles([...rows]);
            setBusy(true);
            onBusy(true);
            try {
              for (let index = 0; index < selected.length; index++) {
                const file = selected[index];
                rows[index].status = "Mengunggah";
                if (mounted.current) setFiles(rows.map((r) => ({ ...r })));
                try {
                  if (file.size > 1500000) throw new Error("Gambar maksimal 1,5 MB.");
                  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Gunakan JPEG, PNG, atau WebP.");
                  const result = await api<{ id: string }>("/api/attachments?kind=product", "POST", file);
                  uploaded.current.add(result.id);
                  if (!mounted.current) {
                    void apiRef.current("/api/attachments/" + result.id, "DELETE").catch(() => {});
                    break;
                  }
                  update([...current.current, result.id]);
                  rows[index].status = "Terunggah";
                } catch (err) {
                  rows[index].status = "Gagal";
                  rows[index].error = (err as Error).message;
                }
                if (mounted.current) setFiles(rows.map((r) => ({ ...r })));
              }
            } finally {
              if (mounted.current) {
                setBusy(false);
                onBusy(false);
              }
            }
          }}
        />
      </Field>
      <ErrorBox message={error} />
      <ul className="upload-status" aria-live="polite">
        {files.map((f, index) => (
          <li key={index}>
            <span>{f.name}</span>
            <small className={f.error ? "danger-text" : ""}>{f.error || f.status}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductGallery({ name, photos, onClose }: { name: string; photos: string[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);
  return (
    <Overlay open onClose={onClose} title={name} className="gallery-overlay">
      <div
        className="gallery"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          }
        }}
      >
        <img className="gallery-main" src={image(photos[index])} alt={`${name}, foto ${index + 1}`} />
        {photos.length > 1 && (
          <>
            <div className="gallery-navigation">
              <button className="button secondary" onClick={() => go(-1)}>
                Sebelumnya
              </button>
              <span aria-live="polite">
                {index + 1} / {photos.length}
              </span>
              <button className="button secondary" onClick={() => go(1)}>
                Berikutnya
              </button>
            </div>
            <div className="gallery-thumbnails">
              {photos.map((id, i) => (
                <button key={id} className={i === index ? "selected" : ""} aria-label={`Lihat foto ${i + 1}`} aria-pressed={i === index} onClick={() => setIndex(i)}>
                  <img src={image(id)} alt="" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
