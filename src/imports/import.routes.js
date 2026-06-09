import express from 'express';
import multer from 'multer';

import {uploadStudentCSV} from './import.controller.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/temp/' }); 

router.post('/students/upload', upload.single('file'), uploadStudentCSV);

export default router;