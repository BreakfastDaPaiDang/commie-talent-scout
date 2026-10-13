-- Additive availability flag; keeps legacy member_status CHECK and code rollback compatible.
ALTER TABLE archives ADD COLUMN member_work_paused INTEGER NOT NULL DEFAULT 0 CHECK(member_work_paused IN (0,1));
