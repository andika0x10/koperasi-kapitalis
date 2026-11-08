# Koperasi Kapitalis

Aplikasi pemesanan barang kebutuhan sehari-hari untuk banyak seller dengan hak setara dan banyak buyer. Antarmuka berbahasa Indonesia, IDR, dan waktu Asia/Jakarta.

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

Username harus cocok dengan seller yang ada. Pemulihan mengganti password menjadi password sementara dan mencabut seluruh sesinya. Seller tambahan dibuat melalui halaman Pengguna. `--recover` hanya menargetkan seller aktif dengan username tersebut; akun terhapus tidak dapat dipulihkan. Bootstrap dan pemulihan tercatat sebagai tindakan Operator CLI. Pilih nama berkas output baru; jangan menimpa kredensial lama. Hapus berkas kredensial setelah password diganti.

## Aturan pesanan

1. Katalog publik; login buyer diperlukan untuk keranjang dan checkout. Maksimal 20 jenis barang per checkout, maksimal 999 unit per barang.
2. Harga, ongkir, alamat, dan instruksi pembayaran disalin saat checkout. Server meminta konfirmasi ulang jika total berubah. Produk sederhana tanpa varian; produk dapat diarsipkan.
3. Checkout menahan stok 1 jam. Keranjang tidak menahan stok. Pesanan tidak bisa diedit/dibatalkan buyer.
4. Buyer mengunggah satu bukti JPEG/PNG/WebP maksimal 1.500.000 byte sebelum tenggat. Server memeriksa MIME dan signature; bukti tidak bisa diganti. Retry file identik tidak membuat bukti baru.
5. Bukti diterima mempertahankan stok selama menunggu pemeriksaan. Alarm melepas stok pesanan tanpa bukti yang kedaluwarsa. Daftar/detail pesanan juga menyegarkan kedaluwarsa sebelum dibaca.
6. Seller menyetujui atau menolak. Penolakan wajib beralasan. Keputusan final; stok dikembalikan hanya sekali jika ditolak/kedaluwarsa.
7. Pesanan disetujui dilanjutkan ke dikirim (nama kurir wajib, tanpa nomor resi), lalu selesai oleh seller. Tidak ada integrasi kurir atau konfirmasi otomatis.
8. Form edit produk membawa `revision`. Jika checkout atau tindakan lain mengubah stok, form lama ditolak supaya tidak menimpa stok terbaru. Stok pada form berarti stok tersedia di luar reservasi.

## API

Semua endpoint menggunakan same-origin cookie. Mutasi wajib membawa header `Origin` yang sesuai dan `x-csrf-token` dari `/api/me`, kecuali login/registrasi yang hanya memerlukan pemeriksaan origin. Respons error JSON berbentuk `{ "error": "pesan" }`.

| Endpoint                                                             | Akses / fungsi                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /api/register`, `POST /api/login`                              | Publik; username dan password; registrasi selalu buyer                                         |
| `GET /api/me`                                                        | Identitas user dan token CSRF; user null jika belum masuk                                      |
| `GET /api/products`                                                  | Katalog publik; `all=1` khusus seller; mendukung `q`, `category`                               |
| `POST /api/products`, `PUT /api/products/:id`                        | Seller; edit/arsip memerlukan revision terbaru                                                 |
| `GET /api/settings`, `PUT /api/settings`                             | Baca instruksi pembayaran publik; tulis khusus seller                                          |
| `POST /api/attachments?kind=product\|qris`                           | Upload gambar khusus seller; body biner dan Content-Type gambar                                |
| `GET /api/attachments/:id`                                           | Foto/QRIS publik; bukti hanya pemilik dan seller, tanpa cache                                  |
| `GET /api/cart`, `PUT /api/cart`                                     | Buyer; ubah quantity, 0 untuk menghapus                                                        |
| `POST /api/checkout`                                                 | Buyer; key idempoten, data penerima, payment_method, expected_total                            |
| `GET /api/orders`, `GET /api/orders/:id`                             | Buyer hanya milik sendiri; seller seluruh pesanan                                              |
| `POST /api/orders/:id/proof`                                         | Buyer pemilik; body biner gambar                                                               |
| `POST /api/orders/:id/decision`                                      | Seller; status approved/rejected, reason                                                       |
| `POST /api/orders/:id/ship`, `POST /api/orders/:id/complete`         | Seller; pengiriman dan penyelesaian                                                            |
| `GET /api/users`, `POST /api/users`                                  | Seller; daftar/filter akun dan membuat buyer/seller dengan role tetap serta password sementara |
| `DELETE /api/users/:id`, `POST /api/users/:id/reset`                 | Seller; hapus lunak permanen atau reset akun lain, mencabut seluruh sesi target                |
| `PUT /api/username`                                                  | Pemilik akun; `{ username, current }`, mencabut sesi perangkat lain                            |
| `GET /api/audit-logs`                                                | Seller; log perubahan/keamanan, filter pelaku/tindakan/objek/tanggal WIB                       |
| `POST /api/password`                                                 | Kedua role; current dan password baru; sesi lain dicabut                                       |
| `GET /api/sessions`, `POST /api/sessions/revoke`, `POST /api/logout` | Kedua role; sesi hanya milik sendiri                                                           |

`GET /api/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&page=0` khusus seller. Rentang tanggal inklusif dalam WIB dan dihitung berdasarkan `decided_at` untuk pesanan approved/shipped/completed. Respons berisi `summary`, `daily`, `products` (10 terlaris berdasarkan unit), `transactions` (30 per halaman), dan `page`. Harga memakai snapshot pesanan; laporan tidak menghitung laba dan tidak memiliki ekspor.

`PUT /api/settings` mendukung pembaruan parsial. Field yang tidak dikirim dipertahankan di coordinator agar penyimpanan bagian ongkir dan pembayaran tidak saling menimpa. `POST /api/orders/:id/ship` menerima `{ "courier": "Nama kurir" }` (wajib, maksimal 80 karakter). Nomor resi dihapus dari API dan database melalui migrasi `0003_remove_tracking.sql`; nama kurir yang sudah tersimpan tetap dipertahankan. Jalankan migrasi sebelum menjalankan versi ini.

Halaman pembeli `/keranjang` berbagi kontrol dengan panel/popup katalog. Pengaturan memakai bagian URL `#akun`, `#keamanan`, `#perangkat`, `#pengiriman`, dan `#pembayaran` (dua terakhir khusus seller). Laporan berada di `/seller/laporan`.

Daftar pesanan dan user memakai `page` mulai 0, 30 baris per halaman. Daftar pesanan mendukung `status`, user mendukung `q`, `role=buyer|seller`, dan `status=active|deleted|all` (default aktif). Katalog dibatasi 500 produk untuk toko tunggal ini.

## Akun dan log aktivitas

Migrasi `0004_users_audit.sql` menghapus batas satu seller, menambahkan hapus lunak permanen, dan memperluas audit serta identitas pelaku pada riwayat pesanan. Migrasi sebelumnya tidak diubah. Jalankan migrasi sebelum kode baru digunakan.

Seller dapat membuat buyer/seller di `/seller/users`; role tidak dapat diubah. Password sementara ditampilkan sekali dan wajib diganti pada login pertama. Reset hanya untuk akun lain yang aktif. Akun sendiri dikelola di `/pengaturan#akun` (username) dan `#keamanan` (password). Penggantian username memerlukan password saat ini, mempertahankan perangkat saat ini, dan mencabut sesi lainnya. Username lama dapat digunakan lagi; snapshot audit tetap menyimpan identitas saat kejadian.

Penghapusan tidak dapat dipulihkan. Username terakhir tetap dicadangkan dan semua sesi dicabut. Pesanan serta riwayat tetap tersimpan dan pesanan berjalan dapat diselesaikan seller. Penghapusan diri sendiri dan seller aktif terakhir ditolak; database juga melindungi seller terakhir.

Halaman `/seller/log-aktivitas` hanya dapat dibaca seller. Tidak tersedia edit, hapus manual, atau ekspor. Endpoint `GET /api/audit-logs` menerima `actor` (pencarian snapshot username atau ID), `action` (kode persis), `q` (ID objek/detail), pasangan `from`/`to` (YYYY-MM-DD, tanggal inklusif WIB), dan `page` (mulai 0). Respons berupa array maksimal 30 catatan, urutan waktu/ID terbaru. Detail berisi field yang diizinkan, termasuk `before`/`after`; password/hash, token, isi gambar, dan data pribadi lengkap pesanan tidak dicatat. Log lama tanpa snapshot/detail ditampilkan sebagai tidak tersedia.

Audit mencatat perubahan akun, keranjang, pesanan, produk, pengaturan, unggahan, autentikasi, pencabutan sesi, serta penolakan permintaan mutasi. Pembacaan data tidak dicatat. Mutasi dan log sukses memakai batch atomik; retry tanpa perubahan tidak menambah log sukses. Login gagal tidak mengklaim identitas pelaku: username yang dicoba dicatat sebagai detail bila valid. Retensi memakai 365 hari; alarm Commerce membersihkan log lama dan tetap dijadwalkan harian saat tidak ada pesanan pending. Alarm diaktifkan oleh permintaan mutasi pertama atau penyegaran status pesanan setelah deployment.

## Verifikasi

```powershell
npm run typecheck
npm test
npm run build
```

Tes menjalankan Workers + D1 + Durable Objects di Miniflare: role/CSRF, persaingan stok terakhir, checkout bersamaan dengan key sama, snapshot harga/pembayaran, edit stok kedaluwarsa, alarm berulang, bukti sekali unggah dan batas ukuran, akses lintas akun, keputusan bersamaan/final, pengiriman, reset password, sesi, dan rate limit.

Verifikasi perubahan UI dan akun: typecheck, 23 tes integrasi, dan build berhasil. Tes tambahan mencakup pengiriman dengan nama kurir saja, retry, penghapusan kolom resi, penyimpanan parsial/bersamaan, pembatasan akses laporan, batas tanggal WIB, snapshot harga, paginasi, dan pencegahan penghitungan ganda.

Pemeriksaan visual belum terverifikasi: tidak ada koneksi browser yang tersedia di sesi implementasi. Sebelum peluncuran, periksa lebar 320, 375, 390, 768, 1024, dan 1440 px untuk overflow, navbar/menu akun, fokus/Escape/klik luar dialog, keranjang, checkout, pengaturan belum disimpan, dan laporan. Tidak ada screenshot yang sudah diverifikasi pada sesi ini.

`npm audit` masih melaporkan advisory moderate pada dependency transitif pembuat gambar OpenGraph bawaan Vinext, yang tidak dipakai aplikasi ini. Hindari `npm audit fix --force` yang menawarkan downgrade major framework. Vite sudah diperbarui ke patch 8.3.6.

Di luar versi pertama: email, notifikasi eksternal, promo, pembayaran otomatis, integrasi kurir, refund, dan retur.
