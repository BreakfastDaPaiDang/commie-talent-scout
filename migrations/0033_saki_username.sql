-- Preserve the identity anchor and every credential/history reference.
UPDATE members SET username='saki-hr',version=version+1
WHERE id='00000000-0000-4000-8000-000000000083' AND identity_kind='service' AND username='zaoji-hr';
UPDATE service_subjects SET service_key='saki-hr'
WHERE id='00000000-0000-4000-8000-000000000083' AND service_key='zaoji-hr';
INSERT INTO service_subject_events(id,subject_id,kind,after_json,created_at)
SELECT 'saki-account-renamed-0033',id,'member.profile_changed',
 json_object('previous_username','zaoji-hr','username','saki-hr','origin','migration:0033'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM service_subjects WHERE id='00000000-0000-4000-8000-000000000083' AND service_key='saki-hr';
