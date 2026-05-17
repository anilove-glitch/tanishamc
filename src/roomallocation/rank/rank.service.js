/**
 * rank.service.js
 * Handles rank ingestion via CSV bulk import.
 *
 * Student ranks are IMMUTABLE after import.
 * No individual rank update API is exposed — only bulk CSV.
 *
 * CSV format expected:
 *   roll_no,rank
 *   22BCS001,1
 *   22BCS002,2
 *   ...
 *
 * The DB trigger `trigger_sync_leader_rank` automatically
 * propagates each rank to housing_groups.group_rank when
 * the student is a group leader.
 */

import pool from '../../db/pool.js';
import ApiError from '../../utils/apiError.js';

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Parse a raw CSV string into [{ roll_no, rank }, ...]
 * Supports comma-separated with optional header row.
 */
function parseRankCsv(csvText) {
    const lines = csvText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    if (lines.length === 0) throw new ApiError(400, 'CSV file is empty');

    // Detect header by checking if first row is non-numeric in the rank column
    const firstParts = lines[0].split(',');
    const hasHeader = isNaN(parseInt(firstParts[1]?.trim()));
    const dataLines = hasHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) throw new ApiError(400, 'CSV has header but no data rows');

    const records = [];
    const parseErrors = [];

    for (let i = 0; i < dataLines.length; i++) {
        const lineNum = hasHeader ? i + 2 : i + 1;
        const parts = dataLines[i].split(',');

        if (parts.length < 2) {
            parseErrors.push(`Line ${lineNum}: expected roll_no,rank — got "${dataLines[i]}"`);
            continue;
        }

        const roll_no = parts[0].trim();
        const rank = parseInt(parts[1].trim(), 10);

        if (!roll_no) {
            parseErrors.push(`Line ${lineNum}: roll_no is empty`);
            continue;
        }
        if (isNaN(rank) || rank < 1) {
            parseErrors.push(`Line ${lineNum}: rank "${parts[1].trim()}" is not a valid positive integer`);
            continue;
        }

        records.push({ roll_no, rank });
    }

    if (parseErrors.length > 0) {
        throw new ApiError(422, 'CSV parsing failed', parseErrors);
    }

    return records;
}

// ─────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────

/**
 * Validate parsed records before touching the DB:
 *  1. No duplicate roll_no in the CSV itself
 *  2. No duplicate rank values in the CSV itself
 *  3. No student already has a rank assigned
 *  4. All roll_nos exist in the students table
 */
async function validateRankRecords(records) {
    const errors = [];

    // 1. Duplicate roll_no in CSV
    const rollSet = new Set();
    const rankSet = new Set();
    for (const { roll_no, rank } of records) {
        if (rollSet.has(roll_no)) errors.push(`Duplicate roll_no in CSV: ${roll_no}`);
        else rollSet.add(roll_no);

        if (rankSet.has(rank)) errors.push(`Duplicate rank in CSV: ${rank}`);
        else rankSet.add(rank);
    }

    if (errors.length > 0) throw new ApiError(422, 'Duplicate entries in CSV', errors);

    // 2. Check all roll_nos exist + no existing ranks
    const rollNos = records.map(r => r.roll_no);
    const dbRes = await pool.query(
        `SELECT roll_no, individual_rank FROM students WHERE roll_no = ANY($1::text[])`,
        [rollNos]
    );

    const foundRollNos = new Set(dbRes.rows.map(r => r.roll_no));
    const alreadyRanked = dbRes.rows.filter(r => r.individual_rank !== null);

    // Missing students
    for (const roll_no of rollNos) {
        if (!foundRollNos.has(roll_no)) {
            errors.push(`Student not found: ${roll_no}`);
        }
    }

    // Already ranked
    if (alreadyRanked.length > 0) {
        errors.push(
            `The following students already have ranks (ranks are immutable): ` +
            alreadyRanked.map(s => `${s.roll_no}(rank=${s.individual_rank})`).join(', ')
        );
    }

    if (errors.length > 0) throw new ApiError(422, 'Rank integrity check failed', errors);
}

// ─────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────

/**
 * Bulk import ranks from a CSV string.
 * Returns a summary of the import.
 *
 * @param {string} csvText - raw CSV content
 * @returns {{ imported: number, skipped: number, details: object[] }}
 */
export const bulkImportRanksFromCsv = async (csvText) => {
    // 1. Parse
    const records = parseRankCsv(csvText);

    // 2. Validate integrity
    await validateRankRecords(records);

    // 3. Bulk update inside a single transaction
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let imported = 0;
        const details = [];

        for (const { roll_no, rank } of records) {
            // individual_rank is UNIQUE — DB enforces no duplicates cross-import too
            const res = await client.query(
                `UPDATE students SET individual_rank = $1 WHERE roll_no = $2 RETURNING id, roll_no, individual_rank`,
                [rank, roll_no]
            );
            if (res.rowCount > 0) {
                imported++;
                details.push({ roll_no, rank, status: 'imported' });
            }
        }

        await client.query('COMMIT');

        return {
            imported,
            total: records.length,
            details,
        };

    } catch (error) {
        await client.query('ROLLBACK');
        // Unique constraint violation = duplicate rank across separate imports
        if (error.code === '23505') {
            throw new ApiError(409, 'Rank conflict: a rank in this CSV is already assigned to a different student');
        }
        throw new ApiError(500, 'Rank import failed: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Preview what would happen on import without writing.
 * Returns validation results only.
 */
export const previewRankImport = async (csvText) => {
    const records = parseRankCsv(csvText);

    const rollNos = records.map(r => r.roll_no);
    const dbRes = await pool.query(
        `SELECT roll_no, individual_rank FROM students WHERE roll_no = ANY($1::text[])`,
        [rollNos]
    );

    const foundRollNos = new Set(dbRes.rows.map(r => r.roll_no));
    const alreadyRankedMap = new Map(
        dbRes.rows.filter(r => r.individual_rank !== null).map(r => [r.roll_no, r.individual_rank])
    );

    return records.map(({ roll_no, rank }) => ({
        roll_no,
        rank,
        studentFound: foundRollNos.has(roll_no),
        alreadyHasRank: alreadyRankedMap.has(roll_no),
        existingRank: alreadyRankedMap.get(roll_no) ?? null,
        willImport: foundRollNos.has(roll_no) && !alreadyRankedMap.has(roll_no),
    }));
};

/**
 * Fetch students who do not yet have a rank assigned.
 */
export const getUnrankedStudents = async () => {
    const result = await pool.query(
        `SELECT id, name, roll_no, cgpa, department
         FROM students
         WHERE individual_rank IS NULL
         ORDER BY cgpa DESC NULLS LAST`
    );
    return result.rows;
};
