import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../lib/api';
import { authApi } from '../lib/api';
import toast from 'react-hot-toast';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!user;

  useEffect(() => {
    // Check for existing session
    const token = localStorage.getItem('phonic0_token');
    const savedUser = localStorage.getItem('phonic0_user');
    
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        // Optionally validate token with backend
        validateToken();
      } catch (error) {
        console.error('Error parsing saved user:', error);
        logout();
      }
    } else {
      setLoading(false);
    }
  }, []);

  const validateToken = async () => {
    try {
      const response = await authApi.getProfile();
      setUser(response.data.user);
    } catch (error) {
      console.error('Token validation failed:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await authApi.login({ email, password });
      const { user, token } = response.data;
      
      localStorage.setItem('phonic0_token', token);
      localStorage.setItem('phonic0_user', JSON.stringify(user));
      setUser(user);
      
      toast.success(`Welcome back, ${user.name}!`);
    } catch (error: any) {
      const message = error.response?.data?.error || 'Login failed';
      toast.error(message);
      throw error;
    }
  };

  const signup = async (name: string, email: string, password: string) => {
    try {
      const response = await authApi.signup({ name, email, password });
      const { user, token } = response.data;
      
      localStorage.setItem('phonic0_token', token);
      localStorage.setItem('phonic0_user', JSON.stringify(user));
      setUser(user);
      
      toast.success(`Welcome to Phonic0, ${user.name}!`);
    } catch (error: any) {
      const message = error.response?.data?.error || 'Signup failed';
      toast.error(message);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('phonic0_token');
    localStorage.removeItem('phonic0_user');
    setUser(null);
    toast.success('Logged out successfully');
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    signup,
    logout,
    isAuthenticated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
