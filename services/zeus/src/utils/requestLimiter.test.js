import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QueueOverflowError,
  QueueTimeoutError,
  createRequestLimiter
} from './requestLimiter.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('runs up to maxActive tasks and queues the rest', async () => {
  const limiter = createRequestLimiter({ maxActive: 1, maxQueue: 2, queueTimeoutMs: 1000 });
  const events = [];

  const first = limiter.run('first', async () => {
    events.push('first:start');
    await sleep(30);
    events.push('first:end');
    return 'first-result';
  });

  await sleep(5);
  const second = limiter.run('second', async () => {
    events.push('second:start');
    return 'second-result';
  });

  assert.deepEqual(limiter.snapshot(), {
    active: 1,
    queued: 1,
    maxActive: 1,
    maxQueue: 2
  });

  assert.equal(await first, 'first-result');
  assert.equal(await second, 'second-result');
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('rejects immediately when queue is full', async () => {
  const limiter = createRequestLimiter({ maxActive: 1, maxQueue: 0, queueTimeoutMs: 1000 });
  const blocker = limiter.run('blocker', () => sleep(30));

  await assert.rejects(
    () => limiter.run('overflow', async () => 'never'),
    QueueOverflowError
  );

  await blocker;
});

test('times out queued tasks that wait too long', async () => {
  const limiter = createRequestLimiter({ maxActive: 1, maxQueue: 1, queueTimeoutMs: 10 });
  const blocker = limiter.run('blocker', () => sleep(40));

  await assert.rejects(
    () => limiter.run('timeout', async () => 'never'),
    QueueTimeoutError
  );

  await blocker;
});
