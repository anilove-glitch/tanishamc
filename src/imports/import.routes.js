import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { uploadStudentCSV, confirmStudentCSV } from './import.controller.js';

const router = express.Router();

const tempDir = 'uploads/temp/';
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: tempDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.csv', '.xls', '.xlsx'];
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file format. Please upload a .csv, .xls, or .xlsx file.'));
  }
};

const upload = multer({ storage, fileFilter });

router.post('/students/upload', upload.single('file'), uploadStudentCSV);
router.post('/students/confirm', confirmStudentCSV);

export default router;