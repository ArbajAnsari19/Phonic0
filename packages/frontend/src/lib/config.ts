// Environment configuration utility
export const config = {
  // API URLs
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  orchUrl: import.meta.env.VITE_ORCH_URL || 'http://localhost:3004',
  wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:3004',
  
  // Feature flags
  debugMode: import.meta.env.DEV || false,
  
  // Timeouts
  connectionTimeout: 10000, // 10 seconds
  messageTimeout: 5000,     // 5 seconds
};

// Validate configuration
export const validateConfig = () => {
  const issues: string[] = [];
  
  if (!config.apiUrl) issues.push('VITE_API_URL not set');
  if (!config.orchUrl) issues.push('VITE_ORCH_URL not set');
  if (!config.wsUrl) issues.push('VITE_WS_URL not set');
  
  if (issues.length > 0) {
    console.warn('⚠️ Configuration issues detected:', issues);
    return false;
  }
  
  console.log('✅ Configuration validated:', {
    apiUrl: config.apiUrl,
    orchUrl: config.orchUrl,
    wsUrl: config.wsUrl,
  });
  
  return true;
};

// Get WebSocket URL with fallback logic
export const getWebSocketUrl = (): string => {
  // Priority: VITE_WS_URL > VITE_ORCH_URL (converted) > fallback
  if (config.wsUrl) {
    return config.wsUrl;
  }
  
  if (config.orchUrl) {
    return config.orchUrl.replace(/^http/, 'ws');
  }
  
  return 'ws://localhost:3004';
};
