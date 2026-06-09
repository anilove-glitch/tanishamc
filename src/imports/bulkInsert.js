import { SUPPORTED_FIELDS } from './fieldMapper.js';

/**
 * Bulk inserts validated students using parameterized chunks.
 * Must be executed within an existing transaction on the provided client.
 * 
 * @param {import('pg').PoolClient} client 
 * @param {Array<Record<string, any>>} rows 
 * @returns {number} The total count of inserted rows
 */
export const insertStudents = async (client, rows) => {
    if (!rows || rows.length === 0) return 0;

    const CHUNK_SIZE = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        
        // We will insert all SUPPORTED_FIELDS in order
        const columns = SUPPORTED_FIELDS.join(', ');
        const values = [];
        const placeholders = [];

        let paramIndex = 1;

        chunk.forEach((row, rowIndex) => {
            const rowPlaceholders = [];
            
            SUPPORTED_FIELDS.forEach((field) => {
                let val = row[field];
                // Handle undefined/empty strings that should be NULL
                if (val === undefined || val === '') val = null;
                
                values.push(val);
                rowPlaceholders.push(`$${paramIndex}`);
                paramIndex++;
            });

            placeholders.push(`(${rowPlaceholders.join(', ')})`);
        });

        const query = `
            INSERT INTO student (${columns})
            VALUES ${placeholders.join(', ')}
        `;

        const result = await client.query(query, values);
        totalInserted += result.rowCount;
    }

    return totalInserted;
};
