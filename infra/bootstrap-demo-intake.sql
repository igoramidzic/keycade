-- Explicit one-time hosted demo configuration, separate from schema migrations
-- and the full local fixture seed. Safe to repeat; existing rows are not updated.
BEGIN;

INSERT INTO banks (id, slug, name, synthetic)
VALUES ('10000000-0000-4000-8000-000000000001', 'bank-a', 'Synthetic Bank A', true)
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM banks WHERE slug = 'bank-a' AND synthetic) THEN
    RAISE EXCEPTION 'Demo intake requires a synthetic bank-a; no changes applied';
  END IF;
END $$;

INSERT INTO loan_products
  (id, bank_id, slug, name, version, minimum_amount, maximum_amount, currency, active, synthetic)
SELECT '50000000-0000-4000-8000-000000000001', id, 'business-credit',
  'Synthetic Business Credit', 1, 10000, 7500000, 'USD', true, true
FROM banks WHERE slug = 'bank-a' AND synthetic
ON CONFLICT (bank_id, slug, version) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM loan_products p JOIN banks b ON b.id = p.bank_id
    WHERE b.slug = 'bank-a' AND p.slug = 'business-credit' AND p.active AND p.synthetic
  ) THEN
    RAISE EXCEPTION 'Demo intake requires active synthetic business-credit; no changes applied';
  END IF;
END $$;

COMMIT;
