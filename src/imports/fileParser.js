import fs from 'fs';
import path from 'path';
import * as csv from 'fast-csv';
import xlsx from 'xlsx';

export const parseFile = (filePath, originalName) => {
    return new Promise((resolve, reject) => {
        const ext = path.extname(originalName || filePath).toLowerCase();

        if (ext === '.csv') {
            const rows = [];
            let headers = [];

            fs.createReadStream(filePath)
                .pipe(csv.parse({ headers: true, trim: true }))
                .on('error', reject)
                .on('headers', (headerList) => {
                    headers = headerList;
                })
                .on('data', (row) => {
                    rows.push(row);
                })
                .on('end', () => {
                    resolve({ headers, rows });
                });
        } else if (ext === '.xls' || ext === '.xlsx') {
            try {
                // Read the file using xlsx
                const workbook = xlsx.readFile(filePath);
                
                // Read only the first sheet
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convert sheet to JSON array
                const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                if (rawData.length === 0) {
                    return resolve({ headers: [], rows: [] });
                }

                // First row is headers
                let headers = rawData[0] || [];
                // Trim header strings
                headers = headers.map(h => h ? String(h).trim() : '');

                const rows = [];
                // Start from index 1 to skip headers
                for (let i = 1; i < rawData.length; i++) {
                    const rowArray = rawData[i];
                    // Skip empty rows
                    if (!rowArray || rowArray.length === 0 || rowArray.every(cell => cell === null || cell === '')) continue;
                    
                    const rowObj = {};
                    headers.forEach((header, colIndex) => {
                        let val = rowArray[colIndex];
                        if (typeof val === 'string') {
                            val = val.trim();
                        }
                        rowObj[header] = val;
                    });
                    rows.push(rowObj);
                }

                resolve({ headers, rows });
            } catch (err) {
                reject(err);
            }
        } else {
            reject(new Error(`Unsupported file extension: ${ext}`));
        }
    });
};