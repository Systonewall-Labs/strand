import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Lucia } from 'lucia';
import { PrismaAdapter } from '@lucia-auth/adapter-prisma';

const prisma = new PrismaClient();
const adapter = new PrismaAdapter(prisma.session, prisma.user);

const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax'
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

export {
  lucia,
  createUser,
  getUserByEmail,
  verifyPassword,
  createSession,
  validateSession,
  invalidateSession
};
