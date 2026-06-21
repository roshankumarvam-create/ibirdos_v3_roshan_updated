-- Migration: add purchase/base unit tracking columns to ingredients
-- Items 6, 7, 10: keep vendor units exactly; track reorder quantity in purchase units
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS purchase_unit TEXT;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS purchase_qty DECIMAL(14,4);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS base_unit TEXT;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS base_qty DECIMAL(14,4);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS reorder_qty DECIMAL(14,4);
