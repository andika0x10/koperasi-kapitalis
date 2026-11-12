-- Keep activation/reset state while independently blocking customer access.
ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0 CHECK(is_blocked IN (0,1) AND (is_blocked=0 OR role='buyer'));
DROP TRIGGER protect_running_product;
DROP TRIGGER reserve_stock;
DROP TRIGGER release_stock;
DROP TRIGGER valid_order_transition;
DROP TRIGGER record_transition;
-- Rebuild orders and their children to extend the status constraint safely.
CREATE TABLE orders_v7 (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 buyer_username TEXT NOT NULL, checkout_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','review','approved','rejected','expired','cancelled','shipped','completed')),
 recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
 subtotal INTEGER NOT NULL, shipping_fee INTEGER NOT NULL, total INTEGER NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('bank','qris')), payment_snapshot TEXT NOT NULL,
 proof_id TEXT UNIQUE REFERENCES attachments(id), reason TEXT, courier TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, proof_at INTEGER, decided_at INTEGER,
 shipped_at INTEGER, completed_at INTEGER, event_actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 latitude REAL, longitude REAL, shipping_snapshot TEXT,
 UNIQUE(user_id,checkout_key)
);
INSERT INTO orders_v7 SELECT * FROM orders;
CREATE TABLE order_items_v7 (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders_v7(id), product_id TEXT NOT NULL,
 name TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), UNIQUE(order_id,product_id)
);
INSERT INTO order_items_v7 SELECT * FROM order_items;
CREATE TABLE order_events_v7 (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders_v7(id), actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL, actor_username TEXT
);
INSERT INTO order_events_v7 SELECT * FROM order_events;
DROP TABLE order_events;
DROP TABLE order_items;
DROP TABLE orders;
ALTER TABLE orders_v7 RENAME TO orders;
ALTER TABLE order_items_v7 RENAME TO order_items;
ALTER TABLE order_events_v7 RENAME TO order_events;
CREATE INDEX orders_buyer ON orders(user_id,created_at DESC);
CREATE INDEX orders_expiry ON orders(status,expires_at);
CREATE INDEX items_product ON order_items(product_id);
CREATE INDEX events_order ON order_events(order_id,created_at);
CREATE TRIGGER protect_running_product BEFORE DELETE ON products BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=OLD.id AND o.status NOT IN ('completed','rejected','expired','cancelled')) THEN RAISE(ABORT,'PRODUCT_HAS_RUNNING_ORDERS') END;
END;
CREATE TRIGGER reserve_stock BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND stock>=NEW.quantity) THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
 UPDATE products SET stock=stock-NEW.quantity,revision=revision+1 WHERE id=NEW.product_id;
END;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status AND NEW.status IN ('rejected','expired','cancelled') BEGIN
 UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=NEW.id AND product_id=products.id),revision=revision+1 WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
CREATE TRIGGER valid_order_transition BEFORE UPDATE OF status ON orders WHEN NEW.status<>OLD.status BEGIN
 SELECT CASE WHEN NOT ((OLD.status='pending' AND NEW.status IN ('review','expired','cancelled')) OR (OLD.status='review' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='shipped') OR (OLD.status='shipped' AND NEW.status='completed')) THEN RAISE(ABORT,'INVALID_TRANSITION') END;
END;
CREATE TRIGGER record_transition AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO order_events(id,order_id,actor_id,actor_username,status,note,created_at) VALUES(lower(hex(randomblob(16))),NEW.id,CASE WHEN NEW.status='expired' THEN NULL ELSE NEW.event_actor_id END,CASE WHEN NEW.status='expired' THEN 'Sistem' ELSE (SELECT username FROM users WHERE id=NEW.event_actor_id) END,NEW.status,CASE WHEN NEW.status IN ('approved','rejected','cancelled') THEN NEW.reason ELSE NULL END,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
