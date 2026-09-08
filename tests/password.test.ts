import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, PasswordBusy } from '../app/server/password.ts';

test('a member can verify the original password, while a wrong password is rejected', async () => {
  const password = 'a-test-password-not-a-real-account';
  const stored = await hashPassword(password);
  assert.equal(stored.includes(password), false);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword('wrong-password', stored), false);
});

test('expensive password jobs are bounded and recover after the active job completes', async () => {
  const pending=hashPassword('a-password-job-that-is-running');
  await assert.rejects(()=>hashPassword('a-second-concurrent-password'),PasswordBusy);
  const stored=await pending;
  assert.equal(await verifyPassword('a-password-job-that-is-running',stored),true);
});

test('unsupported or malformed stored hashes cannot select unsafe KDF parameters', async () => {
  assert.equal(await verifyPassword('anything','scrypt$1$999999999$8$3$salt$hash'),false);
  assert.equal(await verifyPassword('anything','plaintext'),false);
});
