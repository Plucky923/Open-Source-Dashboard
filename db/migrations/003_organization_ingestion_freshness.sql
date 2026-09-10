\encoding UTF8
\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';

BEGIN;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS last_ingestion_completed_at TIMESTAMPTZ;

COMMIT;
