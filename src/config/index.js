import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import mongoose from 'mongoose';
import { logger } from '../utils/logger.js'; // Ensure logger is initialized

//MongoDB Connection
export async function connectMongo() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI is not defined in environment variables');
    }
    try {
        await mongoose.connect(uri, {
        maxPoolSize : 10,
    });
    logger.info('Connected to MongoDB database');
    } catch (error) {
        logger.error('Error connecting to MongoDB database:', error);
        throw error;
    }
}

//JWT Configuration
export const jwtConfig = {
    accessTokenTtlSec: Number(process.env.JWT_ACCESS_TOKEN_TTL_SEC),
    refreshTokenTtlSec: Number(process.env.JWT_REFRESH_TOKEN_TTL_SEC),
    secretKey: process.env.JWT_SECRET_KEY,
}

// JIRA Configuration
export const jiraConfig = {
    baseUrl: process.env.JIRA_BASE_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
}

