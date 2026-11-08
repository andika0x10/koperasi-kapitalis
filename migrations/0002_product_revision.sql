ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER reserve_stock;
DROP TRIGGER release_stock;
CREATE TRIGGER reserve_stock BEFORE INSERT ON order_items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived=0 AND stock>=NEW.quantity)
 THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
 UPDATE products SET stock=stock-NEW.quantity,revision=revision+1 WHERE id=NEW.product_id;
END;
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders
WHEN OLD.status<>NEW.status AND NEW.status IN ('rejected','expired') BEGIN
 UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=NEW.id AND product_id=products.id),revision=revision+1
 WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;
