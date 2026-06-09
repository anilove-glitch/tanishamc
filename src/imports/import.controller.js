import * as importService from './import.service.js';

export const uploadStudentCSV = async (req, res, next) => {
    try{
        const result = await importService.processStudentCSV(req.file.path);
        res.json(result);
    }
    catch(err){
        next(err);
    }
};