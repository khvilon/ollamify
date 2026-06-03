import test from 'node:test';
import assert from 'node:assert/strict';

import { canAccessUserResource, isAdminUser } from './accessControl.js';

test('admin users can access any user resource', () => {
  assert.equal(isAdminUser({ role: 'admin' }), true);
  assert.equal(isAdminUser({ isAdmin: true }), true);
  assert.equal(isAdminUser({ is_admin: true }), true);
  assert.equal(canAccessUserResource({ id: 1, role: 'admin' }, 42), true);
});

test('regular users can access only their own resource', () => {
  assert.equal(isAdminUser({ role: 'user' }), false);
  assert.equal(canAccessUserResource({ id: 7, role: 'user' }, 7), true);
  assert.equal(canAccessUserResource({ userId: 7, role: 'user' }, '7'), true);
  assert.equal(canAccessUserResource({ id: 7, role: 'user' }, 8), false);
});

test('missing or invalid users cannot access user resources', () => {
  assert.equal(canAccessUserResource(null, 1), false);
  assert.equal(canAccessUserResource({ id: 'abc' }, 1), false);
  assert.equal(canAccessUserResource({ id: 1 }, 'abc'), false);
});
