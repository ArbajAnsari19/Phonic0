import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://Arbaj19:Arbaj19@arbaj.k56wb.mongodb.net/';
    
    await mongoose.connect(mongoUri, {
      // Modern mongoose doesn't need these options, but keeping for clarity
    });
    
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('MongoDB disconnected successfully');
  } catch (error) {
    console.error('MongoDB disconnection error:', error);
    throw error;
  }
}
