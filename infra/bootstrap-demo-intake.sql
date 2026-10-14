-- Explicit one-time hosted demo configuration, separate from schema migrations
-- and the full local fixture seed. Safe to repeat; existing rows are not updated.
BEGIN;

INSERT INTO banks (id, slug, name, synthetic)
VALUES ('10000000-0000-4000-8000-000000000001', 'keybank', 'Keybank', true)
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM banks WHERE slug = 'keybank' AND synthetic) THEN
    RAISE EXCEPTION 'Demo intake requires a synthetic keybank; no changes applied';
  END IF;
END $$;

INSERT INTO loan_products
  (id, bank_id, slug, name, version, minimum_amount, maximum_amount, currency, active, synthetic)
SELECT '50000000-0000-4000-8000-000000000001', id, 'business-credit',
  'Synthetic Business Credit', 1, 10000, 7500000, 'USD', true, true
FROM banks WHERE slug = 'keybank' AND synthetic
ON CONFLICT (bank_id, slug, version) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM loan_products p JOIN banks b ON b.id = p.bank_id
    WHERE b.slug = 'keybank' AND p.slug = 'business-credit' AND p.active AND p.synthetic
  ) THEN
    RAISE EXCEPTION 'Demo intake requires active synthetic business-credit; no changes applied';
  END IF;
END $$;

-- Version 1 financing product policies, identical to migration 0026 for existing banks.
INSERT INTO financing_product_policies
  (bank_id, family, variant, version, security, minimum_principal, maximum_principal,
   minimum_basis, maximum_basis, aggregate_maximum, aggregate_basis, catalog_version,
   effective_on, expires_on, review_due_on, sources, configuration_note, active, synthetic)
SELECT b.id, p.family, p.variant, p.version, p.security, p.minimum_principal, p.maximum_principal,
  p.minimum_basis, p.maximum_basis, p.aggregate_maximum, p.aggregate_basis, p.catalog_version,
  p.effective_on, p.expires_on, p.review_due_on, p.sources, p.configuration_note, true, true
FROM banks b CROSS JOIN (VALUES
  ('sba_7a'::text, 'sba_7a_standard'::text, 1::integer, NULL::text, '350000.01'::numeric, '5000000.00'::numeric, 'program_restriction'::text, 'program_restriction'::text, '5000000.00'::numeric, 'fixture_assumption'::text, '2026-10-12'::text, '2026-10-12'::date, NULL::date, '2027-04-12'::date, '[{"sourceId":"sba-7a","section":"Maximum 7(a) loan amount","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"},{"sourceId":"sba-lenders","section":"7(a) loan program types","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]'::jsonb, 'Synthetic Keybank demo configuration. Individual SBA 7(a) limits follow the cited SBA pages as reviewed on 2026-10-12; the package-level 7(a) total is a conservative demo assumption pending exposure review. This is not an SBA eligibility determination.'::text),
  ('sba_7a', 'sba_7a_small', 1, NULL, '10000.00', '350000.00', 'bank_policy', 'program_restriction', '5000000.00', 'fixture_assumption', '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"sba-lenders","section":"7(a) Small loans","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"},{"sourceId":"sba-7a","section":"Maximum 7(a) loan amount","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Individual SBA 7(a) limits follow the cited SBA pages as reviewed on 2026-10-12; the package-level 7(a) total is a conservative demo assumption pending exposure review. This is not an SBA eligibility determination.'),
  ('conventional_term', 'conventional_term_unsecured', 1, 'unsecured', '10000.00', '1000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-small","section":"Business term loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.'),
  ('conventional_term', 'conventional_term_secured', 1, 'secured', '10000.00', '25000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-small","section":"Business term loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.'),
  ('equipment_term', 'equipment_term', 1, NULL, '10000.00', '10000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-equipment","section":"Equipment loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.')
) AS p(family, variant, version, security, minimum_principal, maximum_principal, minimum_basis, maximum_basis, aggregate_maximum, aggregate_basis, catalog_version, effective_on, expires_on, review_due_on, sources, configuration_note)
WHERE b.slug = 'keybank' AND b.synthetic
ON CONFLICT (bank_id, variant, version) DO NOTHING;

COMMIT;
