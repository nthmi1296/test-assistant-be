import jwt from 'jsonwebtoken';
import {jwtConfig} from '../config/index.js';



export function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({success: false, error: 'Authorization token missing'});
    }
    try {
        const payload = jwt.verify(token, jwtConfig.secretKey);
        req.user = {userId: payload.sub, email: payload.email, name: payload.name};
        return next();
    } catch (error) {
        return res.status(401).json({success: false, error: 'Invalid authorization token'});
    }
}

// Function to issue access token
export function issueAccessToken(user) {
    return jwt.sign({
        sub: String(user._id),
        email: user.email,
        name: user.name,
    }, 
    jwtConfig.secretKey, 
    {
        expiresIn: jwtConfig.accessTokenTtlSec,
    });
}

// Function to issue refresh token
export function issueRefreshToken(user) {
    return jwt.sign({
        sub: String(user._id),
        type: 'refresh',
    },
    jwtConfig.secretKey, 
    {
        expiresIn: jwtConfig.refreshTokenTtlSec,
    });
}

