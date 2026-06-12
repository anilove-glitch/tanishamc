import * as importService from './import.service.js';

export const uploadStudentCSV = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded." });
        }
        const result = await importService.previewImport(req.file.path, req.file.filename);
        res.json(result);
    } catch (err) {
        next(err);
    }
};

export const confirmStudentCSV = async (req, res, next) => {
    try {
        const { fileId, mappings, hostelId } = req.body;
        
        if (!fileId || !mappings || !hostelId) {
            return res.status(400).json({ success: false, message: "fileId, mappings, and hostelId are required." });
        }

        const result = await importService.executeImport(fileId, mappings, hostelId);
        res.json(result);
    } catch (err) {
        next(err);
    }
};