import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    name?: string;
  };
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Access token required',
    });
    return;
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_here';
    const decoded = jwt.verify(token, jwtSecret) as any;

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (error) {
    if (process.env.DEMO_MODE === 'true') {
      // Allow demo requests with mock user
      req.user = {
        userId: 'demo-user-id',
        email: 'demo@example.com',
        name: 'Demo User',
      };
      next();
    } else {
      res.status(403).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  }
};

export type { AuthenticatedRequest };
