import express from 'express';
import pool from './src/db/db.js';
import authRoutes from './working-routes/auth.js';
import complaintRoutes from './working-routes/complaint.js';
import outpassRoutes from './working-routes/outpass.js';

const app = express();
const port = process.env.PORT || 4000;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, role, token');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json());
app.use('/auth', authRoutes);
app.use('/complaint', complaintRoutes);
app.use('/outpass', outpassRoutes);

app.get('/', (req, res) => {
    res.send('Hello World!');
});



app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});