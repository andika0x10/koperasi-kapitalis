-- Forward-only rebuild: preserve snapshots while allowing physical deletion.
-- Fail before changing data when an archived product has a running order.
CREATE TABLE migration_guard (value INTEGER);
CREATE TRIGGER archived_orders_guard BEFORE INSERT ON migration_guard BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM products p JOIN order_items i ON i.product_id=p.id JOIN orders o ON o.id=i.order_id WHERE p.archived=1 AND o.status NOT IN ('completed','rejected','expired')) THEN RAISE(ABORT,'ARSIP_MASIH_MEMILIKI_PESANAN_BERJALAN: selesaikan pesanan sebelum migrasi') END;
END;
INSERT INTO migration_guard VALUES(1);
DROP TABLE migration_guard;
DROP TRIGGER protect_last_seller;
DROP TRIGGER reserve_stock;
DROP TRIGGER release_stock;
DROP TRIGGER valid_order_transition;
DROP TRIGGER record_transition;

CREATE TABLE users_v5 (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('buyer','staff','owner')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','reset_required')),
 created_at INTEGER NOT NULL,
 CHECK((status='active' AND password_hash IS NOT NULL) OR (status<>'active' AND password_hash IS NULL))
);
INSERT INTO users_v5 SELECT id,username,CASE WHEN must_change_password=0 THEN password_hash ELSE NULL END,CASE role WHEN 'seller' THEN 'staff' ELSE role END,CASE WHEN must_change_password=0 THEN 'active' ELSE 'reset_required' END,created_at FROM users WHERE deleted_at IS NULL;
CREATE TABLE sessions_v5 (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users_v5(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
 csrf TEXT NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
INSERT INTO sessions_v5 SELECT s.* FROM sessions s JOIN users_v5 u ON u.id=s.user_id WHERE u.status='active';
CREATE TABLE attachments_v5 (
 id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users_v5(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('product','qris','proof')), mime TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes<=1500000), checksum TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL
);
INSERT INTO attachments_v5 SELECT a.id,u.id,a.kind,a.mime,a.bytes,a.checksum,a.data,a.created_at FROM attachments a LEFT JOIN users_v5 u ON u.id=a.owner_id;
CREATE TABLE products_v5 (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
 unit TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0), stock INTEGER NOT NULL CHECK(stock>=0),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO products_v5 SELECT id,name,description,category,unit,price,stock,created_at,updated_at,revision FROM products WHERE archived=0;
CREATE TABLE product_photos_v5 (
 product_id TEXT NOT NULL REFERENCES products_v5(id) ON DELETE CASCADE,
 attachment_id TEXT NOT NULL REFERENCES attachments_v5(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
 PRIMARY KEY(product_id,position), UNIQUE(product_id,attachment_id)
);
INSERT INTO product_photos_v5 SELECT id,photo_id,0 FROM products WHERE archived=0 AND photo_id IS NOT NULL;
CREATE TABLE cart_items_v5 (
 user_id TEXT NOT NULL REFERENCES users_v5(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products_v5(id) ON DELETE CASCADE,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999), PRIMARY KEY(user_id,product_id)
);
INSERT INTO cart_items_v5 SELECT c.* FROM cart_items c JOIN users_v5 u ON u.id=c.user_id JOIN products_v5 p ON p.id=c.product_id;
CREATE TABLE settings_v5 (
 id INTEGER PRIMARY KEY CHECK(id=1), shipping_fee INTEGER CHECK(shipping_fee>=0),
 bank_name TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '', bank_holder TEXT NOT NULL DEFAULT '',
 qris_id TEXT REFERENCES attachments_v5(id)
);
INSERT INTO settings_v5 SELECT * FROM settings;
CREATE TABLE orders_v5 (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users_v5(id) ON DELETE SET NULL,
 buyer_username TEXT NOT NULL, checkout_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','review','approved','rejected','expired','shipped','completed')),
 recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
 subtotal INTEGER NOT NULL, shipping_fee INTEGER NOT NULL, total INTEGER NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('bank','qris')), payment_snapshot TEXT NOT NULL,
 proof_id TEXT UNIQUE REFERENCES attachments_v5(id), reason TEXT, courier TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, proof_at INTEGER, decided_at INTEGER,
 shipped_at INTEGER, completed_at INTEGER, event_actor_id TEXT REFERENCES users_v5(id) ON DELETE SET NULL,
 UNIQUE(user_id,checkout_key)
);
INSERT INTO orders_v5 SELECT o.id,live.id,u.username,o.checkout_key,o.status,o.recipient,o.phone,o.address,o.subtotal,o.shipping_fee,o.total,o.payment_method,o.payment_snapshot,o.proof_id,o.reason,o.courier,o.created_at,o.expires_at,o.proof_at,o.decided_at,o.shipped_at,o.completed_at,actor.id FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN users_v5 live ON live.id=o.user_id LEFT JOIN users_v5 actor ON actor.id=o.event_actor_id;
-- product_id is a historical identifier, deliberately independent of the catalog.
CREATE TABLE order_items_v5 (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders_v5(id), product_id TEXT NOT NULL,
 name TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), UNIQUE(order_id,product_id)
);
INSERT INTO order_items_v5 SELECT * FROM order_items;
CREATE TABLE order_events_v5 (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders_v5(id), actor_id TEXT REFERENCES users_v5(id) ON DELETE SET NULL,
 status TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL, actor_username TEXT
);
INSERT INTO order_events_v5 SELECT e.id, e.order_id,live.id,e.status,e.note,e.created_at,COALESCE(e.actor_username,u.username,'Sistem') FROM order_events e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN users_v5 live ON live.id=e.actor_id;
CREATE TABLE audit_log_v5 (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users_v5(id) ON DELETE SET NULL,
 action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL, actor_username TEXT,
 target_type TEXT, outcome TEXT NOT NULL DEFAULT 'success', details TEXT
);
INSERT INTO audit_log_v5 SELECT a.id,live.id,a.action,a.target_id,a.created_at,COALESCE(a.actor_username,u.username,'Sistem'),a.target_type,a.outcome,a.details FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users_v5 live ON live.id=a.actor_id;

DROP TABLE order_events;
DROP TABLE order_items;
DROP TABLE audit_log;
DROP TABLE orders;
DROP TABLE cart_items;
DROP TABLE settings;
DROP TABLE products;
DROP TABLE attachments;
DROP TABLE sessions;
DROP TABLE users;
ALTER TABLE users_v5 RENAME TO users;
ALTER TABLE sessions_v5 RENAME TO sessions;
ALTER TABLE attachments_v5 RENAME TO attachments;
ALTER TABLE products_v5 RENAME TO products;
ALTER TABLE product_photos_v5 RENAME TO product_photos;
ALTER TABLE cart_items_v5 RENAME TO cart_items;
ALTER TABLE settings_v5 RENAME TO settings;
ALTER TABLE orders_v5 RENAME TO orders;
ALTER TABLE order_items_v5 RENAME TO order_items;
ALTER TABLE order_events_v5 RENAME TO order_events;
ALTER TABLE audit_log_v5 RENAME TO audit_log;
CREATE UNIQUE INDEX one_owner ON users(role) WHERE role='owner';
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX products_catalog ON products(category,name);
CREATE INDEX photos_attachment ON product_photos(attachment_id);
CREATE INDEX orders_buyer ON orders(user_id,created_at DESC);
CREATE INDEX orders_expiry ON orders(status,expires_at);
CREATE INDEX items_product ON order_items(product_id);
CREATE INDEX events_order ON order_events(order_id,created_at);
CREATE INDEX audit_created ON audit_log(created_at DESC,id DESC);
CREATE INDEX audit_actor ON audit_log(actor_id,created_at DESC);
CREATE INDEX audit_action ON audit_log(action,created_at DESC);
CREATE TABLE password_links (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
);
CREATE TABLE password_link_guard (value INTEGER NOT NULL CHECK(value=1));
CREATE TRIGGER protect_owner BEFORE DELETE ON users WHEN OLD.role='owner' BEGIN
 SELECT RAISE(ABORT,'OWNER_CANNOT_BE_DELETED');
END;
CREATE TRIGGER protect_role BEFORE UPDATE OF role ON users WHEN NEW.role<>OLD.role BEGIN
 SELECT RAISE(ABORT,'ROLE_CANNOT_BE_CHANGED');
END;
CREATE TRIGGER protect_running_product BEFORE DELETE ON products BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=OLD.id AND o.status NOT IN ('completed','rejected','expired')) THEN RAISE(ABORT,'PRODUCT_HAS_RUNNING_ORDERS') END;
END;
CREATE TRIGGER reserve_stock BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND stock>=NEW.quantity) THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
 UPDATE products SET stock=stock-NEW.quantity,revision=revision+1 WHERE id=NEW.product_id;
END;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status AND NEW.status IN ('rejected','expired') BEGIN
 UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=NEW.id AND product_id=products.id),revision=revision+1 WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
CREATE TRIGGER valid_order_transition BEFORE UPDATE OF status ON orders WHEN NEW.status<>OLD.status BEGIN
 SELECT CASE WHEN NOT ((OLD.status='pending' AND NEW.status IN ('review','expired')) OR (OLD.status='review' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='shipped') OR (OLD.status='shipped' AND NEW.status='completed')) THEN RAISE(ABORT,'INVALID_TRANSITION') END;
END;
CREATE TRIGGER record_transition AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO order_events(id,order_id,actor_id,actor_username,status,note,created_at) VALUES(lower(hex(randomblob(16))),NEW.id,CASE WHEN NEW.status='expired' THEN NULL ELSE NEW.event_actor_id END,CASE WHEN NEW.status='expired' THEN 'Sistem' ELSE (SELECT username FROM users WHERE id=NEW.event_actor_id) END,NEW.status,CASE WHEN NEW.status IN ('approved','rejected') THEN NEW.reason ELSE NULL END,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
DELETE FROM attachments WHERE kind='product' AND NOT EXISTS(SELECT 1 FROM product_photos WHERE attachment_id=attachments.id);
