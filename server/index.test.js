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
    it('should create a new user', async () => {
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
    it('should login with correct credentials', async () => {
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
  });

  describe('POST /api/workspace', () => {
    it('should create a workspace', async () => {
      const response = await request(app)
        .post('/api/workspace')
        .set('Cookie', sessionCookie)
        .send({
          name: 'Test Workspace',
          firstStrand: 'Initial Strand'
        });

      assert.strictEqual(response.status, 201);
      assert.ok(response.body.workspace.id);
      assert.strictEqual(response.body.workspace.name, 'Test Workspace');
    });

    it('should not create workspace without auth', async () => {
      const response = await request(app)
        .post('/api/workspace')
        .send({
          name: 'Test Workspace',
          firstStrand: 'Initial Strand'
        });

      assert.strictEqual(response.status, 401);
    });
  });
});
