import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
const auth = async (req, res, next) => {
 const { token, role } = req.headers;
    if (!token || !role) {
        return res.status(400).json({ message: 'Token and role are required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

    }catch (err) {
        
    }
}

export default auth;