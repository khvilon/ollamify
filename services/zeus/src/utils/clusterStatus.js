import os from 'os';
import https from 'https';
import logger from './logger.js';
import { fetchWithTimeout, refreshOllamaModelIndex } from './ollama.js';
import { getGpuMetrics } from './gpuMetrics.js';
import { getInFlightSnapshot } from './inflight.js';

const LOCAL_STATUS_TTL_MS = 1500;
let localStatusCache = {
  updatedAt: 0,
  value: null,
};

const REMOTE_STATUS_TTL_MS = 1500;
const remoteStatusCache = new Map(); // serverKey -> { updatedAt, value, lastErrorAt, lastError }

function envTruthy(name) {
  const v = process.env[name];
  if (!v) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
}

function getInsecureAgentForUrl(url) {
  // Optional: allow self-signed TLS for friendly servers.
  if (!envTruthy('FRIENDLY_SERVERS_INSECURE_TLS')) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      return new https.Agent({ rejectUnauthorized: false });
    }
  } catch {
    // ignore
  }
  return undefined;
}

function safeNumber(val) {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

function computeVramUtilPercent(gpu) {
  if (!gpu) return null;
  const used = safeNumber(gpu.memory_used_mb);
  const total = safeNumber(gpu.memory_total_mb);
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

function normalizeModelName(str) {
  if (!str || typeof str !== 'string') return null;
  return str.trim();
}

export async function getLocalClusterStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && localStatusCache.value && (now - localStatusCache.updatedAt) < LOCAL_STATUS_TTL_MS) {
    return localStatusCache.value;
  }

  const [gpuMetrics, idx] = await Promise.all([
    getGpuMetrics(),
    refreshOllamaModelIndex({ force: true }),
  ]);

  const instances = idx.instances || [];

  const installed = [];
  for (const inst of idx.instances || []) {
    const models = idx.modelsByInstance?.get(inst.id) || [];
    for (const m of models) {
      installed.push({
        ...m,
        gpu: inst.id,
        gpu_label: inst.name,
      });
    }
  }

  const loaded = [];
  await Promise.all((instances || []).map(async (inst) => {
    try {
      const r = await fetchWithTimeout(`${inst.baseUrl}/api/ps`, { method: 'GET' }, 5000);
      if (!r.ok) {
        return;
      }
      const data = await r.json();
      const models = Array.isArray(data.models) ? data.models : [];
      for (const m of models) {
        loaded.push({
          ...m,
          gpu: inst.id,
          gpu_label: inst.name,
        });
      }
    } catch (e) {
      // non-fatal
      logger.warn(`Failed to fetch /api/ps from ${inst.baseUrl}: ${e?.message || e}`);
    }
  }));

  const inflight = getInFlightSnapshot();

  const status = {
    server: {
      id: process.env.OLLAMIFY_SERVER_ID || process.env.DOMAIN || os.hostname(),
      hostname: os.hostname(),
    },
    updatedAt: now,
    instances,
    gpus: gpuMetrics.gpus || [],
    metricsAvailable: !!gpuMetrics.metricsAvailable,
    metricsStale: !!gpuMetrics.metricsStale,
    metricsUpdatedAt: gpuMetrics.metricsUpdatedAt || null,
    load: {
      in_flight_total: inflight.total,
      in_flight_by_instance: inflight.byInstance,
      in_flight_by_model: inflight.byModel,
    },
    models: {
      installed,
      loaded,
    },
  };

  localStatusCache = { updatedAt: now, value: status };
  return status;
}

export function getModelPlacementFromStatus(status, modelName) {
  const model = normalizeModelName(modelName);
  if (!status || !model) {
    return {
      installed: false,
      loaded: false,
      instanceId: null,
      gpu: null,
      gpuUtilPercent: null,
      vramUtilPercent: null,
      inFlight: 0,
    };
  }

  const installedEntry = (status.models?.installed || []).find(m => normalizeModelName(m?.name || m?.model) === model);
  const loadedEntry = (status.models?.loaded || []).find(m => normalizeModelName(m?.model || m?.name) === model);

  // Prefer gpu from loadedEntry (actual runtime), otherwise from installedEntry.
  const gpu = loadedEntry?.gpu ?? installedEntry?.gpu ?? null;
  const instanceId = gpu;

  const gpuMetrics = (status.gpus || []).find(g => String(g.index) === String(gpu));
  const gpuUtilPercent = safeNumber(gpuMetrics?.utilization_gpu_percent);
  const vramUtilPercent = computeVramUtilPercent(gpuMetrics);

  const inFlight = safeNumber(status.load?.in_flight_by_instance?.[String(instanceId)]) || 0;

  return {
    installed: !!installedEntry,
    loaded: !!loadedEntry,
    instanceId,
    gpu,
    gpuUtilPercent,
    vramUtilPercent,
    inFlight,
  };
}

export async function fetchRemoteClusterStatus(server, { timeoutMs = 3500, force = false } = {}) {
  if (!server || !server.base_url || !server.api_key) {
    throw new Error('Invalid friendly server config (base_url/api_key required)');
  }

  const serverKey = String(server.id || server.base_url);
  const now = Date.now();
  const cached = remoteStatusCache.get(serverKey);
  if (!force && cached?.value && (now - cached.updatedAt) < REMOTE_STATUS_TTL_MS) {
    return cached.value;
  }

  const url = `${String(server.base_url).replace(/\/+$/, '')}/api/cluster/status`;
  const agent = getInsecureAgentForUrl(url);

  const startedAt = Date.now();
  const r = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${server.api_key}`,
      'Accept': 'application/json',
      // Prevent routing loops inside a friendly server in case it ever tries to forward status calls.
      'X-Ollamify-No-Forward': '1',
      'X-Ollamify-Forwarded-By': process.env.OLLAMIFY_SERVER_ID || os.hostname(),
    },
    agent,
  }, timeoutMs);

  const latencyMs = Date.now() - startedAt;

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const err = new Error(`Remote status failed (${r.status} ${r.statusText}): ${text || 'no body'}`);
    remoteStatusCache.set(serverKey, { updatedAt: now, value: null, lastErrorAt: now, lastError: err.message });
    throw err;
  }

  const data = await r.json();
  const enriched = {
    ...data,
    _remote: {
      id: server.id || null,
      name: server.name || null,
      base_url: server.base_url,
      latency_ms: latencyMs,
    },
  };

  remoteStatusCache.set(serverKey, { updatedAt: now, value: enriched, lastErrorAt: null, lastError: null });
  return enriched;
}

