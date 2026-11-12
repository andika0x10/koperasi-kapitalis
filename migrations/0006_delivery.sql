CREATE TABLE delivery_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 full_name TEXT NOT NULL DEFAULT '', whatsapp TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 CHECK((latitude IS NULL) = (longitude IS NULL))
);
ALTER TABLE settings ADD COLUMN shipping_mode TEXT NOT NULL DEFAULT 'fixed' CHECK(shipping_mode IN ('fixed','dynamic'));
ALTER TABLE settings ADD COLUMN store_latitude REAL CHECK(store_latitude BETWEEN -90 AND 90);
ALTER TABLE settings ADD COLUMN store_longitude REAL CHECK(store_longitude BETWEEN -180 AND 180);
ALTER TABLE settings ADD COLUMN rate_per_km INTEGER CHECK(rate_per_km >= 0);
ALTER TABLE settings ADD COLUMN max_distance_km REAL CHECK(max_distance_km > 0);
ALTER TABLE orders ADD COLUMN latitude REAL;
ALTER TABLE orders ADD COLUMN longitude REAL;
ALTER TABLE orders ADD COLUMN shipping_snapshot TEXT;
