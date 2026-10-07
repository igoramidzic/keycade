-- Fixed-product intake: preserve completed applications and their historical product versions.
-- Existing drafts without a business-credit product use their own bank's active default.
WITH defaults AS (
  SELECT DISTINCT ON (bank_id) bank_id, id
  FROM loan_products
  WHERE slug = 'business-credit' AND active = true AND synthetic = true
  ORDER BY bank_id, version DESC
), changed AS (
  UPDATE applications AS a
  SET product_id = CASE WHEN old.slug = 'business-credit' THEN a.product_id ELSE d.id END,
      revision = a.revision + 1,
      updated_at = now()
  FROM application_setups AS s, defaults AS d,
       (SELECT a0.id, p.slug FROM applications a0 LEFT JOIN loan_products p ON p.id = a0.product_id AND p.bank_id = a0.bank_id) AS old
  WHERE s.application_id = a.id AND s.bank_id = a.bank_id
    AND d.bank_id = a.bank_id AND old.id = a.id
    AND a.status = 'draft' AND s.completed_at IS NULL
    AND (old.slug IS DISTINCT FROM 'business-credit' OR s.current_step = 'product')
  RETURNING a.id, a.bank_id, a.revision
)
UPDATE application_setups AS s
SET revision = changed.revision,
    current_step = CASE WHEN s.current_step = 'product' THEN 'amount' ELSE s.current_step END
FROM changed
WHERE s.application_id = changed.id AND s.bank_id = changed.bank_id;
