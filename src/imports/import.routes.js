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
  const allowedMimeTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file format. Please upload CSV, XLS, or XLSX.'));
  }
};

const upload = multer({ storage, fileFilter });

router.post('/students/upload', upload.single('file'), uploadStudentCSV);
router.post('/students/confirm', confirmStudentCSV);

export default router;