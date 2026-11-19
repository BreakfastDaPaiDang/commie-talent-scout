-- Give reviews that are open at migration a full seven-day voting period.
ALTER TABLE kw_merges ADD COLUMN expires_at TEXT;
UPDATE kw_merges SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days') WHERE state='open';
