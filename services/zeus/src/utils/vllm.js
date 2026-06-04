async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function pipeFetchBody(response, res) {
  if (!response.body) {
    const text = await response.text().catch(() => '');
    res.send(text);
    return;
  }

  if (typeof response.body.pipe === 'function') {
    response.body.pipe(res);
    return;
  }

  for await (const chunk of response.body) {
    res.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  res.end();
}

const VLLM_MANAGER_URL = process.env.VLLM_MANAGER_URL || 'http://vllm-manager:8007';
const VLLM_STATUS_TIMEOUT_MS = Number(process.env.VLLM_STATUS_TIMEOUT_MS) || 1500;
const VLLM_LOAD_TIMEOUT_MS = Number(process.env.VLLM_LOAD_TIMEOUT_MS) || 30_000;
const VLLM_COMPLETION_TIMEOUT_MS = Number(process.env.VLLM_COMPLETION_TIMEOUT_MS) || 600_000;
const DEFAULT_VLLM_OUTPUT_TOKEN_FRACTION = 0.25;

let cachedStatus = {
  updatedAt: 0,
  value: null
};

export function normalizeVllmRequestedModel(model) {
  if (typeof model !== 'string') {
    return '';
  }

  let normalized = model.trim();
  if (normalized.startsWith('vllm/')) {
    normalized = normalized.slice('vllm/'.length);
  }

  try {
    const url = new URL(normalized);
    if (url.hostname === 'huggingface.co') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        normalized = `${parts[0]}/${parts[1]}`;
      }
    }
  } catch {
    // Not a URL; keep as model id.
  }

  return normalized.replace(/^\/+/, '');
}

export function buildVllmModelOptionsFromOllamaIndex(idx) {
  const modelsByInstance = idx?.modelsByInstance;
  if (!modelsByInstance || typeof modelsByInstance.values !== 'function') {
    return [];
  }

  const names = [];
  const seen = new Set();

  for (const models of modelsByInstance.values()) {
    for (const model of models || []) {
      const name = model?.name || model?.model;
      if (!name || seen.has(name)) {
        continue;
      }

      const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
      const embeddingOnly = capabilities.length > 0
        && capabilities.includes('embedding')
        && !capabilities.includes('completion');

      if (embeddingOnly) {
        continue;
      }

      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

export function doesVllmServeModel(status, model) {
  const requested = normalizeVllmRequestedModel(model);
  if (!requested || !status?.available || status.state !== 'running') {
    return false;
  }

  const servedModels = new Set([
    status.current_model,
    ...(Array.isArray(status.served_models) ? status.served_models : [])
  ].filter(Boolean).map(normalizeVllmRequestedModel));

  return servedModels.has(requested);
}

export function getVllmMaxModelLen(status) {
  const command = Array.isArray(status?.command) ? status.command : [];
  const maxModelLenIndex = command.indexOf('--max-model-len');
  if (maxModelLenIndex === -1 || maxModelLenIndex >= command.length - 1) {
    return null;
  }

  const parsed = Number(command[maxModelLenIndex + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

export function getVllmCompletionMaxTokens(status, requestedMaxTokens, fallbackMaxTokens = 512) {
  const requested = Number(requestedMaxTokens);
  const fallback = Number(fallbackMaxTokens);
  const requestedLimit = Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : (Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 512);

  const maxModelLen = getVllmMaxModelLen(status);
  if (!maxModelLen) {
    return requestedLimit;
  }

  const outputBudget = Math.max(64, Math.floor(maxModelLen * DEFAULT_VLLM_OUTPUT_TOKEN_FRACTION));
  return Math.min(requestedLimit, outputBudget);
}

export async function getVllmStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedStatus.value && (now - cachedStatus.updatedAt) < 1000) {
    return cachedStatus.value;
  }

  try {
    const response = await fetchWithTimeout(`${VLLM_MANAGER_URL}/status`, { method: 'GET' }, VLLM_STATUS_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`vLLM manager status failed: ${response.status} ${response.statusText}`);
    }

    const status = await response.json();
    const value = {
      available: true,
      ...status
    };
    cachedStatus = { updatedAt: now, value };
    return value;
  } catch (error) {
    const value = {
      available: false,
      state: 'unavailable',
      error: error.message
    };
    cachedStatus = { updatedAt: now, value };
    return value;
  }
}

export async function loadVllmModel({ model, extra_args = [] } = {}) {
  const normalizedModel = normalizeVllmRequestedModel(model);
  if (!normalizedModel) {
    const error = new Error('vLLM model is required');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetchWithTimeout(`${VLLM_MANAGER_URL}/load`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: normalizedModel,
      extra_args: Array.isArray(extra_args) ? extra_args : []
    })
  }, VLLM_LOAD_TIMEOUT_MS);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`vLLM model load failed: ${response.status} ${body}`);
  }

  cachedStatus = { updatedAt: 0, value: null };
  return response.json();
}

export async function unloadVllmModel() {
  const response = await fetchWithTimeout(`${VLLM_MANAGER_URL}/unload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, VLLM_LOAD_TIMEOUT_MS);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`vLLM unload failed: ${response.status} ${body}`);
  }

  cachedStatus = { updatedAt: 0, value: null };
  return response.json();
}

export async function getVllmTargetForModel(model) {
  const status = await getVllmStatus();
  if (!doesVllmServeModel(status, model)) {
    return null;
  }

  return {
    status,
    model: normalizeVllmRequestedModel(model),
    baseUrl: VLLM_MANAGER_URL
  };
}

export async function callVllmChatCompletions(payload, timeoutMs = VLLM_COMPLETION_TIMEOUT_MS) {
  const response = await fetchWithTimeout(`${VLLM_MANAGER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`vLLM API error: ${response.status} ${body}`);
  }

  return response;
}

export async function forwardToVllm({ req, res, path = '/v1/chat/completions', timeoutMs = VLLM_COMPLETION_TIMEOUT_MS }) {
  const response = await fetchWithTimeout(`${VLLM_MANAGER_URL}${path}`, {
    method: req.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': req.headers?.accept || 'application/json'
    },
    body: JSON.stringify(req.body ?? {})
  }, timeoutMs);

  res.status(response.status);
  const contentType = response.headers.get('content-type');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  res.setHeader('X-Ollamify-Executed-On', 'vllm');

  if (response.body) {
    await pipeFetchBody(response, res);
  } else {
    const text = await response.text().catch(() => '');
    res.send(text);
  }
}
