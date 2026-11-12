# Koperasi Kapitalis

Toko tunggal untuk satu owner, banyak staf, dan banyak pelanggan. Antarmuka berbahasa Indonesia, harga IDR, dan waktu Asia/Jakarta. Seluruh penghapusan barang dan akun bersifat permanen; pesanan dan audit tidak dapat dihapus melalui aplikasi.

## Stack

- Vinext App Router, React, TypeScript, Cloudflare Workers, D1, dan Durable Objects.
- D1 menyimpan data, sesi, dan gambar sebagai BLOB; tidak menggunakan R2.
- Coordinator `Commerce` menserialkan mutasi toko. Batch D1 serta trigger menjaga transaksi, stok, revisi, dan transisi pesanan. `RateLimiter` membatasi autentikasi dan pemakaian link password.
- Password menggunakan scrypt native Workers (`N=16384,r=8,p=5`). Token sesi dan link password disimpan sebagai SHA-256. Sesi berakhir setelah 7 hari tidak aktif atau maksimal 30 hari.
- Public Sans di-host bersama aplikasi; putih, oranye `#FF6F12`, dan teks `#242424`.

## Menjalankan lokal

Memerlukan Node.js 22.23+ yang kompatibel dengan CLI terpasang.

```powershell
npm ci
npm run db:migrate:local
npm run owner:bootstrap -- --username nama_owner --origin http://localhost:5173 --output .owner-credentials-local.txt
npm run dev
```

Buka link pada berkas output dalam 1 jam, tentukan password, lalu masuk. Hapus berkas setelah aktivasi. Username owner ditentukan operator; tidak ada kredensial bawaan. Pilih nama output baru untuk setiap penerbitan. Data lokal berada di `.cloudflare/state`.

Pemulihan owner menggunakan username yang sama:

```powershell
npm run owner:bootstrap -- --username nama_owner --recover --origin http://localhost:5173 --output .owner-credentials-recovery.txt
```

Pemulihan langsung menonaktifkan password lama, membatalkan link sebelumnya, dan mencabut sesi. Link baru berlaku 1 jam dan sekali pakai. Jika kedaluwarsa, jalankan pemulihan lagi dengan nama output baru. CLI hanya mencetak lokasi output; token mentah tidak dicetak. `--persist-to` dapat memilih penyimpanan lokal terisolasi untuk pengujian.

## Peran dan halaman

| Kemampuan                                          | Owner | Staf  | Pelanggan |
| -------------------------------------------------- | ----- | ----- | --------- |
| Kelola barang dan seluruh pesanan                  | Ya    | Ya    | Tidak     |
| Ubah ongkir                                        | Ya    | Ya    | Tidak     |
| Atur rekening dan QRIS                             | Ya    | Tidak | Tidak     |
| Buat/hapus akun staf dan pelanggan + aktivasi awal | Ya    | Tidak | Tidak     |
| Statistik toko dan audit                           | Ya    | Tidak | Tidak     |
| Belanja dan pesanan sendiri                        | Tidak | Tidak | Ya        |

- Operasional: `/kelola/produk`, `/kelola/pesanan`, `/kelola/pesanan/:id`.
- Staf: `/kelola/pelanggan` untuk pencarian dan pemulihan akun pelanggan.
- Pelanggan: `/statistik` untuk statistik belanja pribadi.
- Owner: `/owner/statistik`, `/owner/pengguna`, `/owner/log-aktivitas`.
- Pengaturan akun: `/pengaturan#akun`, `#keamanan`, `#perangkat`; `#pengiriman` untuk owner/staf dan `#pembayaran` khusus owner.
- Link password: `/atur-password#token=...`. URL `/seller` lama dialihkan ke penggantinya, lalu tetap diperiksa izinnya.
- Owner tunggal dibuat melalui CLI, tidak dapat dihapus. Role semua akun tidak dapat diubah. Semua izin juga ditegakkan backend.

## Akun dan link password

Owner memilih Tambah staf atau Tambah pelanggan lalu memasukkan username saja. Akun berstatus `pending`, tanpa password yang bisa dipakai. Link ditampilkan untuk disalin dan dibagikan manual. Pelanggan tetap dapat mendaftar sendiri menggunakan username/password.

`POST /api/users` menerima `{username,role:"staff"|"buyer"}` dan mengembalikan `{id,username,url,expires_at}`. `POST /api/users/:id/reset` mengembalikan `{username,url,expires_at}`. Reset/aktivasi ulang pelanggan hanya oleh staf; reset/aktivasi ulang staf hanya oleh owner. Hasil penerbitan tidak dapat dibaca ulang; terbitkan link baru jika hilang.

Link baru selalu membatalkan link sebelumnya. Reset langsung mengganti status akun menjadi `reset_required`, mengosongkan hash password, dan mencabut seluruh sesi. Link berlaku tepat 1 jam, sekali pakai; hanya hash token yang disimpan. Token masuk fragmen URL dan body permintaan, tidak masuk query/path API atau audit. Pengguna menentukan password 12–128 karakter lalu login kembali; tidak otomatis masuk.

`POST /api/password-links/validate` menerima `{token}` dan mengembalikan username serta kedaluwarsa. `POST /api/password-links/complete` menerima `{token,password}`. Keduanya publik dengan pemeriksaan origin dan rate limit; konsumsi link serta aktivasi bersifat atomik. Ganti password biasa melalui `/api/password` tetap memerlukan password saat ini, membatalkan link aktif, dan mencabut sesi perangkat lain.

Tidak ada email atau notifikasi eksternal. Pelanggan yang lupa password meminta link kepada staf; staf meminta kepada owner; pemulihan owner melalui CLI.

## Barang, foto, dan penghapusan

Produk menggunakan `photo_ids: string[]` yang berurutan, maksimal 5 foto berbeda; foto pertama menjadi sampul. Foto opsional. Format JPEG/PNG/WebP, maksimal 1.500.000 byte per foto, dengan pemeriksaan MIME dan signature. Unggahan gagal ditampilkan per file, urutan dapat diubah dengan tombol, dan katalog memiliki galeri besar.

- `POST /api/products` dan `PUT /api/products/:id`: owner/staf; data barang dan `photo_ids`. Edit memerlukan `revision` terbaru.
- `DELETE /api/products/:id`: owner/staf; body `{revision}`. Barang dengan pesanan pending/review/approved/shipped ditolak dengan HTTP 409 dan daftar `{orders:[{id}]}`. Selesaikan pesanan terkait sebelum menghapus.
- Penghapusan barang menghapus baris barang, keranjang terkait, dan foto yang tidak dipakai barang lain. Snapshot item pesanan tetap ada; identifier produk historis tidak bergantung pada katalog.
- `DELETE /api/users/:id`: khusus owner untuk staf/pelanggan. Akun, sesi, keranjang, dan token dihapus secara fisik. Username dapat dipakai lagi, tetapi akun baru memiliki ID baru dan tidak mewarisi pesanan/akses lama.
- Pesanan tetap menyimpan snapshot username pelanggan; audit serta riwayat tetap menyimpan snapshot pelaku. Referensi akun historis menjadi NULL. Foto produk, QRIS, dan bukti pembayaran yang masih diperlukan tetap tersedia sesuai izin.
- `POST /api/attachments?kind=product|qris`: unggah biner gambar. Produk untuk owner/staf; QRIS khusus owner.
- `DELETE /api/attachments/:id`: membuang foto produk milik pengunggah yang belum terhubung. Unggahan produk yang tidak dipakai lebih dari 24 jam dibersihkan alarm; foto terhubung selalu dipertahankan.
- `GET /api/attachments/:id`: foto/QRIS publik; bukti pembayaran hanya pelanggan pemilik pesanan serta owner/staf, tanpa cache.

Tidak tersedia arsip, pemulihan, atau filter akun terhapus. Dialog hapus menyebut objek dan dampak permanennya.

## Pesanan dan statistik

Checkout memerlukan pelanggan, maksimal 20 jenis barang dan 999 unit per barang. Keranjang tidak menahan stok. Checkout menahan stok selama 1 jam; harga, ongkir, alamat, serta instruksi pembayaran disalin ke pesanan. Perubahan total memerlukan konfirmasi ulang. Pelanggan tidak dapat mengubah atau membatalkan pesanan.

Satu bukti pembayaran diunggah sebelum tenggat. Bukti tidak dapat diganti; retry identik aman. Bukti yang diterima mempertahankan stok sampai diperiksa. Staf/owner menyetujui atau menolak dengan alasan wajib saat menolak; keputusan final. Penolakan/kedaluwarsa mengembalikan stok sekali. Pesanan disetujui dilanjutkan ke dikirim (nama kurir wajib, tanpa resi), lalu selesai oleh staf/owner.

`GET /api/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&page=0` khusus owner. Tanggal inklusif dalam WIB berdasarkan `decided_at` untuk approved/shipped/completed. Respons memuat `summary`, `daily`, 10 `products` terlaris berdasarkan unit, `transactions` (30 per halaman), `page`, dan `operations`.

`GET /api/reports/purchases?from=YYYY-MM-DD&to=YYYY-MM-DD&page=0` khusus pelanggan, selalu menggunakan ID sesi. Respons berisi `summary`, `daily`, `products`, `transactions`, `page`, dan `orders` (jumlah pesanan pribadi per status sepanjang waktu). Perhitungan belanja menggunakan batas tanggal WIB dan status terverifikasi yang sama dengan laporan penjualan, tanpa data stok/akun toko.

`operations` menggambarkan kondisi saat ini dan tidak mengikuti filter tanggal: pesanan per status; daftar barang stok 0 dan stok 1–5; jumlah akun per role/status. Harga memakai snapshot; tidak menghitung laba, kinerja staf, atau ekspor.

## API dan audit

Semua mutasi memerlukan Origin yang sama. Selain login, registrasi, dan konsumsi link password, mutasi juga memerlukan cookie sesi dan `x-csrf-token` dari `/api/me`. Respons error berbentuk `{error}`. JSON API memakai `Cache-Control: no-store`.

`GET /api/users` untuk owner dan staf. Staf selalu dibatasi pada pelanggan, termasuk jika mengirim filter role lain; staf tidak dapat menambah/menghapus akun. Owner mendukung filter `q`, `role=owner|staff|buyer`, `status=pending|active|reset_required`, serta `page` mulai 0, 30 baris per halaman. Katalog mendukung `q` dan `category`, dibatasi 500 barang.

`GET /api/audit-logs` khusus owner: filter `actor`, `action`, `q`, pasangan `from`/`to` dalam WIB, dan `page`; maksimal 30 catatan per halaman, terbaru dahulu. Detail before/after memakai allowlist; password, hash password, token, isi gambar, dan data pribadi lengkap pesanan tidak dicatat. Kejadian mencakup aktivasi, penerbitan/pemakaian link, penghapusan, dan mutasi operasional. Pembacaan tidak dicatat. Retensi tetap 365 hari dengan alarm harian saat toko idle.

## Migrasi dan rilis

Migrasi `0005_owner_staff_photos.sql` tidak mengubah migrasi sebelumnya. Seller lama menjadi staf; password aktif tetap berlaku. Akun dengan password sementara menjadi `reset_required`, memerlukan link dari owner. Akun lama yang sudah ditandai terhapus dihapus fisik setelah snapshot dipenuhi. Foto tunggal dipindahkan menjadi foto pertama.

Barang arsip lama dihapus permanen beserta foto yang tidak terpakai. Jika ada barang arsip dengan pesanan berjalan, migrasi gagal atomik dengan pesan `ARSIP_MASIH_MEMILIKI_PESANAN_BERJALAN`. Selesaikan pesanan memakai versi lama, lalu ulangi migrasi. Jangan menghapus pengaman tersebut.

Perubahan schema ini memerlukan rilis terkoordinasi: verifikasi backup, gunakan waktu pemeliharaan, hentikan mutasi versi lama, terapkan migrasi, jalankan setup owner baru, lalu rilis kode baru dan verifikasi aktivasi/izin. Kode lama tidak kompatibel dengan schema baru; rollback kode saja tidak mengembalikan schema.

Produksi memakai D1 `koperasi-kapitalis-db` dan Worker `koperasi-kapitalis`. Perintah remote hanya dijalankan saat rilis produksi memang diminta:

```powershell
npm run db:migrate:remote
npm run owner:bootstrap -- --remote --username nama_owner --origin https://domain-toko-anda.example --output .owner-credentials-production.txt
npm run deploy
```

Ganti origin dengan domain toko sebenarnya. Deployment memakai alur proyek yang sudah ada; tidak termasuk dalam implementasi lokal ini.

## Verifikasi

```powershell
npm run typecheck
npm test
npm run build
npm run test:ui
```

Integrasi memakai Workers, D1, dan Durable Objects di Miniflare terisolasi. Cakupan termasuk tiga role, CSRF, stok bersamaan, snapshot, link kedaluwarsa/sekali pakai/penerbitan ulang, penghapusan fisik, audit tanpa rahasia, multi foto, dan alarm. Tes migrasi memakai data lama terisi serta memeriksa rollback atomik dan foreign key.

Playwright mengintersep API sehingga tidak mengubah data toko. Responsivitas diperiksa dari 320–1440 px untuk publik/pelanggan/staf/owner, termasuk nama panjang, nominal besar, kondisi loading/error/kosong, dialog, fokus keyboard, reduced motion, galeri, serta link password. Screenshot dan trace tersimpan di `.test-artifacts/ui/`.

Tes katalog tambahan mencakup 320–1920 px, satu/banyak produk, foto portrait/landscape/persegi, tanpa foto, stok habis, serta navigasi saat resize. Tes memeriksa proporsi foto, batas lebar konten staf/owner, dan membandingkan screenshot pada 390, 1440, dan 1920 px dengan baseline di `tests/ui/catalog.spec.ts-snapshots/`. Baseline yang disertakan memakai Chromium di Windows; platform lain memerlukan baseline sendiri karena rendering font dapat berbeda.

Jalankan `npx playwright test tests/ui/catalog.spec.ts` untuk pemeriksaan katalog saja. Setelah perubahan visual yang disengaja, tinjau hasil screenshot terlebih dahulu, lalu perbarui baseline dengan `npx playwright test tests/ui/catalog.spec.ts --update-snapshots=all`. Jalankan kembali tanpa opsi update untuk memastikan perbandingan lulus.

Di luar cakupan: email, promo, pembayaran otomatis, integrasi kurir, refund, retur, dan ekspor laporan.
