-- Patch handle_primary_applicant_leave:
-- Do NOT auto-delete groups in terminal states (PENALIZED, SHATTERED, ALLOCATED).
-- These are managed exclusively by the engine.

CREATE OR REPLACE FUNCTION handle_primary_applicant_leave()
RETURNS TRIGGER AS $$
DECLARE
    v_new_primary INTEGER;
    v_group_status group_status_enum;
BEGIN

    IF TG_OP = 'DELETE'
       OR (
            TG_OP = 'UPDATE'
            AND OLD.group_id IS DISTINCT FROM NEW.group_id
       ) THEN

        IF OLD.group_id IS NOT NULL THEN

            -- Do not auto-dissolve terminal-state groups.
            -- PENALIZED / SHATTERED / ALLOCATED groups are managed
            -- exclusively by the engine and must not be auto-deleted.
            SELECT status INTO v_group_status
            FROM housing_groups WHERE id = OLD.group_id;

            IF v_group_status IN ('PENALIZED', 'SHATTERED', 'ALLOCATED') THEN
                RETURN NULL;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM housing_groups
                WHERE id = OLD.group_id
                  AND primary_applicant_id = OLD.id
            ) THEN

                SELECT id
                INTO v_new_primary
                FROM students
                WHERE group_id = OLD.group_id
                  AND id <> OLD.id
                ORDER BY individual_rank ASC
                LIMIT 1;

                IF v_new_primary IS NOT NULL THEN

                    UPDATE housing_groups
                    SET primary_applicant_id = v_new_primary
                    WHERE id = OLD.group_id;

                ELSE

                    DELETE FROM housing_groups
                    WHERE id = OLD.group_id;

                END IF;

            END IF;

        END IF;

    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
