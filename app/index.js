import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import connectDB from './db/connectDB.js';
import sumsubRoutes from './routes/sumsubRoutes.js';

dotenv.config();

const app = express();

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sumsub', sumsubRoutes);

// Error handler (keep last)
app.use(errorHandler);

// Connect to DB
connectDB();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
