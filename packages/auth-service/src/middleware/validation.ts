import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      res.status(400).json({ 
        success: false, 
        error: message 
      });
      return;
    }
    
    next();
  };
};

export const userSignupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(6).max(128).required(),
});

export const userLoginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

export const brainSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  instructions: Joi.string().trim().min(1).max(10000).required(),
  description: Joi.string().trim().max(500).optional(),
  isActive: Joi.boolean().optional(),
});

export const brainUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  instructions: Joi.string().trim().min(1).max(10000).optional(),
  description: Joi.string().trim().max(500).optional(),
  isActive: Joi.boolean().optional(),
}).min(1); // At least one field must be provided for update
