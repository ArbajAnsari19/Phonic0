import { Router } from 'express';
import { signup, login, getProfile, updateProfile } from '../controllers/authController';import { authenticate } from '../middleware/auth';
import { validate, userSignupSchema, userLoginSchema, userUpdateSchema } from '../middleware/validation';

const router = Router();

// Public routes
router.post('/signup', validate(userSignupSchema), signup);
router.post('/login', validate(userLoginSchema), login);

// Protected routes
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, validate(userUpdateSchema), updateProfile);

export default router;
