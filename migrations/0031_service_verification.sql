-- Service verification authority belongs to a revocable credential, not the
-- service's fixed member role or its password. Older code still rejects services.
ALTER TABLE credentials ADD COLUMN purpose TEXT NOT NULL DEFAULT 'interactive' CHECK(purpose IN ('interactive','verification'));
ALTER TABLE credentials ADD COLUMN parent_id TEXT REFERENCES credentials(id);
CREATE INDEX credentials_parent ON credentials(parent_id);
DROP TRIGGER service_identity_no_credentials;
DROP TRIGGER service_identity_no_credential_rebind;
CREATE TRIGGER credential_subject_scope BEFORE INSERT ON credentials
 WHEN NOT EXISTS(SELECT 1 FROM members m WHERE m.id=NEW.member_id AND (
  (m.identity_kind='human' AND NEW.purpose='interactive' AND NEW.parent_id IS NULL) OR
  (m.identity_kind='service' AND NEW.purpose='verification' AND (
   (NEW.parent_id IS NULL AND NEW.kind='mcp') OR EXISTS(
    SELECT 1 FROM credentials p WHERE p.id=NEW.parent_id AND p.member_id=NEW.member_id
     AND p.kind='mcp' AND p.purpose='verification' AND p.parent_id IS NULL
     AND p.revoked_at IS NULL AND p.auth_epoch=NEW.auth_epoch AND NEW.expires_at<=p.expires_at
   )
  ))
 ))
 BEGIN SELECT RAISE(ABORT,'credential subject scope mismatch'); END;
CREATE TRIGGER credential_authority_immutable BEFORE UPDATE ON credentials
 WHEN NEW.member_id<>OLD.member_id OR NEW.kind<>OLD.kind OR NEW.purpose<>OLD.purpose
  OR NEW.parent_id IS NOT OLD.parent_id OR NEW.auth_epoch<>OLD.auth_epoch
  OR (OLD.purpose='verification' AND (NEW.hash<>OLD.hash OR NEW.expires_at<>OLD.expires_at))
 BEGIN SELECT RAISE(ABORT,'credential authority is immutable; issue a new credential'); END;
ALTER TABLE commands ADD COLUMN operation TEXT;
ALTER TABLE commands ADD COLUMN credential_id TEXT;
ALTER TABLE commands ADD COLUMN execution_purpose TEXT NOT NULL DEFAULT 'interactive' CHECK(execution_purpose IN ('interactive','verification'));
ALTER TABLE mcp_calls ADD COLUMN execution_purpose TEXT NOT NULL DEFAULT 'interactive' CHECK(execution_purpose IN ('interactive','verification'));
