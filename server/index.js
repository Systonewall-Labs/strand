import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  lucia,
  createUser,
  getUserByEmail,
  verifyPassword,
  createSession,
  validateSession,
  invalidateSession
} from './auth.js';
import { csrfProtection, setCsrfToken } from './middleware/csrf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Utility function to escape HTML and prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Secure logging utility - sanitizes sensitive data
function secureLog(level, message, error = null) {
  const timestamp = new Date().toISOString();
  const sanitizedMessage = message;

  // Don't log full error objects in production
  if (error && process.env.NODE_ENV === 'production') {
    // Log only error message, not stack or details
    const errorMsg = error.message || 'Unknown error';
    console.error(`[${timestamp}] [${level}] ${sanitizedMessage}: ${errorMsg}`);
  } else if (error) {
    console.error(`[${timestamp}] [${level}] ${sanitizedMessage}`, error);
  } else {
    console.log(`[${timestamp}] [${level}] ${sanitizedMessage}`);
  }
}

// Helper to sanitize request data for logging
function sanitizeRequestData(data) {
  if (!data) return data;
  
  const sanitized = { ...data };
  const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'csrf_token', 'auth_session'];
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// Validate CUID format (Prisma ID format)
function isValidCuid(id) {
  // CUID format: 25 characters, starts with a letter
  const cuidRegex = /^[a-z][a-z0-9]{24}$/;
  return cuidRegex.test(id);
}

// Input validation helper
function validateInput(data, rules) {
  const errors = [];
  
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];
    
    if (rule.required && (!value || value.toString().trim() === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    
    if (value && rule.maxLen && value.toString().length > rule.maxLen) {
      errors.push(`${field} exceeds maximum length of ${rule.maxLen}`);
    }
    
    if (value && rule.minLen && value.toString().length < rule.minLen) {
      errors.push(`${field} must be at least ${rule.minLen} characters`);
    }
    
    if (value && rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${field} must be a valid email`);
    }
  }
  
  return errors;
}

// Check if workspace exists
async function checkWorkspaceExists(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId }
  });
  return workspace !== null;
}

// Initialize Resend
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Export app and prisma for testing
export default app;
export { prisma };

// Middleware
const maxPayloadSize = process.env.MAX_PAYLOAD_SIZE || '1mb';
app.use(express.json({ limit: maxPayloadSize }));
app.use(cookieParser());

// Configure MIME types for static files
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filepath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMaxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: 5, // 5 requests per window for auth endpoints
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);
app.use(setCsrfToken);

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') || ['https://strand.app']
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Workspace-Id', 'X-CSRF-Token'],
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Authentication routes
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password, workspaceName } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword
      }
    });

    const session = await createSession(user.id);
    res.setHeader('Set-Cookie', session.cookie);

    // Check if there's a pending invitation
    const pendingInvitationId = req.cookies.pending_invitation;
    let workspace = null;

    if (pendingInvitationId) {
      try {
        const invitation = await prisma.invitation.findUnique({
          where: { id: pendingInvitationId }
        });

        if (invitation && !invitation.accepted && new Date(invitation.expiresAt) > new Date()) {
          // Verify that signup email matches invitation email
          if (invitation.email !== email) {
            console.error('Invitation email mismatch');
            // Continue with signup but don't add to workspace
          } else {
            // Add user to workspace
            await prisma.member.create({
              data: {
                workspaceId: invitation.workspaceId,
                userId: user.id,
                role: 'member'
              }
            });

            // Mark invitation as accepted
            await prisma.invitation.update({
              where: { id: pendingInvitationId },
              data: { accepted: true }
            });

            // Clear the cookie
            res.clearCookie('pending_invitation');
          }
        }
      } catch (inviteError) {
        console.error('Error processing invitation:', inviteError);
        // Continue with signup even if invitation processing fails
      }
    } else {
      // Create default workspace if no invitation
      const defaultWorkspaceName = workspaceName || `${name}'s Space`;
      workspace = await prisma.workspace.create({
        data: {
          name: defaultWorkspaceName,
          members: {
            create: {
              userId: user.id,
              role: 'admin'
            }
          }
        }
      });
    }

    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email },
      workspace: workspace ? { id: workspace.id, name: workspace.name } : null
    });
  } catch (error) {
    secureLog('ERROR', 'Signup error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const session = await createSession(user.id);

    res.setHeader('Set-Cookie', session.cookie);

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      csrfToken: req.cookies.csrf_token || null
    });
  } catch (error) {
    secureLog('ERROR', 'Login error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (sessionId) {
      await invalidateSession(sessionId);
      res.clearCookie('auth_session');
    }
    res.json({ success: true });
  } catch (error) {
    secureLog('ERROR', 'Logout error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const member = await prisma.member.findFirst({
      where: { userId: user.id },
      include: { workspace: true }
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      workspace: member?.workspace ? { id: member.workspace.id, name: member.workspace.name } : null,
      csrfToken: req.cookies.csrf_token || null
    });
  } catch (error) {
    secureLog('ERROR', 'Me error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Workspace routes
app.get('/api/workspaces', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const members = await prisma.member.findMany({
      where: { userId: user.id },
      include: { workspace: true }
    });

    const workspaces = members.map(m => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role
    }));

    res.json({ workspaces });
  } catch (error) {
    console.error('Get workspaces error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/workspace', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { name, firstStrand } = req.body;

    // Use default workspace name if not provided
    const workspaceName = name || `${user.name}'s Space`;

    // Create workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: workspaceName,
        members: {
          create: {
            userId: user.id,
            role: 'admin'
          }
        }
      }
    });

    // Create initial strand if provided
    if (firstStrand) {
      await prisma.strand.create({
        data: {
          title: firstStrand,
          workspaceId: workspace.id,
          participants: {
            connect: {
              userId_workspaceId: {
                userId: user.id,
                workspaceId: workspace.id
              }
            }
          }
        }
      });
    }

    res.status(201).json({ workspace: { id: workspace.id, name: workspace.name } });
  } catch (error) {
    console.error('Workspace creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Strand routes
app.get('/api/strands', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const strands = await prisma.strand.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        _count: {
          select: { messages: true, tasks: true, decisions: true }
        },
        participants: true
      }
    });

    const total = await prisma.strand.count({
      where: { workspaceId }
    });

    res.json({ strands, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get strands error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/strands', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const strand = await prisma.strand.create({
      data: {
        title,
        workspaceId,
        participants: {
          connect: {
            userId_workspaceId: {
              userId: user.id,
              workspaceId
            }
          }
        }
      }
    });

    res.json({ strand });
  } catch (error) {
    console.error('Create strand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/strands/:id', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const { id } = req.params;
    const { resolved } = req.body;

    const strand = await prisma.strand.findFirst({
      where: { id, workspaceId }
    });

    if (!strand) {
      return res.status(404).json({ error: 'Strand not found' });
    }

    const updated = await prisma.strand.update({
      where: { id },
      data: { resolved }
    });

    res.json({ strand: updated });
  } catch (error) {
    console.error('Update strand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/strands/:id/messages', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    // Check if user has access to the strand's workspace
    const accessCheck = await checkStrandAccess(id, user.id);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ error: accessCheck.error });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { strandId: id },
        include: {
          user: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit
      }),
      prisma.message.count({
        where: { strandId: id }
      })
    ]);

    // Parse JSON fields
    const parsedMessages = messages.map(msg => ({
      ...msg,
      cards: msg.cards ? JSON.parse(msg.cards) : null
    }));

    res.json({ messages: parsedMessages, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/messages', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { strandId, content, cards, isDecision } = req.body;

    if (!strandId) {
      return res.status(400).json({ error: 'strandId is required' });
    }

    if (!content && !cards) {
      return res.status(400).json({ error: 'content or cards is required' });
    }

    const strand = await prisma.strand.findUnique({
      where: { id: strandId },
      include: {
        participants: true
      }
    });

    // Check if user is already a participant
    const isParticipant = strand.participants.some(p => p.userId === user.id);
    
    // Add user as participant if not already
    if (!isParticipant) {
      await prisma.member.update({
        where: { 
          userId_workspaceId: {
            userId: user.id,
            workspaceId: strand.workspaceId
          }
        },
        data: {
          strands: {
            connect: { id: strandId }
          }
        }
      });
    }

    const message = await prisma.message.create({
      data: {
        strandId,
        userId: user.id,
        content,
        cards: cards ? JSON.stringify(cards) : null,
        isDecision: isDecision || false
      },
      include: {
        user: {
          select: { id: true, name: true }
        }
      }
    });

    // Broadcast event to workspace
    const messageWithParsedCards = {
      ...message,
      cards: message.cards ? JSON.parse(message.cards) : null
    };
    broadcastEvent(strand.workspaceId, 'new_message', { message: messageWithParsedCards, strandId });

    res.json({ message: messageWithParsedCards });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Task routes
app.get('/api/strands/:id/tasks', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    // Check if user has access to the strand's workspace
    const accessCheck = await checkStrandAccess(id, user.id);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ error: accessCheck.error });
    }

    const tasks = await prisma.task.findMany({
      where: { strandId: id },
      include: {
        assignee: {
          include: {
            user: {
              select: { id: true, name: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tasks', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const { strandId, name, assigneeId, dueDate, status, origin } = req.body;

    if (!strandId || !name) {
      return res.status(400).json({ error: 'strandId and name are required' });
    }

    // Check if user is already a participant of the strand
    const strand = await prisma.strand.findUnique({
      where: { id: strandId },
      include: {
        participants: true
      }
    });

    const isParticipant = strand.participants.some(p => p.userId === user.id);
    
    // Add user as participant if not already
    if (!isParticipant) {
      await prisma.member.update({
        where: { 
          userId_workspaceId: {
            userId: user.id,
            workspaceId: strand.workspaceId
          }
        },
        data: {
          strands: {
            connect: { id: strandId }
          }
        }
      });
    }

    const task = await prisma.task.create({
      data: {
        strandId,
        name,
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: status || 'open',
        origin: origin || false
      }
    });

    // Create a message with context card for the task
    const message = await prisma.message.create({
      data: {
        strandId,
        userId: user.id,
        content: '',
        cards: JSON.stringify([{
          type: 'task',
          id: task.id,
          name: task.name,
          done: task.done,
          status: task.status,
          assigneeId: task.assigneeId,
          dueDate: task.dueDate
        }])
      }
    });

    // Broadcast SSE event
    const messageWithParsedCards = {
      ...message,
      cards: message.cards ? JSON.parse(message.cards) : null,
      user: { id: user.id, name: user.name }
    };
    broadcastEvent(workspaceId, 'new_message', { strandId, message: messageWithParsedCards });

    res.json({ task, message: messageWithParsedCards });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/tasks/:id', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const { id } = req.params;
    const { done, status, assigneeId, dueDate } = req.body;

    const task = await prisma.task.findFirst({
      where: { id }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updateData = {};
    if (done !== undefined) updateData.done = done;
    if (status !== undefined) updateData.status = status;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;

    const updated = await prisma.task.update({
      where: { id },
      data: updateData
    });

    // Update the card in the message that references this task
    const messages = await prisma.message.findMany({
      where: {
        strandId: task.strandId,
        cards: {
          not: null
        }
      }
    });

    for (const message of messages) {
      const cards = message.cards ? JSON.parse(message.cards) : [];
      const taskCard = cards.find(c => c.type === 'task' && c.id === task.id);
      if (taskCard) {
        taskCard.done = updated.done;
        taskCard.status = updated.status;
        taskCard.assigneeId = updated.assigneeId;
        taskCard.dueDate = updated.dueDate;
        await prisma.message.update({
          where: { id: message.id },
          data: { cards: JSON.stringify(cards) }
        });
      }
    }

    res.json({ task: updated });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Decision routes
app.get('/api/strands/:id/decisions', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    // Check if user has access to the strand's workspace
    const accessCheck = await checkStrandAccess(id, user.id);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ error: accessCheck.error });
    }

    const decisions = await prisma.decision.findMany({
      where: { strandId: id },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ decisions });
  } catch (error) {
    console.error('Get decisions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/decisions', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { strandId, what, why, notes } = req.body;

    if (!strandId || !what) {
      return res.status(400).json({ error: 'strandId and what are required' });
    }

    // Check if user is already a participant of the strand
    const strand = await prisma.strand.findUnique({
      where: { id: strandId },
      include: {
        participants: true
      }
    });

    const isParticipant = strand.participants.some(p => p.userId === user.id);
    
    // Add user as participant if not already
    if (!isParticipant) {
      await prisma.member.update({
        where: { 
          userId_workspaceId: {
            userId: user.id,
            workspaceId: strand.workspaceId
          }
        },
        data: {
          strands: {
            connect: { id: strandId }
          }
        }
      });
    }

    const decision = await prisma.decision.create({
      data: {
        strandId,
        what,
        why,
        notes
      }
    });

    res.json({ decision });
  } catch (error) {
    console.error('Create decision error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/decisions/:id', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;
    const { notes } = req.body;

    if (notes === undefined) {
      return res.status(400).json({ error: 'notes is required' });
    }

    // Get the decision to check workspace access
    const decision = await prisma.decision.findUnique({
      where: { id },
      include: {
        strand: {
          select: { workspaceId: true }
        }
      }
    });

    if (!decision) {
      return res.status(404).json({ error: 'Decision not found' });
    }

    // Check if user is a member of the workspace
    const member = await getMember(user.id, decision.strand.workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const updated = await prisma.decision.update({
      where: { id },
      data: { notes }
    });

    res.json({ decision: updated });
  } catch (error) {
    console.error('Update decision error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Doc routes
app.get('/api/strands/:id/doc', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    // Check if user has access to the strand's workspace
    const accessCheck = await checkStrandAccess(id, user.id);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ error: accessCheck.error });
    }

    const doc = await prisma.doc.findUnique({
      where: { strandId: id }
    });

    // Parse JSON fields
    const parsedDoc = doc ? {
      ...doc,
      sections: doc.sections ? JSON.parse(doc.sections) : null
    } : null;

    res.json({ doc: parsedDoc });
  } catch (error) {
    console.error('Get doc error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/docs', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { strandId, sections } = req.body;

    if (!strandId || !sections) {
      return res.status(400).json({ error: 'strandId and sections are required' });
    }

    // Check if user has access to the strand's workspace
    const accessCheck = await checkStrandAccess(strandId, user.id);
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ error: accessCheck.error });
    }

    const doc = await prisma.doc.upsert({
      where: { strandId },
      update: { sections: JSON.stringify(sections) },
      create: { strandId, sections: JSON.stringify(sections) }
    });

    res.json({ doc });
  } catch (error) {
    console.error('Create doc error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Wiki routes
app.get('/api/wiki/decisions', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [decisions, total] = await Promise.all([
      prisma.decision.findMany({
        where: {
          strand: {
            workspaceId: workspaceId
          }
        },
        include: {
          strand: {
            select: { id: true, title: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.decision.count({
        where: {
          strand: {
            workspaceId: workspaceId
          }
        }
      })
    ]);

    res.json({ decisions, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get wiki decisions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/wiki/docs', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      prisma.doc.findMany({
        where: {
          strand: {
            workspaceId: workspaceId
          }
        },
        include: {
          strand: {
            select: { id: true, title: true }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.doc.count({
        where: {
          strand: {
            workspaceId: workspaceId
          }
        }
      })
    ]);

    // Parse JSON fields
    const parsedDocs = docs.map(doc => ({
      ...doc,
      sections: doc.sections ? JSON.parse(doc.sections) : null
    }));

    res.json({ docs: parsedDocs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get wiki docs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/wiki/search', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const query = req.query.q || '';
    const filter = req.query.filter || 'all';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    let decisions = [];
    let decisionTotal = 0;

    // Build decision query
    const decisionWhere = {
      strand: {
        workspaceId: workspaceId
      },
      OR: query ? [
        {
          what: {
            contains: query,
            mode: 'insensitive'
          }
        },
        {
          why: {
            contains: query,
            mode: 'insensitive'
          }
        },
        {
          notes: {
            contains: query,
            mode: 'insensitive'
          }
        }
      ] : undefined
    };

    // Apply strand status filter
    if (filter === 'open') {
      decisionWhere.strand.resolved = false;
    } else if (filter === 'resolved') {
      decisionWhere.strand.resolved = true;
    }

    [decisions, decisionTotal] = await Promise.all([
      prisma.decision.findMany({
        where: decisionWhere,
        include: {
          strand: {
            select: { id: true, title: true, resolved: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.decision.count({
        where: decisionWhere
      })
    ]);

    const total = decisionTotal;
    res.json({ decisions, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Wiki search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Member routes
app.get('/api/strands/:id/participants', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    const strand = await prisma.strand.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: true
          }
        },
        workspace: true
      }
    });

    if (!strand) {
      return res.status(404).json({ error: 'Strand not found' });
    }

    // Verify user is a member of the workspace
    const member = await getMember(user.id, strand.workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const participants = strand.participants.map(p => ({
      id: p.id,
      userId: p.user.id,
      name: p.user.name,
      email: p.user.email,
      role: p.role
    }));

    res.json({ participants });
  } catch (error) {
    console.error('Get strand participants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const members = await prisma.member.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ members });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/members/:id', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const currentMember = await getMember(user.id, workspaceId);
    if (!currentMember) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    // Only admins can remove members
    if (currentMember.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    const { id } = req.params;

    // Cannot remove yourself
    const targetMember = await prisma.member.findUnique({
      where: { id }
    });

    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (targetMember.userId === user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Delete member
    await prisma.member.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/invitations', async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const invitations = await prisma.invitation.findMany({
      where: {
        workspaceId,
        accepted: false,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        workspace: true,
        inviter: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({ invitations });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/invitations', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const workspaceId = req.headers['x-workspace-id'];
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    if (!isValidCuid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID format' });
    }

    if (!(await checkWorkspaceExists(workspaceId))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const member = await getMember(user.id, workspaceId);
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email already exists in workspace
    const existingMember = await prisma.member.findFirst({
      where: {
        workspaceId,
        user: { email }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member' });
    }

    // Check if there's already a pending invitation
    const existingInvitation = await prisma.invitation.findFirst({
      where: {
        email,
        workspaceId,
        accepted: false
      }
    });

    if (existingInvitation) {
      // Return existing invitation instead of error
      return res.json({ invitation: existingInvitation, existing: true });
    }

    // Create invitation (expires in 3 days)
    const invitation = await prisma.invitation.create({
      data: {
        email,
        workspaceId,
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      }
    });

    // Send invitation email using Resend
    if (resend) {
      try {
        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${invitation.id}`;
        
        await resend.emails.send({
          from: `Strand <noreply@${process.env.EMAIL_DOMAIN || 'strand.app'}>`,
          to: email,
          subject: `You're invited to join ${escapeHtml(member.workspace.name)}`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Invitation to join Strand</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; }
                .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
                .header { text-align: center; margin-bottom: 40px; }
                .logo { font-size: 32px; font-style: italic; color: #8b6f47; }
                .content { background: #faf8f4; border-radius: 12px; padding: 32px; border: 1px solid #ddd9d0; }
                .greeting { font-size: 18px; margin-bottom: 16px; }
                .message { color: #5a574f; margin-bottom: 24px; }
                .button { display: inline-block; background: #8b6f47; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; }
                .button:hover { background: #7a5f39; }
                .footer { margin-top: 32px; text-align: center; color: #9a9790; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">strand</div>
                </div>
                <div class="content">
                  <div class="greeting">Hi there,</div>
                  <p class="message">${escapeHtml(user.name)} has invited you to join the <strong>${escapeHtml(member.workspace.name)}</strong> workspace on Strand.</p>
                  <p class="message">Click the button below to accept the invitation and join the team:</p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${inviteUrl}" class="button">Accept Invitation</a>
                  </div>
                  <p class="message">This invitation will expire in 7 days.</p>
                </div>
                <div class="footer">
                  <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                </div>
              </div>
            </body>
            </html>
          `
        });
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        // Continue even if email fails, invitation is still created
      }
    } else {
      console.log(`Invitation sent to ${email}. Token: ${invitation.id} (Resend not configured)`);
    }

    res.status(201).json({ invitation });
  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/invitations/:id', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      include: { workspace: true }
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    const member = await getMember(user.id, invitation.workspaceId);
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await prisma.invitation.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete invitation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/invitations/:id/resend', csrfProtection, async (req, res) => {
  try {
    const sessionId = req.cookies.auth_session;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { session, user } = await validateSession(sessionId);
    if (!session || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { id } = req.params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      include: {
        workspace: true,
        inviter: true
      }
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    const member = await getMember(user.id, invitation.workspaceId);
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Update expiration date
    const updatedInvitation = await prisma.invitation.update({
      where: { id },
      data: {
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      },
      include: {
        workspace: true,
        inviter: true
      }
    });

    // Send invitation email using Resend
    if (resend) {
      try {
        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${invitation.id}`;

        await resend.emails.send({
          from: `Strand <noreply@${process.env.EMAIL_DOMAIN || 'strand.app'}>`,
          to: invitation.email,
          subject: `You're invited to join ${escapeHtml(invitation.workspace.name)}`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Invitation to join Strand</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; }
                .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
                .header { text-align: center; margin-bottom: 40px; }
                .logo { font-size: 32px; font-style: italic; color: #8b6f47; }
                .content { background: #faf8f4; border-radius: 12px; padding: 32px; border: 1px solid #ddd9d0; }
                .greeting { font-size: 18px; margin-bottom: 16px; }
                .message { color: #5a574f; margin-bottom: 24px; }
                .button { display: inline-block; background: #8b6f47; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; }
                .button:hover { background: #7a5f39; }
                .footer { margin-top: 32px; text-align: center; color: #9a9790; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">strand</div>
                </div>
                <div class="content">
                  <div class="greeting">Hi there,</div>
                  <p class="message">${escapeHtml(invitation.inviter.name)} has invited you to join the <strong>${escapeHtml(invitation.workspace.name)}</strong> workspace on Strand.</p>
                  <p class="message">Click the button below to accept the invitation and join the team:</p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${inviteUrl}" class="button">Accept Invitation</a>
                  </div>
                  <p class="message">This invitation will expire in 7 days.</p>
                </div>
                <div class="footer">
                  <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                </div>
              </div>
            </body>
            </html>
          `
        });
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        return res.status(500).json({ error: 'Failed to send email' });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Resend invitation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SSE endpoint for real-time updates
const clients = new Map(); // Change from Set to Map for better tracking

// Periodic cleanup of inactive SSE clients
setInterval(() => {
  const now = Date.now();
  for (const [clientId, client] of clients.entries()) {
    // Remove clients inactive for more than 5 minutes
    if (now - client.lastActive > 5 * 60 * 1000) {
      try {
        client.res.end();
      } catch (e) {
        // Ignore errors when ending connection
      }
      clients.delete(clientId);
    }
  }
}, 60 * 1000); // Run every minute

// Accept invitation endpoint
app.get('/invite/:id', async (req, res) => {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { id: req.params.id },
      include: { workspace: true }
    });

    if (!invitation) {
      return res.status(404).send('Invitation not found');
    }

    if (invitation.accepted) {
      return res.status(400).send('Invitation already accepted');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      return res.status(400).send('Invitation has expired');
    }

    // Check if user is logged in
    const sessionId = req.cookies.auth_session;
    let user = null;

    if (sessionId) {
      const { session: validSession } = await validateSession(sessionId);
      if (validSession) {
        user = await prisma.user.findUnique({
          where: { id: validSession.userId }
        });
      }
    }

    // If user is logged in, add them to workspace
    if (user) {
      // Verify that user's email matches invitation email
      if (user.email !== invitation.email) {
        return res.status(400).send('This invitation is for a different email address');
      }

      // Check if user is already a member
      const existingMember = await prisma.member.findFirst({
        where: {
          workspaceId: invitation.workspaceId,
          userId: user.id
        }
      });

      if (existingMember) {
        return res.redirect('/');
      }

      // Add user to workspace
      await prisma.member.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: 'member'
        }
      });

      // Mark invitation as accepted
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { accepted: true }
      });

      return res.redirect('/');
    }

    // If user is not logged in, redirect to home with invitation info
    // Store invitation ID in a cookie to use after signup
    res.cookie('pending_invitation', invitation.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.redirect('/');
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/events', async (req, res) => {
  const sessionId = req.cookies.auth_session;
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { session, user } = await validateSession(sessionId);
  if (!session || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const workspaceId = req.query.workspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID required' });
  }

  if (!isValidCuid(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspace ID format' });
  }

  if (!(await checkWorkspaceExists(workspaceId))) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const member = await getMember(user.id, workspaceId);
  if (!member) {
    return res.status(403).json({ error: 'Not a member of this workspace' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now().toString();
  clients.set(clientId, { res, workspaceId, userId: user.id, lastActive: Date.now() });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  req.on('close', () => {
    clients.delete(clientId);
  });
});

// Helper function to broadcast events to clients
function broadcastEvent(workspaceId, eventType, data) {
  for (const [clientId, client] of clients.entries()) {
    if (client.workspaceId === workspaceId) {
      try {
        client.res.write(`data: ${JSON.stringify({ type: eventType, data })}\n\n`);
        client.lastActive = Date.now(); // Update last active timestamp
      } catch (e) {
        // Remove client if write fails (connection closed)
        clients.delete(clientId);
      }
    }
  }
}

// Helper function to get member by userId and workspaceId
async function getMember(userId, workspaceId) {
  return await prisma.member.findFirst({
    where: {
      userId,
      workspaceId
    },
    include: {
      workspace: true
    }
  });
}

// Helper function to check if user has access to a strand's workspace
async function checkStrandAccess(strandId, userId) {
  const strand = await prisma.strand.findUnique({
    where: { id: strandId },
    select: { workspaceId: true }
  });
  
  if (!strand) {
    return { hasAccess: false, error: 'Strand not found' };
  }
  
  const member = await getMember(userId, strand.workspaceId);
  if (!member) {
    return { hasAccess: false, error: 'Not a member of this workspace' };
  }
  
  return { hasAccess: true, workspaceId: strand.workspaceId };
}

// Export clients for testing
export { clients };
