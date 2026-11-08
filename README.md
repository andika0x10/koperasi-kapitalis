# Koperasi Kapitalis

Aplikasi pemesanan barang kebutuhan sehari-hari untuk satu seller dan banyak buyer. Antarmuka berbahasa Indonesia, IDR, dan waktu Asia/Jakarta.

## Stack dan penyimpanan

- Vinext App Router, React, TypeScript, dan Cloudflare Workers.
- D1 menyimpan seluruh data bisnis, sesi, dan attachment sebagai BLOB. Tidak menggunakan R2.
- Durable Object `Commerce` menserialkan mutasi toko dan menjalankan alarm kedaluwarsa. D1 tetap sumber kebenaran; batch atomik, trigger stok, dan batas transisi menjadi pengaman saat retry/restart.
- Durable Object `RateLimiter` membatasi login berdasarkan IP dan username, serta pendaftaran berdasarkan IP.
- Password: scrypt native Workers (`N=16384, r=8, p=5`, salt acak). Token sesi disimpan sebagai SHA-256. Sesi kedaluwarsa setelah 7 hari tidak aktif atau maksimal 30 hari.
- Public Sans di-host bersama aset aplikasi. Palet utama `#FF6F12`, latar `#FFFFFF`.

## Menjalankan lokal

Memerlukan Node.js 22.23+ yang kompatibel dengan versi CLI Cloudflare yang terpasang.

```powershell
npm ci
npm run db:migrate:local
npm run seller:bootstrap -- --username seller --output .seller-credentials-local-new.txt
npm run dev
```

Database lokal berada di `.cloudflare/state`, sesuai Cloudflare Vite plugin. Pengujian integrasi memakai database Miniflare terpisah yang dibuang setelah tes, tanpa data produksi.

## Deployment

```powershell
npx wrangler login
npm run db:migrate:remote
npm run seller:bootstrap -- --remote --username seller --output .seller-credentials.txt
npm run deploy
```

Bootstrap hanya dilakukan sekali. Akun seller produksi sudah disiapkan saat implementasi. Password awal berada di `.seller-credentials.txt`, diabaikan Git. Masuk melalui `/masuk`, lalu ganti password sementara. Setelah itu atur ongkir, rekening/QRIS, dan produk. Produksi dimulai tanpa produk contoh.

`scripts/deploy.mjs` memakai token environment jika tersedia; jika tidak, mengambil token login Wrangler melalui subprocess. Token diteruskan ke CLI `cf` hanya melalui environment child process, tanpa mencetak atau menulis token ke proyek. Akun Cloudflare tujuan: `3733a7977c6783973d0ee237b086aa34`.

D1 produksi: `koperasi-kapitalis-db`. Worker: `koperasi-kapitalis`. Jalankan migrasi sebelum deployment berikutnya. Untuk deploy output yang sudah dibangun: `npm run deploy -- --prebuilt`.

## Pemulihan seller

```powershell
npm run seller:bootstrap -- --remote --username seller --recover --output .seller-credentials-recovery.txt
```

Username harus cocok dengan seller yang ada. Pemulihan mengganti password menjadi password sementara dan mencabut seluruh sesinya. Tidak ada akun seller tambahan. Pilih nama berkas output baru; jangan menimpa kredensial lama. Hapus berkas kredensial setelah password diganti.

## Aturan pesanan

1. Katalog publik; login buyer diperlukan untuk keranjang dan checkout. Maksimal 20 jenis barang per checkout, maksimal 999 unit per barang.
2. Harga, ongkir, alamat, dan instruksi pembayaran disalin saat checkout. Server meminta konfirmasi ulang jika total berubah. Produk sederhana tanpa varian; produk dapat diarsipkan.
3. Checkout menahan stok 1 jam. Keranjang tidak menahan stok. Pesanan tidak bisa diedit/dibatalkan buyer.
4. Buyer mengunggah satu bukti JPEG/PNG/WebP maksimal 1.500.000 byte sebelum tenggat. Server memeriksa MIME dan signature; bukti tidak bisa diganti. Retry file identik tidak membuat bukti baru.
5. Bukti diterima mempertahankan stok selama menunggu pemeriksaan. Alarm melepas stok pesanan tanpa bukti yang kedaluwarsa. Daftar/detail pesanan juga menyegarkan kedaluwarsa sebelum dibaca.
6. Seller menyetujui atau menolak. Penolakan wajib beralasan. Keputusan final; stok dikembalikan hanya sekali jika ditolak/kedaluwarsa.
7. Pesanan disetujui dilanjutkan ke dikirim (kurir dan resi wajib), lalu selesai oleh seller. Tidak ada integrasi kurir atau konfirmasi otomatis.
8. Form edit produk membawa `revision`. Jika checkout atau tindakan lain mengubah stok, form lama ditolak supaya tidak menimpa stok terbaru. Stok pada form berarti stok tersedia di luar reservasi.

## API

Semua endpoint menggunakan same-origin cookie. Mutasi wajib membawa header `Origin` yang sesuai dan `x-csrf-token` dari `/api/me`, kecuali login/registrasi yang hanya memerlukan pemeriksaan origin. Respons error JSON berbentuk `{ "error": "pesan" }`.

| Endpoint                                                             | Akses / fungsi                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /api/register`, `POST /api/login`                              | Publik; username dan password; registrasi selalu buyer              |
| `GET /api/me`                                                        | Identitas user dan token CSRF; user null jika belum masuk           |
| `GET /api/products`                                                  | Katalog publik; `all=1` khusus seller; mendukung `q`, `category`    |
| `POST /api/products`, `PUT /api/products/:id`                        | Seller; edit/arsip memerlukan revision terbaru                      |
| `GET /api/settings`, `PUT /api/settings`                             | Baca instruksi pembayaran publik; tulis khusus seller               |
| `POST /api/attachments?kind=product\|qris`                           | Upload gambar khusus seller; body biner dan Content-Type gambar     |
| `GET /api/attachments/:id`                                           | Foto/QRIS publik; bukti hanya pemilik dan seller, tanpa cache       |
| `GET /api/cart`, `PUT /api/cart`                                     | Buyer; ubah quantity, 0 untuk menghapus                             |
| `POST /api/checkout`                                                 | Buyer; key idempoten, data penerima, payment_method, expected_total |
| `GET /api/orders`, `GET /api/orders/:id`                             | Buyer hanya milik sendiri; seller seluruh pesanan                   |
| `POST /api/orders/:id/proof`                                         | Buyer pemilik; body biner gambar                                    |
| `POST /api/orders/:id/decision`                                      | Seller; status approved/rejected, reason                            |
| `POST /api/orders/:id/ship`, `POST /api/orders/:id/complete`         | Seller; pengiriman dan penyelesaian                                 |
| `GET /api/users`, `POST /api/users/:id/reset`                        | Seller; reset hanya buyer, password sementara tampil sekali         |
| `POST /api/password`                                                 | Kedua role; current dan password baru; sesi lain dicabut            |
| `GET /api/sessions`, `POST /api/sessions/revoke`, `POST /api/logout` | Kedua role; sesi hanya milik sendiri                                |

Daftar pesanan dan user memakai `page` mulai 0, 30 baris per halaman. Daftar pesanan mendukung `status`, user mendukung `q`. Katalog dibatasi 500 produk untuk toko tunggal ini.

## Verifikasi

```powershell
npm run typecheck
npm test
npm run build
```

Tes menjalankan Workers + D1 + Durable Objects di Miniflare: role/CSRF, persaingan stok terakhir, checkout bersamaan dengan key sama, snapshot harga/pembayaran, edit stok kedaluwarsa, alarm berulang, bukti sekali unggah dan batas ukuran, akses lintas akun, keputusan bersamaan/final, pengiriman, reset password, sesi, dan rate limit.

Browser otomatis tidak tersedia pada sesi implementasi; screenshot dan interaksi browser desktop/mobile belum diverifikasi. Struktur responsif, focus keyboard, dialog native, serta reduced motion sudah diterapkan. Lakukan tinjauan visual sebelum peluncuran operasional.

`npm audit` masih melaporkan advisory moderate pada dependency transitif pembuat gambar OpenGraph bawaan Vinext, yang tidak dipakai aplikasi ini. Hindari `npm audit fix --force` yang menawarkan downgrade major framework. Vite sudah diperbarui ke patch 8.3.6.

Di luar versi pertama: email, notifikasi eksternal, promo, pembayaran otomatis, integrasi kurir, refund, dan retur.
