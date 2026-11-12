"use client";
import React, { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { Coordinates, PlaceResult } from "../lib/types";
import { mapTiles } from "../lib/map-config";
import { ErrorBox, useApp } from "./ui";

function validPoint(point?: Coordinates): point is { latitude: number; longitude: number } {
  return (
    typeof point?.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    typeof point?.longitude === "number" &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
  );
}

export function LocationMap({
  value,
  onChange,
  center,
  label = "Titik pengiriman",
}: {
  value: Coordinates;
  onChange?: (value: Coordinates) => void;
  center?: Coordinates;
  label?: string;
}) {
  const { api } = useApp();
  const searchId = React.useId();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [selectedPlace, setSelectedPlace] = useState("");
  const searchVersion = useRef(0);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const latest = useRef({ value, onChange, center });
  latest.current = { value, onChange, center };
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const search = async () => {
    const term = query.trim();
    if (term.length < 3) {
      setSearchError("Ketik minimal 3 karakter untuk mencari alamat.");
      return;
    }
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchError("");
    setResults(null);
    setSelectedPlace("");
    try {
      const found = await api<PlaceResult[]>(`/api/places?q=${encodeURIComponent(term)}`);
      if (alive.current && version === searchVersion.current) setResults(found);
    } catch (e) {
      if (alive.current && version === searchVersion.current) setSearchError((e as Error).message);
    } finally {
      if (alive.current && version === searchVersion.current) setSearching(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    setReady(false);
    import("leaflet")
      .then((L) => {
        if (cancelled || !host.current) return;
        const current = latest.current;
        const initial = validPoint(current.value) ? current.value : validPoint(current.center) ? current.center : undefined;
        const m = L.map(host.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(
          [initial?.latitude ?? -2.5, initial?.longitude ?? 118],
          initial?.latitude != null ? 15 : 4
        );
        map.current = m;
        const tiles = L.tileLayer(mapTiles.url, { attribution: mapTiles.attribution, maxZoom: mapTiles.maxZoom }).addTo(m);
        tiles.on("tileerror", () => {
          if (!cancelled) setError("Peta gagal dimuat. Periksa koneksi lalu coba lagi, atau masukkan koordinat di bawah.");
        });
        const icon = L.divIcon({ className: "delivery-map-pin", html: "<span></span>", iconSize: [26, 34], iconAnchor: [13, 34] });
        marker.current = L.marker(validPoint(current.value) ? [current.value.latitude, current.value.longitude] : [0, 0], {
          icon,
          draggable: !!current.onChange,
          autoPan: true,
          title: label,
          alt: label,
        });
        if (validPoint(current.value)) marker.current.addTo(m);
        marker.current.on("dragend", () => {
          if (host.current?.closest("fieldset")?.disabled) return;
          const point = marker.current!.getLatLng().wrap();
          latest.current.onChange?.({ latitude: point.lat, longitude: point.lng });
        });
        m.on("click", (event) => {
          if (host.current?.closest("fieldset")?.disabled) return;
          const point = event.latlng.wrap();
          latest.current.onChange?.({ latitude: point.lat, longitude: point.lng });
        });
        observer = new ResizeObserver(() => m.invalidateSize());
        observer.observe(host.current);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("Peta gagal dimuat. Coba lagi atau masukkan koordinat di bawah.");
      });
    return () => {
      cancelled = true;
      alive.current = false;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    if (!ready || !map.current || !marker.current) return;
    if (validPoint(value)) {
      marker.current.setLatLng([value.latitude, value.longitude]).addTo(map.current);
      map.current.setView([value.latitude, value.longitude], Math.max(15, map.current.getZoom()), { animate: false });
    } else marker.current.remove();
  }, [value.latitude, value.longitude, ready]);
  const locate = () => {
    if (!navigator.geolocation) {
      setError("Browser belum mendukung lokasi perangkat. Pilih pin secara manual.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive.current) return;
        setLocating(false);
        setError("");
        onChange?.({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        if (!alive.current) return;
        setLocating(false);
        setError("Lokasi perangkat tidak tersedia atau izin ditolak. Pilih pin secara manual.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };
  const manual = (axis: keyof Coordinates, raw: string) => {
    const next = raw === "" ? null : Number(raw);
    onChange?.({ ...value, [axis]: next });
  };
  return (
    <div className="location-picker">
      <div className="location-toolbar">
        <strong>{label}</strong>
        {onChange && (
          <button type="button" className="button secondary" onClick={locate} disabled={locating}>
            {locating ? "Mencari lokasi…" : "Gunakan lokasi saya"}
          </button>
        )}
      </div>
      {onChange && (
        <div className="place-search">
          <label htmlFor={searchId}>Cari alamat atau nama tempat</label>
          <div className="place-search-input">
            <input
              id={searchId}
              type="search"
              value={query}
              maxLength={200}
              placeholder="Contoh: Pasar Minggu, Jakarta"
              autoComplete="off"
              aria-describedby={`${searchId}-hint`}
              onChange={(e) => {
                e.stopPropagation();
                ++searchVersion.current;
                setSearching(false);
                setQuery(e.target.value);
                setResults(null);
                setSearchError("");
                setSelectedPlace("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!searching) void search();
                }
              }}
            />
            <button type="button" className="button secondary" onClick={() => void search()} disabled={searching || query.trim().length < 3}>
              {searching ? "Mencari…" : "Cari alamat"}
            </button>
          </div>
          <p id={`${searchId}-hint`} className="fine">
            Sertakan kota agar hasil lebih tepat. Pencarian oleh{" "}
            <a href="https://github.com/komoot/photon" target="_blank" rel="noopener noreferrer">
              Photon
            </a>{" "}
            dan{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap
            </a>
            .
          </p>
          <ErrorBox message={searchError} />
          {searching && (
            <p className="fine" role="status">
              Mencari alamat…
            </p>
          )}
          {results?.length === 0 && (
            <p className="fine" role="status">
              Alamat belum ditemukan. Coba nama jalan, tempat terdekat, dan kota, atau pilih pin pada peta.
            </p>
          )}
          {!!results?.length && (
            <ul className="place-search-results" aria-label="Hasil pencarian alamat">
              {results.map((place, index) => (
                <li key={`${place.latitude},${place.longitude},${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ latitude: place.latitude, longitude: place.longitude });
                      setResults(null);
                      setSelectedPlace(place.address);
                      host.current?.focus({ preventScroll: true });
                    }}
                  >
                    <strong>{place.name}</strong>
                    <span>{place.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedPlace && (
            <p className="fine" role="status">
              Pin dipindahkan ke {selectedPlace}. Geser pin bila perlu.
            </p>
          )}
        </div>
      )}
      <div ref={host} className="location-map" role="region" tabIndex={0} aria-label={`Peta ${label.toLowerCase()}`} />
      <ErrorBox message={error} />
      {error && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        >
          Coba muat peta lagi
        </button>
      )}
      {onChange && (
        <>
          <p className="fine">Ketuk peta atau geser pin ke lokasi yang tepat. Koordinat juga bisa diisi dengan keyboard.</p>
          <div className="two-fields coordinate-fields">
            <label>
              Latitude
              <input
                aria-label={`Latitude ${label.toLowerCase()}`}
                type="number"
                min={-90}
                max={90}
                step="any"
                value={value.latitude ?? ""}
                onChange={(e) => manual("latitude", e.target.value)}
              />
            </label>
            <label>
              Longitude
              <input
                aria-label={`Longitude ${label.toLowerCase()}`}
                type="number"
                min={-180}
                max={180}
                step="any"
                value={value.longitude ?? ""}
                onChange={(e) => manual("longitude", e.target.value)}
              />
            </label>
          </div>
        </>
      )}
      {validPoint(value) ? (
        <a className="map-external" href={`https://www.google.com/maps/search/?api=1&query=${value.latitude},${value.longitude}`} target="_blank" rel="noopener noreferrer">
          Buka di Maps
        </a>
      ) : (
        <p className="fine" role="status">
          Titik lokasi belum dipilih.
        </p>
      )}
    </div>
  );
}
