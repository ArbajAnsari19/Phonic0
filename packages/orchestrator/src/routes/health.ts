import { Router } from 'express';
import { ConversationEngine } from '../core/conversation-engine';

// Create a factory function that takes the conversationEngine as parameter
export default function createHealthRouter(conversationEngine: ConversationEngine) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      success: true,
      data: {
        service: 'orchestrator',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        demoMode: process.env.DEMO_MODE === 'true',
      },
    });
  });

  router.get('/services', async (req, res) => {
    try {
      const health = await conversationEngine.checkServicesHealth();
      res.json({
        success: true,
        services: health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to check services health'
      });
    }
  });

  return router;
}
