import { verifyPassword } from './auth.js';
import bcrypt from 'bcryptjs';
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Auth', () => {
  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'testpassword123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await verifyPassword(password, hashedPassword);
      assert.strictEqual(result, true);
    });

    it('should reject incorrect password', async () => {
      const password = 'testpassword123';
      const wrongPassword = 'wrongpassword';
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await verifyPassword(wrongPassword, hashedPassword);
      assert.strictEqual(result, false);
    });
  });
});
