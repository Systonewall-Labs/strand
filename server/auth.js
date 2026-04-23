import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import crypto from 'crypto';

// Environment validation
if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production');
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
}

const dbAdapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db'
});
const prisma = new PrismaClient({ adapter: dbAdapter });

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Session configuration
const SESSION_EXPIRY_DAYS = 7;
const SESSION_EXPIRY_MS = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// Generate secure random session ID
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// Sign session ID with secret
function signSessionId(sessionId) {
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\//g, '_')
    .replace(/\+/g, '_');
  return `${sessionId}.${signature}`;
}

// Verify and unsign session ID
function unsignSessionId(signedSessionId) {
  const parts = signedSessionId.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [sessionId, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\//g, '_')
    .replace(/\+/g, '_');
  
  if (signature === expectedSignature) {
    return sessionId;
  }
  return null;
}

// Create session cookie string
function createSessionCookie(sessionId) {
  const signedSessionId = signSessionId(sessionId);
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `auth_session=${signedSessionId}`,
    'HttpOnly',
    'Path=/',
    isProduction ? 'Secure' : '',
    isProduction ? 'SameSite=Strict' : 'SameSite=Lax',
    `Max-Age=${SESSION_EXPIRY_DAYS * 24 * 60 * 60}`
  ].filter(Boolean);
  
  return cookieParts.join('; ');
}

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function verifyPassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

async function createUser(email, password, name) {
  const hashedPassword = await hashPassword(password);
  return await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name
    }
  });
}

async function getUserByEmail(email) {
  return await prisma.user.findUnique({
    where: { email }
  });
}

async function createSession(userId) {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  
  const session = await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      expiresAt
    }
  });
  
  const cookie = createSessionCookie(sessionId);
  return { session, cookie };
}

// Rotate session ID (regenerate with same user) to prevent session fixation
async function rotateSession(oldSessionId) {
  const oldSession = await prisma.session.findUnique({
    where: { id: oldSessionId },
    include: { user: true }
  });
  
  if (!oldSession) {
    return null;
  }
  
  // Delete old session
  await prisma.session.delete({ where: { id: oldSessionId } });
  
  // Create new session with new ID
  const newSessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  
  const newSession = await prisma.session.create({
    data: {
      id: newSessionId,
      userId: oldSession.userId,
      expiresAt
    }
  });
  
  const cookie = createSessionCookie(newSessionId);
  return { session: newSession, cookie };
}

async function validateSession(signedSessionId) {
  if (!signedSessionId) {
    return { session: null, user: null };
  }
  
  // Verify signature
  const sessionId = unsignSessionId(signedSessionId);
  if (!sessionId) {
    return { session: null, user: null };
  }
  
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true }
  });
  
  if (!session) {
    return { session: null, user: null };
  }
  
  // Check if session is expired
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return { session: null, user: null };
  }
  
  // Extend session if halfway to expiry
  const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
  if (timeUntilExpiry < SESSION_EXPIRY_MS / 2) {
    const newExpiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: newExpiresAt }
    });
    session.expiresAt = newExpiresAt;
  }
  
  return { session, user: session.user };
}

async function invalidateSession(signedSessionId) {
  if (signedSessionId) {
    const sessionId = unsignSessionId(signedSessionId);
    if (sessionId) {
      await prisma.session.delete({ where: { id: sessionId } });
    }
  }
}

// Email verification helper functions
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(email, token) {
  if (!resend) {
    console.log(`Verification email would be sent to ${email}. Token: ${token} (Resend not configured)`);
    return;
  }

  const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/verify-email?token=${token}`;

  try {
    await resend.emails.send({
      from: `Strand <noreply@${process.env.EMAIL_DOMAIN || 'strand.app'}>`,
      to: email,
      subject: 'Verify your email address',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify your email address</title>
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
              <div class="greeting">Welcome to Strand!</div>
              <p class="message">Please verify your email address to complete your registration.</p>
              <p class="message">Click the button below to verify your email:</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${verifyUrl}" class="button">Verify Email</a>
              </div>
              <p class="message">This link will expire in 24 hours.</p>
            </div>
            <div class="footer">
              <p>If you didn't sign up for Strand, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw error;
  }
}

async function isVerificationEmailCooldown(user) {
  if (!user.lastVerificationEmailSentAt) {
    return false;
  }
  const cooldownMs = 5 * 60 * 1000; // 5 minutes
  const timeSinceLastEmail = Date.now() - new Date(user.lastVerificationEmailSentAt).getTime();
  return timeSinceLastEmail < cooldownMs;
}

async function markEmailAsVerified(userId) {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerified: new Date(),
      verificationToken: null,
      verificationTokenExpiresAt: null
    }
  });
}

async function setVerificationToken(userId, token, expiresAt) {
  return await prisma.user.update({
    where: { id: userId },
    data: {
      verificationToken: token,
      verificationTokenExpiresAt: expiresAt,
      lastVerificationEmailSentAt: new Date()
    }
  });
}

export {
  createUser,
  getUserByEmail,
  verifyPassword,
  createSession,
  rotateSession,
  validateSession,
  invalidateSession,
  generateVerificationToken,
  sendVerificationEmail,
  isVerificationEmailCooldown,
  markEmailAsVerified,
  setVerificationToken
};
