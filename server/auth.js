import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';
import { Resend } from 'resend';
import crypto from 'crypto';

const prisma = new PrismaClient();
const adapter = new PrismaAdapter(prisma.session, prisma.user);

const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/'
    }
  },
  getUserAttributes: (attributes) => {
    return {
      id: attributes.id,
      email: attributes.email,
      name: attributes.name
    };
  }
});

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
  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  return { session, cookie: sessionCookie.serialize() };
}

async function validateSession(sessionId) {
  const { session, user } = await lucia.validateSession(sessionId);
  return { session, user };
}

async function invalidateSession(sessionId) {
  await lucia.invalidateSession(sessionId);
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
  lucia,
  createUser,
  getUserByEmail,
  verifyPassword,
  createSession,
  validateSession,
  invalidateSession,
  generateVerificationToken,
  sendVerificationEmail,
  isVerificationEmailCooldown,
  markEmailAsVerified,
  setVerificationToken
};
