-- Run after bootstrap-demo-intake.sql against the intended synthetic hosted database.
-- Add only the named demo officer. Never overwrite users or restore revoked membership.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM banks WHERE slug = 'bank-a' AND synthetic) THEN
    RAISE EXCEPTION 'Synthetic bank-a is required; no changes applied';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = 'officer-a@example.test' AND NOT synthetic) THEN
    RAISE EXCEPTION 'Demo officer collides with a non-synthetic identity; no changes applied';
  END IF;
END $$;

INSERT INTO users (id, email, display_name, email_verified_at, synthetic)
VALUES ('20000000-0000-4000-8000-000000000002', 'officer-a@example.test', 'Synthetic Officer A', now(), true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO bank_memberships (bank_id, user_id, role, synthetic)
SELECT b.id, u.id, 'admin', true
FROM banks b CROSS JOIN users u
WHERE b.slug = 'bank-a' AND b.synthetic AND u.email = 'officer-a@example.test' AND u.synthetic
ON CONFLICT (bank_id, user_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bank_memberships m
    JOIN users u ON u.id = m.user_id JOIN banks b ON b.id = m.bank_id
    WHERE b.slug = 'bank-a' AND u.email = 'officer-a@example.test' AND NOT m.synthetic
  ) THEN
    RAISE EXCEPTION 'Existing staff membership is not synthetic; no changes applied';
  END IF;
END $$;

COMMIT;
