import fs from 'fs';
import * as csv from 'fast-csv';

export const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
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
    });
};