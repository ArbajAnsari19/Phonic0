import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Create axios instance
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('phonic0_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('phonic0_token');
      localStorage.removeItem('phonic0_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Types
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Brain {
  _id: string;
  userId: string;
  name: string;
  instructions: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: User;
    token: string;
  };
}

export interface BrainResponse {
  success: boolean;
  data: {
    brain: Brain;
  };
}

export interface BrainsResponse {
  success: boolean;
  data: {
    brains: Brain[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
}

// Auth API
export const authApi = {
  signup: async (data: { name: string; email: string; password: string }): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/signup', data);
    return response.data;
  },

  login: async (data: { email: string; password: string }): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/login', data);
    return response.data;
  },

  getProfile: async (): Promise<{ success: boolean; data: { user: User } }> => {
    const response = await api.get('/auth/profile');
    return response.data;
  },
};

// Brain API
export const brainApi = {
  create: async (data: {
    name: string;
    instructions: string;
    description?: string;
    isActive?: boolean;
  }): Promise<BrainResponse> => {
    const response = await api.post<BrainResponse>('/brain', data);
    return response.data;
  },

  getAll: async (params?: {
    active?: boolean;
    limit?: number;
    page?: number;
  }): Promise<BrainsResponse> => {
    const response = await api.get<BrainsResponse>('/brain', { params });
    return response.data;
  },

  getActive: async (): Promise<BrainResponse> => {
    const response = await api.get<BrainResponse>('/brain/active');
    return response.data;
  },

  getById: async (id: string): Promise<BrainResponse> => {
    const response = await api.get<BrainResponse>(`/brain/${id}`);
    return response.data;
  },

  update: async (
    id: string,
    data: {
      name?: string;
      instructions?: string;
      description?: string;
      isActive?: boolean;
    }
  ): Promise<BrainResponse> => {
    const response = await api.put<BrainResponse>(`/brain/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<{ success: boolean; data: { message: string } }> => {
    const response = await api.delete(`/brain/${id}`);
    return response.data;
  },
};

// Health check
export const healthCheck = async (): Promise<{ status: string; service: string; timestamp: string }> => {
  const response = await axios.get(`${API_BASE_URL}/health`);
  return response.data;
};
