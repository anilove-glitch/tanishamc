import { parseCSV } from './csvParser.js';

export const processStudentCSV = async (
    filePath
) => {

    const rows = await parseCSV(filePath);

    return {
        success: true,
        rowCount: rows.length,
        sample: rows.slice(0, 5)
    };
};