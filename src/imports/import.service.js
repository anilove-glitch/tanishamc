import { parseFile } from './fileParser.js';
import { detectMappings, SUPPORTED_FIELDS } from './fieldMapper.js';
import { validateRows } from './validators.js';
import { insertStudents } from './bulkInsert.js';
import pool from '../db/pool.js';
import path from 'path';

/**
 * Step 1: Preview Import
 * Parses headers, auto-maps them, and returns a preview response.
 */
export const previewImport = async (filePath, filename) => {
    const { headers, rows } = await parseFile(filePath, filename);
    
    if (!headers || headers.length === 0) {
        throw new Error("File does not contain headers.");
    }
    
    const { detectedMappings, unmappedFields, unmappedColumns } = detectMappings(headers);

    return {
        fileId: filename,
        headers,
        rowCount: rows.length,
        detectedMappings,
        unmappedFields,
        unmappedColumns
    };
};

/**
 * Step 2: Execute Import
 * Transforms CSV rows according to mappings, validates, and bulk inserts.
 */
export const executeImport = async (fileId, mappings, globalHostelId) => {
    // Determine path based on Multer's default relative path structure
    const filePath = path.join(process.cwd(), 'uploads', 'temp', fileId);
    
    let csvResult;
    try {
        // fileId contains the extension now, so parseFile can detect it
        csvResult = await parseFile(filePath, fileId);
    } catch (err) {
        throw new Error("Temporary file not found or could not be parsed. Please re-upload.");
    }
    
    const { rows } = csvResult;
    
    // Transform rows
    const transformedRows = rows.map((row, index) => {
        const student = { _csvRowIndex: index + 1 }; // 1-based for human reading
        for (const [dbField, csvColumn] of Object.entries(mappings)) {
            if (SUPPORTED_FIELDS.includes(dbField) && csvColumn) {
                student[dbField] = row[csvColumn] || null;
            }
        }
        // Force the hostel_id to the one selected by the Warden
        student.hostel_id = globalHostelId;
        return student;
    });

    // Validate
    const { validRows, failedRows } = await validateRows(transformedRows, pool);

    let insertedCount = 0;
    
    // Bulk Insert
    if (validRows.length > 0) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            insertedCount = await insertStudents(client, validRows);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw new Error("Bulk insert failed: " + error.message);
        } finally {
            client.release();
        }
    }

    return {
        success: true,
        insertedCount,
        failedRows,
        skippedRows: failedRows.length
    };
};