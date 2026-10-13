-- Rename the one supported synthetic bank in place. Keep every dependent UUID unchanged.
UPDATE banks SET slug = 'keybank', name = 'Keybank'
WHERE id = '10000000-0000-4000-8000-000000000001' AND synthetic;
--> statement-breakpoint
ALTER FUNCTION keycade_immutable_financial_record() RENAME TO keylend_immutable_financial_record;
