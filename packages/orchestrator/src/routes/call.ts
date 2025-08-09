import { Router } from 'express';
import { ConversationEngine } from '../core/conversation-engine';
import { AuthenticatedRequest } from '../middleware/auth';

export default function createCallRoutes(conversationEngine: ConversationEngine) {
  const router = Router();

  // Get active call sessions for the user
  router.get('/sessions', (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const allSessions = conversationEngine.getActiveSessions();
      const userSessions = allSessions.filter(session => session.userId === userId);
      
      res.json({
        success: true,
        data: {
          sessions: userSessions,
          total: userSessions.length,
        },
      });
    } catch (error) {
      console.error('Error getting call sessions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get call sessions',
      });
    }
  });

  // Get session statistics (admin endpoint)
  router.get('/stats', (req: AuthenticatedRequest, res) => {
    try {
      const stats = conversationEngine.getSessionStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error getting session stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get session statistics',
      });
    }
  });

  // Test conversation flow without WebSocket
  router.post('/test', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.userId;
      const userEmail = req.user?.email || 'demo@example.com';
      const userName = req.user?.name || 'Demo User';
      
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const { brainId, message } = req.body;

      if (!brainId || !message) {
        res.status(400).json({
          success: false,
          error: 'brainId and message are required',
        });
        return;
      }

      // This would simulate a conversation flow
      // In real implementation, this would create a temporary session
      res.json({
        success: true,
        data: {
          message: 'Test endpoint - use WebSocket for real conversations',
          testInput: {
            userId,
            userEmail,
            userName,
            brainId,
            message,
          },
          instructions: [
            '1. Connect to WebSocket: ws://localhost:3004?token=YOUR_JWT_TOKEN',
            '2. Send: {"type": "start_conversation", "brainId": "' + brainId + '"}',
            '3. Send: {"type": "text_input", "text": "' + message + '"}',
            '4. Listen for AI responses',
          ],
        },
      });
    } catch (error) {
      console.error('Error in test call:', error);
      res.status(500).json({
        success: false,
        error: 'Test call failed',
      });
    }
  });

  // Simulate a phone call scenario
  router.post('/simulate', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const { brainId, scenario } = req.body;

      if (!brainId) {
        res.status(400).json({
          success: false,
          error: 'brainId is required',
        });
        return;
      }

      // Predefined simulation scenarios
      const scenarios = {
        sales_call: [
          "Hello, I got your number from your website. I'm interested in your services.",
          "Can you tell me more about your pricing plans?",
          "That sounds interesting. What's included in the basic plan?",
          "How long does the setup process usually take?",
          "I'd like to schedule a demo to see it in action.",
        ],
        support_call: [
          "Hi, I'm having trouble with my account login.",
          "I've tried resetting my password but I'm not receiving the email.",
          "My email is correct. Could there be another issue?",
          "Okay, let me try that. Should I call back if it still doesn't work?",
          "Thank you for your help!",
        ],
        lead_qualification: [
          "Hello, I saw your ad and I'm interested in learning more.",
          "We're a mid-size company with about 50 employees.",
          "Our current solution isn't meeting our needs anymore.",
          "Budget isn't a major concern if the value is there.",
          "When could we set up a time to discuss this further?",
        ],
      };

      const selectedScenario = scenarios[scenario as keyof typeof scenarios] || scenarios.sales_call;

      res.json({
        success: true,
        data: {
          scenario: scenario || 'sales_call',
          brainId,
          simulationSteps: selectedScenario,
          instructions: [
            '1. This is a simulation preview',
            '2. Use WebSocket connection for real-time conversation',
            '3. Send each step as a text_input message',
            '4. Observe AI responses for each step',
          ],
          websocketUrl: `ws://localhost:${process.env.PORT || 3004}?token=YOUR_JWT_TOKEN`,
        },
      });
    } catch (error) {
      console.error('Error in simulate call:', error);
      res.status(500).json({
        success: false,
        error: 'Call simulation failed',
      });
    }
  });

  // Emergency stop for all user sessions
  router.post('/emergency-stop', (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const allSessions = conversationEngine.getActiveSessions();
      const userSessions = allSessions.filter(session => session.userId === userId);
      
      let stoppedCount = 0;
      userSessions.forEach(session => {
        conversationEngine.destroySession(session.id);
        stoppedCount++;
      });

      res.json({
        success: true,
        data: {
          message: `Stopped ${stoppedCount} active sessions`,
          stoppedSessions: stoppedCount,
        },
      });
    } catch (error) {
      console.error('Error in emergency stop:', error);
      res.status(500).json({
        success: false,
        error: 'Emergency stop failed',
      });
    }
  });

  return router;
}
