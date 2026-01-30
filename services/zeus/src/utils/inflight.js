import logger from './logger.js';

const inFlightByInstance = new Map(); // instanceId -> number
const inFlightByModel = new Map(); // model -> number

function incMap(map, key) {
  if (key === undefined || key === null) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function decMap(map, key) {
  if (key === undefined || key === null) return;
  const next = (map.get(key) || 0) - 1;
  if (next <= 0) {
    map.delete(key);
  } else {
    map.set(key, next);
  }
}

export function beginInFlight({ instanceId = null, model = null, label = '' } = {}) {
  incMap(inFlightByInstance, instanceId);
  incMap(inFlightByModel, model);

  let done = false;
  return () => {
    if (done) return;
    done = true;
    decMap(inFlightByInstance, instanceId);
    decMap(inFlightByModel, model);
  };
}

export function getInFlightSnapshot() {
  const byInstance = {};
  let total = 0;
  for (const [k, v] of inFlightByInstance.entries()) {
    byInstance[String(k)] = v;
    total += v;
  }

  const byModel = {};
  for (const [k, v] of inFlightByModel.entries()) {
    byModel[String(k)] = v;
  }

  return {
    total,
    byInstance,
    byModel,
  };
}

export function _debugResetInFlight() {
  logger.warn('Resetting in-flight counters (debug)');
  inFlightByInstance.clear();
  inFlightByModel.clear();
}

