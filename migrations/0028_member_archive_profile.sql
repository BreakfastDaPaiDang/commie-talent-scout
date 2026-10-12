-- Additive only: historical identity/closure corrections require a separate review.
-- NULL identity reads through the legacy personnel status without rewriting history.
ALTER TABLE archives ADD COLUMN person_role TEXT CHECK(person_role IN ('external','member'));
ALTER TABLE archives ADD COLUMN member_status TEXT CHECK(member_status IN ('可接工作','请假','失联'));
CREATE INDEX archives_person_role ON archives(type,person_role,deleted,closed);
