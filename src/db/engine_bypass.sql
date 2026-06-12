-- ============================================================
-- engine_bypass.sql
-- ============================================================
-- Patches the prevent_illegal_group_modification trigger to
-- allow the allocation engine to dissolve groups (ghost penalty,
-- shatter protocol) by checking a session-level bypass flag.
--
-- Usage in engine code:
--   SET LOCAL app.bypass_group_lock = 'on';
--   UPDATE students SET group_id = NULL ...;
--
-- This does NOT disable the trigger for normal user operations.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_illegal_group_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_status group_status_enum;
    v_bypass TEXT;
BEGIN
    -- Allow engine to bypass via session variable
    BEGIN
        v_bypass := current_setting('app.bypass_group_lock', true);
    EXCEPTION WHEN OTHERS THEN
        v_bypass := '';
    END;

    IF v_bypass = 'on' THEN
        RETURN NEW;
    END IF;

    IF OLD.group_id IS NOT NULL THEN

        SELECT status
        INTO v_status
        FROM housing_groups
        WHERE id = OLD.group_id;

        IF v_status IN (
            'SOFT_LOCKED',
            'HARD_LOCKED',
            'ALLOCATED'
        ) THEN
            RAISE EXCEPTION
            'Group modifications are forbidden after lock';
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
