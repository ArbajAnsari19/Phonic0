import { Router } from 'express';
import { 
  createBrain, 
  getBrains, 
  getBrain, 
  updateBrain, 
  deleteBrain, 
  getActiveBrain 
} from '../controllers/brainController';
import { authenticate } from '../middleware/auth';
import { validate, brainSchema, brainUpdateSchema } from '../middleware/validation';

const router = Router();

// All brain routes require authentication
router.use(authenticate);

// Brain CRUD routes
router.post('/', validate(brainSchema), createBrain);
router.get('/', getBrains);
router.get('/active', getActiveBrain);
router.get('/:id', getBrain);
router.put('/:id', validate(brainUpdateSchema), updateBrain);
router.delete('/:id', deleteBrain);

export default router;
