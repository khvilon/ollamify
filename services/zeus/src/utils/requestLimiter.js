export class QueueOverflowError extends Error {
  constructor(message = 'Request queue is full') {
    super(message);
    this.name = 'QueueOverflowError';
    this.statusCode = 429;
    this.code = 'QUEUE_FULL';
  }
}

export class QueueTimeoutError extends Error {
  constructor(message = 'Request waited too long in queue') {
    super(message);
    this.name = 'QueueTimeoutError';
    this.statusCode = 503;
    this.code = 'QUEUE_TIMEOUT';
  }
}

function normalizePositiveInteger(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : fallback;
}

export function createRequestLimiter({ maxActive = 1, maxQueue = 0, queueTimeoutMs = 60_000 } = {}) {
  const normalizedMaxActive = Math.max(1, normalizePositiveInteger(maxActive, 1));
  const normalizedMaxQueue = normalizePositiveInteger(maxQueue, 0);
  const normalizedQueueTimeoutMs = Math.max(1, normalizePositiveInteger(queueTimeoutMs, 60_000));

  let active = 0;
  const queue = [];

  function snapshot() {
    return {
      active,
      queued: queue.length,
      maxActive: normalizedMaxActive,
      maxQueue: normalizedMaxQueue
    };
  }

  function pump() {
    while (active < normalizedMaxActive && queue.length > 0) {
      const item = queue.shift();
      if (item.done) {
        continue;
      }

      item.done = true;
      clearTimeout(item.timer);
      execute(item);
    }
  }

  async function execute(item) {
    active += 1;
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      active -= 1;
      pump();
    }
  }

  function run(label, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Limiter task must be a function');
    }

    if (active < normalizedMaxActive) {
      return new Promise((resolve, reject) => {
        execute({ label, fn, resolve, reject, done: true });
      });
    }

    if (queue.length >= normalizedMaxQueue) {
      return Promise.reject(new QueueOverflowError());
    }

    return new Promise((resolve, reject) => {
      const item = {
        label,
        fn,
        resolve,
        reject,
        done: false,
        timer: null
      };

      item.timer = setTimeout(() => {
        if (item.done) {
          return;
        }

        item.done = true;
        const idx = queue.indexOf(item);
        if (idx >= 0) {
          queue.splice(idx, 1);
        }
        reject(new QueueTimeoutError());
      }, normalizedQueueTimeoutMs);

      queue.push(item);
      pump();
    });
  }

  return {
    run,
    snapshot
  };
}
