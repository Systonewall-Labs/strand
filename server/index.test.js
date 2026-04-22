import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Import Prisma from index.js to use the same instance
let prisma;

describe('API Endpoints', () => {
  let app;
  let testUser;
  let sessionCookie;

  before(async () => {
    // Import app dynamically to avoid ES module issues
    const { default: serverApp } = await import('./index.js');
    app = serverApp;

    // Get Prisma from the app's context
    const { prisma: appPrisma } = await import('./index.js');
    prisma = appPrisma;

    // Clean up test data in correct order (children first)
    await prisma.message.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.decision.deleteMany({});
    await prisma.doc.deleteMany({});
    await prisma.strand.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.invitation.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
  });

  after(async () => {
    // Clear SSE clients
    const { clients } = await import('./index.js');
    clients.clear();

    await prisma.$disconnect();
  });

  describe('POST /api/auth/signup', () => {
    it('should create a new user and require email verification', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'testpassword123'
        });

      assert.strictEqual(response.status, 201);
      assert.ok(response.body.user.id);
      assert.strictEqual(response.body.user.email, 'test@example.com');
      assert.strictEqual(response.body.requiresVerification, true);
      assert.ok(response.body.message);
      testUser = response.body.user;
    });

    it('should not create duplicate user', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'testpassword123'
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should not login without email verification', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'testpassword123'
        });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.requiresVerification, true);
      assert.ok(response.body.error);
    });

    it('should not login with wrong password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        });

      assert.strictEqual(response.status, 401);
      assert.ok(response.body.error);
    });

    it('should login after email verification', async () => {
      // Manually verify the user's email for testing
      await prisma.user.update({
        where: { id: testUser.id },
        data: {
          emailVerified: new Date(),
          verificationToken: null,
          verificationTokenExpiresAt: null
        }
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'testpassword123'
        });

      assert.strictEqual(response.status, 200);
      assert.ok(response.body.user.id);
      assert.ok(response.headers['set-cookie']);
      sessionCookie = response.headers['set-cookie'][0];
    });
  });

  describe('GET /api/auth/verify-email', () => {
    it('should verify email with valid token and redirect', async () => {
      // Create a new unverified user with a token
      const newUser = await prisma.user.create({
        data: {
          name: 'Verify Test',
          email: 'verify@example.com',
          password: await (await import('bcryptjs')).default.hash('password123', 10),
          verificationToken: 'test-token-123',
          verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .get('/api/auth/verify-email')
        .query({ token: 'test-token-123' });

      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.location, '/');
      assert.ok(response.headers['set-cookie']);
    });

    it('should redirect with error for invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify-email')
        .query({ token: 'invalid-token' });

      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.location, '/?error=invalid_token');
    });

    it('should redirect with error for expired token', async () => {
      const newUser = await prisma.user.create({
        data: {
          name: 'Expired Test',
          email: 'expired@example.com',
          password: await (await import('bcryptjs')).default.hash('password123', 10),
          verificationToken: 'expired-token',
          verificationTokenExpiresAt: new Date(Date.now() - 1000) // Expired
        }
      });

      const response = await request(app)
        .get('/api/auth/verify-email')
        .query({ token: 'expired-token' });

      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.location, '/?error=expired_token');
    });
  });

  describe('POST /api/auth/resend-verification', () => {
    it('should resend verification email with valid credentials', async () => {
      const newUser = await prisma.user.create({
        data: {
          name: 'Resend Test',
          email: 'resend@example.com',
          password: await (await import('bcryptjs')).default.hash('password123', 10),
          verificationToken: 'old-token',
          verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          lastVerificationEmailSentAt: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
        }
      });

      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({
          email: 'resend@example.com',
          password: 'password123'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should reject resend with invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        });

      assert.strictEqual(response.status, 401);
      assert.ok(response.body.error);
    });

    it('should respect cooldown period', async () => {
      const newUser = await prisma.user.create({
        data: {
          name: 'Cooldown Test',
          email: 'cooldown@example.com',
          password: await (await import('bcryptjs')).default.hash('password123', 10),
          verificationToken: 'cooldown-token',
          verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          lastVerificationEmailSentAt: new Date(Date.now() - 2 * 60 * 1000) // 2 minutes ago
        }
      });

      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({
          email: 'cooldown@example.com',
          password: 'password123'
        });

      assert.strictEqual(response.status, 429);
      assert.ok(response.body.error);
      assert.strictEqual(response.body.cooldown, '5 minutes');
    });
  });

  describe('POST /api/workspace', () => {
    it('should create a workspace', async () => {
      const csrfToken = 'test-csrf-token-123';
      const response = await request(app)
        .post('/api/workspace')
        .set('Cookie', [sessionCookie, `csrf_token=${csrfToken}`])
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Test Workspace',
          firstStrand: 'Initial Strand'
        });

      assert.strictEqual(response.status, 201);
      assert.ok(response.body.workspace.id);
      assert.strictEqual(response.body.workspace.name, 'Test Workspace');
    });

    it('should not create workspace without auth', async () => {
      const csrfToken = 'test-csrf-token-456';
      const response = await request(app)
        .post('/api/workspace')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Test Workspace',
          firstStrand: 'Initial Strand'
        });

      assert.strictEqual(response.status, 401);
    });
  });
});
