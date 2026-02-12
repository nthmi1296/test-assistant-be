import {Router} from 'express';
import User from '../models/User.js';

import { issueAccessToken } from '../middleware/auth.js';
import { issueRefreshToken } from '../middleware/auth.js';

const router = Router();

//POST: /auth/register - Register a new user
router.post('/register', async (req, res, next) => {

    try {
        const {email, name, password} = req.body;
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required'});
    }

    const exists = await User.findOne({email: email.toLowerCase()});
    if (exists) {
        return res.status(409).json({
            success: false,
            error: 'User with this email already exists'});
    }

    const user = new User({email: email.toLowerCase(), name} );
    
    await user.setPassword(password);
    await user.save();
    
    // Generate tokens

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);

    res.status(201).json({
        success: true,
        data: {
            user: {
                id: user._id,
                email: user.email,
                name: user.password,
            },
            accessToken,
            refreshToken
        }
    });
    }catch (error) {
        next(error);
    }
    
})

//POST: /auth/login - Login user
router.post('/login', async (req, res, next) => {
    try {
        const {email, password} = req.body;
        if (!email || !password) {
            return  res.status(400).json({
                success: false,
                error: 'Email and password are required!'});
        }
        const user = await User.findOne({email: email.toLowerCase()});
        const isValid = user ? await user.validatePassword(password) : false;
        if (!user || !isValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'});
        }

        const accessToken = issueAccessToken(user);
        const refreshToken = issueRefreshToken(user);
        return res.json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                },
                accessToken,
                refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
})

export default router;
