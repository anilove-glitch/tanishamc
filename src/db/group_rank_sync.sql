-- =========================================================
-- GROUP RANK AUTO-SYNC MIGRATION
-- Run after extensions.sql
-- =========================================================

-- ---------------------------------------------------------
-- 1. Drop validate_submission_leader trigger + function
--    Reason: any group member can now submit (first-wins).
--    The UNIQUE(group_id, batch_id, round_number) constraint
--    atomically enforces first-submission-wins at DB level.
-- ---------------------------------------------------------

DROP TRIGGER  IF EXISTS trigger_validate_submission_leader ON allocation_submissions;
DROP FUNCTION IF EXISTS validate_submission_leader();

-- ---------------------------------------------------------
-- 2. Auto-sync housing_groups.group_rank = leader's
--    individual_rank whenever:
--      a) a group is created (INSERT on housing_groups)
--      b) the leader changes (UPDATE OF primary_applicant_id)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_group_rank_from_leader()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE housing_groups
    SET group_rank = (
        SELECT individual_rank
        FROM students
        WHERE id = NEW.primary_applicant_id
    )
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_group_rank_on_leader_change
AFTER INSERT OR UPDATE OF primary_applicant_id
ON housing_groups
FOR EACH ROW
EXECUTE FUNCTION sync_group_rank_from_leader();

-- ---------------------------------------------------------
-- 3. When a student's individual_rank is set/updated,
--    propagate to their group if they are the leader.
--    This fires during bulk CSV import.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_leader_rank_to_group()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if this student is a primary applicant
    UPDATE housing_groups
    SET group_rank = NEW.individual_rank
    WHERE primary_applicant_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_leader_rank
AFTER UPDATE OF individual_rank
ON students
FOR EACH ROW
WHEN (NEW.individual_rank IS DISTINCT FROM OLD.individual_rank)
EXECUTE FUNCTION sync_leader_rank_to_group();
