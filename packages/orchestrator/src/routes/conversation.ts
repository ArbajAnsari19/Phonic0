import { Router } from 'express';
import { ConversationManager } from '../services/conversation-manager';
import { AuthenticatedRequest } from '../middleware/auth';

export default function createConversationRoutes(conversationManager: ConversationManager) {
  const router = Router();

  // Get conversation statistics
  router.get('/stats', (req: AuthenticatedRequest, res) => {
    try {
      const stats = conversationManager.getConversationStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error getting conversation stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation statistics',
      });
    }
  });

  // Get user's conversation history
  router.get('/history', (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const conversations = conversationManager.getUserConversations(userId);
      
      res.json({
        success: true,
        data: {
          conversations: conversations.map(conv => ({
            id: conv.id,
            brainId: conv.brainId,
            startTime: conv.startTime,
            endTime: conv.endTime,
            status: conv.status,
            turnCount: conv.metadata.turnCount,
            totalTokens: conv.metadata.totalTokens,
            averageResponseTime: conv.metadata.averageResponseTime,
          })),
          total: conversations.length,
        },
      });
    } catch (error) {
      console.error('Error getting conversation history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation history',
      });
    }
  });

  // Get specific conversation details
  router.get('/:conversationId', (req: AuthenticatedRequest, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const conversation = conversationManager.getConversation(conversationId);
      
      if (!conversation) {
        res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
        return;
      }

      // Check if user owns this conversation
      if (conversation.userId !== userId) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      res.json({
        success: true,
        data: conversationManager.exportConversation(conversationId),
      });
    } catch (error) {
      console.error('Error getting conversation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation',
      });
    }
  });

  // Get conversation messages
  router.get('/:conversationId/messages', (req: AuthenticatedRequest, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'User not authenticated',
        });
        return;
      }

      const conversation = conversationManager.getConversation(conversationId);
      
      if (!conversation) {
        res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
        return;
      }

      // Check if user owns this conversation
      if (conversation.userId !== userId) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      const messages = conversationManager.getConversationHistory(conversationId);
      
      res.json({
        success: true,
        data: {
          conversationId,
          messages: messages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: msg.metadata,
          })),
          total: messages.length,
        },
      });
    } catch (error) {
      console.error('Error getting conversation messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation messages',
      });
    }
  });

  // Clean up old conversations
  router.post('/cleanup', (req: AuthenticatedRequest, res) => {
    try {
      const { maxAge } = req.body;
      const maxAgeMs = maxAge ? parseInt(maxAge) * 1000 : undefined;
      
      const cleaned = conversationManager.cleanupOldConversations(maxAgeMs);
      
      res.json({
        success: true,
        data: {
          cleanedCount: cleaned,
          message: `Cleaned up ${cleaned} old conversations`,
        },
      });
    } catch (error) {
      console.error('Error cleaning up conversations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clean up conversations',
      });
    }
  });

  return router;
}
