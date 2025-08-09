import mongoose, { Document, Schema } from 'mongoose';

export interface IBrain extends Document {
  _id: string;
  userId: string;
  name: string;
  instructions: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BrainSchema = new Schema<IBrain>({
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    ref: 'User',
  },
  name: {
    type: String,
    required: [true, 'Brain name is required'],
    trim: true,
    maxlength: [100, 'Brain name cannot exceed 100 characters'],
  },
  instructions: {
    type: String,
    required: [true, 'Brain instructions are required'],
    maxlength: [10000, 'Instructions cannot exceed 10,000 characters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
BrainSchema.index({ userId: 1, isActive: 1 });
BrainSchema.index({ userId: 1, createdAt: -1 });

export const Brain = mongoose.model<IBrain>('Brain', BrainSchema);
