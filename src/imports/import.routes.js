import express from 'express';
import multer from 'multer';

import { uploadStudentCSV, confirmStudentCSV } from './import.controller.js';

const router = express.Router();
// IMPORTANT: We need to ensure the uploads/temp directory exists, but multer usually handles this if configured or we can create it.
// Let's rely on backend setup, or we'll make sure it exists.
const upload = multer({ dest: 'uploads/temp/' }); 

router.post('/students/upload', upload.single('file'), uploadStudentCSV);
router.post('/students/confirm', confirmStudentCSV);

export default router;