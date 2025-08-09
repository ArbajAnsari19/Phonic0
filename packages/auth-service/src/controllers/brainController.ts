import { Response } from 'express';
import { Brain } from '../models/Brain';
import { AuthenticatedRequest } from '../middleware/auth';

export const createBrain = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { name, instructions, description, isActive } = req.body;

    const brain = await Brain.create({
      userId,
      name,
      instructions,
      description,
      isActive,
    });

    res.status(201).json({
      success: true,
      data: { brain },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create brain' 
    });
  }
};

export const getBrains = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { active, limit = 10, page = 1 } = req.query;

    const filter: any = { userId };
    if (active !== undefined) {
      filter.isActive = active === 'true';
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const brains = await Brain.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip);

    const total = await Brain.countDocuments(filter);

    res.json({
      success: true,
      data: {
        brains,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get brains' 
    });
  }
};

export const getBrain = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;

    const brain = await Brain.findOne({ _id: id, userId });

    if (!brain) {
      res.status(404).json({ 
        success: false, 
        error: 'Brain not found' 
      });
      return;
    }

    res.json({
      success: true,
      data: { brain },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get brain' 
    });
  }
};

export const updateBrain = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;
    const updates = req.body;

    const brain = await Brain.findOneAndUpdate(
      { _id: id, userId },
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!brain) {
      res.status(404).json({ 
        success: false, 
        error: 'Brain not found' 
      });
      return;
    }

    res.json({
      success: true,
      data: { brain },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update brain' 
    });
  }
};

export const deleteBrain = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;

    const brain = await Brain.findOneAndDelete({ _id: id, userId });

    if (!brain) {
      res.status(404).json({ 
        success: false, 
        error: 'Brain not found' 
      });
      return;
    }

    res.json({
      success: true,
      data: { message: 'Brain deleted successfully' },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete brain' 
    });
  }
};

export const getActiveBrain = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;

    const brain = await Brain.findOne({ userId, isActive: true })
      .sort({ updatedAt: -1 });

    if (!brain) {
      res.status(404).json({ 
        success: false, 
        error: 'No active brain found' 
      });
      return;
    }

    res.json({
      success: true,
      data: { brain },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get active brain' 
    });
  }
};
