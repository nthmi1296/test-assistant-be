import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { connectMongo } from './config/index.js';
import authRouter from './routes/auth.js';
import generationsRouter from './routes/generations.js';
import { logger } from './utils/logger.js';

const app = express();

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));

// Body parser
app.use(express.json({limit: '10mb'}));

// HTTP request logger
app.use(morgan('dev'));

// Health check endpoint
app.get('/serverStatus', (req, res) => {
    res.status(200).json({
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        service: 'Test Assistant BE'
    });
});

// Connect to MongoDB
connectMongo().then(() => {
    logger.info('Connected to MongoDB');
}).catch((error) => {
    logger.error(`MongoDB connection error: ${error}`);
    process.exit(1);
}
);

// Routes
app.use('/auth', authRouter);
app.use('/generations', generationsRouter);

// Log registered routes
logger.info('Registered Routes:');
logger.info(' [POST] /auth/register');

// 404 handler - Route not found
app.use((req, res) => {
    logger.warn(`404 - Not Found - ${req.originalUrl}`);
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    const status = err.status || 500;
    logger.error(`Error ${status} - ${err.message}`);
    res.status(status).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
})

export default app;