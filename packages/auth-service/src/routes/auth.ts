import { Router } from 'express';
import { signup, login, getProfile } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate, userSignupSchema, userLoginSchema } from '../middleware/validation';

const router = Router();

// Public routes
router.post('/signup', validate(userSignupSchema), signup);
router.post('/login', validate(userLoginSchema), login);

// Protected routes
router.get('/profile', authenticate, getProfile);

export default router;
