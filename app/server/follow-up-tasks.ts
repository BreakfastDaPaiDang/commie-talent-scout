// An explicit follow-up relationship; titles and labels do not establish responsibility.
export const followUpTaskSql="(t.kind IN ('audit','onboarding','monthly') OR t.automation_rule='archive.follow_up' OR EXISTS(SELECT 1 FROM work_overview_followups f WHERE f.task_id=t.id AND f.archive_id=t.archive_id))";
