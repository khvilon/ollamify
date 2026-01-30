import os from 'os';
import https from 'https';
import logger from './logger.js';
import FriendlyServerQueries from '../db/friendly-servers.js';
import { fetchWithTimeout } from './ollama.js';
import { fetchRemoteClusterStatus, getLocalClusterStatus, getModelPlacementFromStatus } from './clusterStatus.js';

const HEADER_NO_FORWARD = 'x-ollamify-no-forward';
const HEADER_EXECUTED_ON = 'x-ollamify-executed-on';
const HEADER_FORWARDED_BY = 'x-ollamify-forwarded-by';

const FRIENDLY_LIST_TTL_MS = 5_000;
let friendlyListCache = { updatedAt: 0, value: [] };

function envTruthy(name) {
  const v = process.env[name];
  if (!v) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
}

function headerTruthy(val) {
  if (val === undefined || val === null) return false;
  const s = Array.isArray(val) ? String(val[0]) : String(val);
  return ['1', 'true', 'yes', 'y', 'on'].includes(s.toLowerCase());
}

function isOpenRouterModel(model) {
  return typeof model === 'string' && model.startsWith('openrouter/');
}

function getInsecureAgentForUrl(url) {
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

function safeNum(n, fallback = null) {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function computeCost({ placement, remoteLatencyMs = 0 }) {
  // Lower is better.
  const coldPenalty = placement.loaded ? 0 : 60;
  const inFlightPenalty = placement.inFlight * 25;
  const gpuPenalty = placement.gpuUtilPercent != null ? placement.gpuUtilPercent * 0.6 : 0;
  const vramPenalty = placement.vramUtilPercent != null ? placement.vramUtilPercent * 0.2 : 0;
  const latencyPenalty = remoteLatencyMs ? Math.min(50, remoteLatencyMs / 20) : 0;
  return coldPenalty + inFlightPenalty + gpuPenalty + vramPenalty + latencyPenalty;
}

export function isNoForward(req) {
  return headerTruthy(req?.headers?.[HEADER_NO_FORWARD]);
}

async function getEnabledFriendlyServersCached() {
  const now = Date.now();
  if (friendlyListCache.value && (now - friendlyListCache.updatedAt) < FRIENDLY_LIST_TTL_MS) {
    return friendlyListCache.value;
  }
  const servers = await FriendlyServerQueries.listEnabledWithSecrets();
  friendlyListCache = { updatedAt: now, value: servers };
  return servers;
}

export async function pickExecutionTarget({ model, req }) {
  // Returns: { type: 'local' } or { type: 'friendly', server, debug }
  if (!model || typeof model !== 'string') {
    return { type: 'local', debug: { reason: 'missing_model' } };
  }

  if (envTruthy('FRIENDLY_ROUTING_DISABLED')) {
    return { type: 'local', debug: { reason: 'routing_disabled' } };
  }

  if (isOpenRouterModel(model)) {
    return { type: 'local', debug: { reason: 'openrouter_model' } };
  }

  if (isNoForward(req)) {
    return { type: 'local', debug: { reason: 'no_forward_header' } };
  }

  const localStatus = await getLocalClusterStatus();
  const localPlacement = getModelPlacementFromStatus(localStatus, model);

  // Fast path: warm model locally and local is not busy.
  const localWarmPrefer = localPlacement.loaded
    && (localPlacement.inFlight <= 0)
    && (localPlacement.gpuUtilPercent === null || localPlacement.gpuUtilPercent < 70);

  if (localWarmPrefer) {
    return {
      type: 'local',
      debug: {
        reason: 'local_warm_and_free',
        local: localPlacement,
      }
    };
  }

  const friends = await getEnabledFriendlyServersCached();
  if (!Array.isArray(friends) || friends.length === 0) {
    return {
      type: 'local',
      debug: {
        reason: 'no_friendly_servers',
        local: localPlacement,
      }
    };
  }

  const localEligible = localPlacement.installed;
  const localCost = localEligible ? computeCost({ placement: localPlacement, remoteLatencyMs: 0 }) : Number.POSITIVE_INFINITY;

  let best = {
    type: 'local',
    cost: localCost,
    debug: { reason: 'local_default', local: localPlacement },
  };

  // Hysteresis: remote should be clearly better to justify network + possible cold start.
  const IMPROVEMENT_MARGIN = 15;

  for (const server of friends) {
    try {
      const remoteStatus = await fetchRemoteClusterStatus(server);
      const remotePlacement = getModelPlacementFromStatus(remoteStatus, model);

      if (!remotePlacement.installed) {
        continue;
      }

      const remoteLatencyMs = safeNum(remoteStatus?._remote?.latency_ms, 0) || 0;
      const remoteCost = computeCost({ placement: remotePlacement, remoteLatencyMs });

      // If local cannot serve the model, any eligible remote wins.
      const remoteBeatsLocal = !Number.isFinite(best.cost)
        ? true
        : (remoteCost + IMPROVEMENT_MARGIN) < best.cost;

      if (remoteBeatsLocal) {
        best = {
          type: 'friendly',
          server,
          cost: remoteCost,
          debug: {
            reason: 'friendly_better',
            local: localPlacement,
            remote: remotePlacement,
            remoteLatencyMs,
          },
        };
      }
    } catch (e) {
      // Remote failures are non-fatal.
      logger.warn(`Friendly server status failed (${server?.name || server?.base_url}): ${e?.message || e}`);
      continue;
    }
  }

  // If local cannot serve and we didn't find a remote that can, keep local (will error normally).
  return best.type === 'friendly'
    ? { type: 'friendly', server: best.server, debug: best.debug }
    : { type: 'local', debug: best.debug };
}

export async function forwardToFriendly({ req, res, server, path, timeoutMs = 600_000 }) {
  const baseUrl = String(server.base_url || '').replace(/\/+$/, '');
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const agent = getInsecureAgentForUrl(url);

  const forwardedBy = process.env.OLLAMIFY_SERVER_ID || os.hostname();

  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${server.api_key}`,
      'Content-Type': 'application/json',
      'Accept': req.headers?.accept || 'application/json',
      'X-Ollamify-No-Forward': '1',
      'X-Ollamify-Forwarded-By': forwardedBy,
    },
    body: JSON.stringify(req.body ?? {}),
    agent,
  }, timeoutMs);

  // Propagate a minimal set of headers.
  res.status(r.status);
  const contentType = r.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  const cacheControl = r.headers.get('cache-control');
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);

  res.setHeader(HEADER_EXECUTED_ON, `friendly:${server.id || server.name || server.base_url}`);
  res.setHeader(HEADER_FORWARDED_BY, forwardedBy);

  if (r.body) {
    r.body.pipe(res);
  } else {
    const text = await r.text().catch(() => '');
    res.send(text);
  }
}

