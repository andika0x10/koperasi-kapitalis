PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('buyer','seller')),
 must_change_password INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_seller ON users(role) WHERE role='seller';
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
 csrf TEXT NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE attachments (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('product','qris','proof')),
 mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes<=1500000), checksum TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
 unit TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0), stock INTEGER NOT NULL CHECK(stock>=0),
 photo_id TEXT REFERENCES attachments(id), archived INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX products_catalog ON products(archived,category);
CREATE TABLE cart_items (
 user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999), PRIMARY KEY(user_id,product_id)
);
CREATE TABLE settings (
 id INTEGER PRIMARY KEY CHECK(id=1), shipping_fee INTEGER CHECK(shipping_fee>=0),
 bank_name TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '', bank_holder TEXT NOT NULL DEFAULT '',
 qris_id TEXT REFERENCES attachments(id)
);
INSERT INTO settings(id) VALUES(1);
CREATE TABLE orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), checkout_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','review','approved','rejected','expired','shipped','completed')),
 recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
 subtotal INTEGER NOT NULL, shipping_fee INTEGER NOT NULL, total INTEGER NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('bank','qris')), payment_snapshot TEXT NOT NULL,
 proof_id TEXT UNIQUE REFERENCES attachments(id), reason TEXT,
 courier TEXT, tracking TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 proof_at INTEGER, decided_at INTEGER, shipped_at INTEGER, completed_at INTEGER,
 UNIQUE(user_id,checkout_key)
);
CREATE INDEX orders_buyer ON orders(user_id,created_at DESC);
CREATE INDEX orders_expiry ON orders(status,expires_at);
CREATE TABLE order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 UNIQUE(order_id,product_id)
);
CREATE TABLE order_events (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), actor_id TEXT REFERENCES users(id),
 status TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX events_order ON order_events(order_id,created_at);
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL
);
-- Database guards also protect stock and state if a request is retried after a DO restart.
CREATE TRIGGER reserve_stock BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived=0 AND stock>=NEW.quantity)
 THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
 UPDATE products SET stock=stock-NEW.quantity WHERE id=NEW.product_id;
END;
CREATE TRIGGER valid_order_transition BEFORE UPDATE OF status ON orders
WHEN NEW.status<>OLD.status BEGIN
 SELECT CASE WHEN NOT (
 (OLD.status='pending' AND NEW.status IN ('review','expired')) OR
 (OLD.status='review' AND NEW.status IN ('approved','rejected')) OR
 (OLD.status='approved' AND NEW.status='shipped') OR
 (OLD.status='shipped' AND NEW.status='completed')
 ) THEN RAISE(ABORT,'INVALID_TRANSITION') END;
END;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders
WHEN OLD.status<>NEW.status AND NEW.status IN ('rejected','expired') BEGIN
 UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=NEW.id AND product_id=products.id)
 WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
CREATE TRIGGER record_transition AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO order_events(id,order_id,actor_id,status,note,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,
 CASE WHEN NEW.status IN ('approved','rejected','shipped','completed') THEN (SELECT id FROM users WHERE role='seller') ELSE NULL END,
 NEW.status,CASE WHEN NEW.status IN ('approved','rejected') THEN NEW.reason ELSE NULL END,
 CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
