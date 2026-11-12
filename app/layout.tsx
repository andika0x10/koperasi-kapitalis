import type { Metadata } from "next";
import "./globals.css";
import "./refresh.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Koperasi Kapitalis",
  description: "Katalog kebutuhan sehari-hari. Pesan, bayar, dan pantau pengiriman Anda.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
