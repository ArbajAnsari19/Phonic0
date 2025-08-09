import axios from 'axios';
import jwt from 'jsonwebtoken';

export interface Brain {
  id: string;
  name: string;
  instructions: string;
  isActive: boolean;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export class AuthIntegration {
  private readonly baseUrl: string;
  private readonly jwtSecret: string;

  constructor() {
    this.baseUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    this.jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_here';
  }

  async initialize(): Promise<void> {
    try {
      // Check if auth service is available
      const response = await axios.get(`${this.baseUrl}/health`);
      
      if (response.data.success) {
        console.log('✅ Auth integration initialized');
      } else {
        throw new Error('Auth service health check failed');
      }
    } catch (error) {
      console.error('❌ Auth integration failed:', error);
      
      if (process.env.DEMO_MODE === 'true') {
        console.log('🎭 Continuing in demo mode without auth service');
      } else {
        throw error;
      }
    }
  }

  async verifyToken(token: string): Promise<User | null> {
    try {
      // First try to verify JWT locally
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      
      if (!decoded.userId) {
        return null;
      }

      // Get user details from auth service
      const response = await axios.get(`${this.baseUrl}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.data.success) {
        return {
          id: response.data.data.id,
          email: response.data.data.email,
          name: response.data.data.name,
        };
      }

      return null;

    } catch (error) {
      console.error('Token verification failed:', error);
      
      // Return mock user in demo mode
      if (process.env.DEMO_MODE === 'true') {
        return {
          id: 'demo-user-id',
          email: 'demo@example.com',
          name: 'Demo User',
        };
      }
      
      return null;
    }
  }

  async getBrainById(brainId: string, userId: string): Promise<Brain | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/auth/brains/${brainId}`, {
        headers: { Authorization: `Bearer ${this.generateMockToken(userId)}` },
      });

      if (response.data.success) {
        const brain = response.data.data;
        return {
          id: brain.id,
          name: brain.name,
          instructions: brain.instructions,
          isActive: brain.isActive,
          userId: brain.userId,
          createdAt: new Date(brain.createdAt),
          updatedAt: new Date(brain.updatedAt),
        };
      }

      return null;

    } catch (error) {
      console.error(`Error fetching brain ${brainId}:`, error);
      
      // Return mock brain in demo mode
      if (process.env.DEMO_MODE === 'true') {
        return this.generateMockBrain(brainId);
      }
      
      return null;
    }
  }

  async getUserBrains(userId: string, token?: string): Promise<Brain[]> {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await axios.get(`${this.baseUrl}/api/auth/brains`, { headers });

      if (response.data.success) {
        return response.data.data.map((brain: any) => ({
          id: brain.id,
          name: brain.name,
          instructions: brain.instructions,
          isActive: brain.isActive,
          userId: brain.userId,
          createdAt: new Date(brain.createdAt),
          updatedAt: new Date(brain.updatedAt),
        }));
      }

      return [];

    } catch (error) {
      console.error('Error fetching user brains:', error);
      
      // Return mock brains in demo mode
      if (process.env.DEMO_MODE === 'true') {
        return this.generateMockBrains(userId);
      }
      
      return [];
    }
  }

  async createBrain(brain: Omit<Brain, 'id' | 'createdAt' | 'updatedAt'>, token: string): Promise<Brain | null> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/brains`, {
        name: brain.name,
        instructions: brain.instructions,
        isActive: brain.isActive,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.data.success) {
        const newBrain = response.data.data;
        return {
          id: newBrain.id,
          name: newBrain.name,
          instructions: newBrain.instructions,
          isActive: newBrain.isActive,
          userId: newBrain.userId,
          createdAt: new Date(newBrain.createdAt),
          updatedAt: new Date(newBrain.updatedAt),
        };
      }

      return null;

    } catch (error) {
      console.error('Error creating brain:', error);
      return null;
    }
  }

  async updateBrain(brainId: string, updates: Partial<Brain>, token: string): Promise<Brain | null> {
    try {
      const response = await axios.put(`${this.baseUrl}/api/auth/brains/${brainId}`, updates, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.data.success) {
        const updatedBrain = response.data.data;
        return {
          id: updatedBrain.id,
          name: updatedBrain.name,
          instructions: updatedBrain.instructions,
          isActive: updatedBrain.isActive,
          userId: updatedBrain.userId,
          createdAt: new Date(updatedBrain.createdAt),
          updatedAt: new Date(updatedBrain.updatedAt),
        };
      }

      return null;

    } catch (error) {
      console.error('Error updating brain:', error);
      return null;
    }
  }

  private generateMockToken(userId: string): string {
    if (process.env.DEMO_MODE !== 'true') {
      return '';
    }

    try {
      return jwt.sign({ userId }, this.jwtSecret, { expiresIn: '7d' });
    } catch (error) {
      return 'mock-token';
    }
  }

  private generateMockBrain(brainId: string): Brain {
    const mockBrains = [
      {
        name: "Sales Assistant",
        instructions: "You are a helpful sales assistant for a SaaS company. Be friendly, informative, and focus on understanding the customer's needs. Ask qualifying questions and guide them towards a demo or trial. Keep responses conversational and under 3 sentences.",
      },
      {
        name: "Customer Support",
        instructions: "You are a customer support representative. Be patient, empathetic, and solution-focused. Listen carefully to customer issues and provide clear, helpful guidance. Always offer to escalate if needed.",
      },
      {
        name: "Lead Qualifier",
        instructions: "You are a lead qualification specialist. Your goal is to determine if prospects are a good fit for our services. Ask about budget, timeline, decision-making process, and pain points. Be professional but conversational.",
      },
      {
        name: "Appointment Setter",
        instructions: "You are an appointment setting specialist. Your primary goal is to schedule meetings between prospects and our sales team. Be persistent but respectful. Focus on finding mutually convenient times.",
      },
    ];

    const mockBrain = mockBrains[Math.floor(Math.random() * mockBrains.length)];

    return {
      id: brainId,
      name: mockBrain.name,
      instructions: mockBrain.instructions,
      isActive: true,
      userId: 'demo-user-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private generateMockBrains(userId: string): Brain[] {
    return [
      {
        id: 'brain-1',
        name: "Sales Assistant",
        instructions: "You are a helpful sales assistant for a SaaS company. Be friendly, informative, and focus on understanding the customer's needs.",
        isActive: true,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'brain-2',
        name: "Customer Support",
        instructions: "You are a customer support representative. Be patient, empathetic, and solution-focused.",
        isActive: true,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'brain-3',
        name: "Lead Qualifier",
        instructions: "You are a lead qualification specialist. Your goal is to determine if prospects are a good fit for our services.",
        isActive: false,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  }

  // Health check
  async checkHealth(): Promise<{ status: string; connected: boolean }> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      
      return {
        status: response.data.success ? 'healthy' : 'error',
        connected: true,
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
      };
    }
  }
}
