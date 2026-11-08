DROP INDEX one_seller;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE orders ADD COLUMN event_actor_id TEXT REFERENCES users(id);
ALTER TABLE order_events ADD COLUMN actor_username TEXT;
ALTER TABLE audit_log ADD COLUMN actor_username TEXT;
ALTER TABLE audit_log ADD COLUMN target_type TEXT;
ALTER TABLE audit_log ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN details TEXT;
CREATE INDEX audit_created ON audit_log(created_at DESC,id DESC);
CREATE INDEX audit_actor ON audit_log(actor_id,created_at DESC);
CREATE INDEX audit_action ON audit_log(action,created_at DESC);
CREATE TRIGGER protect_last_seller BEFORE UPDATE OF deleted_at ON users
WHEN OLD.role='seller' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE role='seller' AND deleted_at IS NULL AND id<>OLD.id)
 THEN RAISE(ABORT,'LAST_SELLER') END;
END;
DROP TRIGGER record_transition;
CREATE TRIGGER record_transition AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO order_events(id,order_id,actor_id,actor_username,status,note,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,CASE WHEN NEW.status='expired' THEN NULL ELSE NEW.event_actor_id END,
 CASE WHEN NEW.status='expired' THEN 'Sistem' ELSE (SELECT username FROM users WHERE id=NEW.event_actor_id) END,
 NEW.status,CASE WHEN NEW.status IN ('approved','rejected') THEN NEW.reason ELSE NULL END,
 CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
