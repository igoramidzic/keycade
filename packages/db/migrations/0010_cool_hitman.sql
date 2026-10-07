ALTER TABLE "application_tasks" ADD COLUMN "assignee_generation_at" timestamp with time zone;--> statement-breakpoint
-- Preserve only assignments that were demonstrably issued after the retained revocation marker.
-- Historical or same-clock ambiguous assignments must not regain authority during an upgrade.
UPDATE application_tasks AS task
SET assignee_generation_at = participant.unassigned_at
FROM application_participants AS participant
WHERE task.assignee_participant_id = participant.id
  AND task.bank_id = participant.bank_id
  AND task.application_id = participant.application_id
  AND participant.revoked_at IS NULL
  AND participant.unassigned_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM task_assignments AS assignment
    WHERE assignment.task_id = task.id
      AND assignment.participant_id = participant.id
      AND assignment.created_at > participant.unassigned_at
  );
