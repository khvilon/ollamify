import pool from './conf.js';

function normalizeBaseUrl(input) {
  if (!input || typeof input !== 'string') return null;
  let url = input.trim();
  if (!url) return null;
  // Allow users to provide host:port without scheme.
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  // Strip trailing slashes for consistent joins.
  url = url.replace(/\/+$/, '');
  // If user pasted the gateway prefix, normalize to the host root.
  url = url.replace(/\/api$/i, '');
  return url;
}

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  const last4 = trimmed.slice(-4);
  if (trimmed.length <= 4) return '****';
  if (trimmed.length <= 8) return `****${last4}`;
  return `${trimmed.slice(0, 2)}****${last4}`;
}

export const FriendlyServerQueries = {
  normalizeBaseUrl,
  maskApiKey,

  async list({ includeSecrets = false } = {}) {
    if (includeSecrets) {
      const { rows } = await pool.query(`
        SELECT
          id,
          name,
          base_url,
          username,
          api_key,
          enabled,
          created_at,
          updated_at
        FROM admin.friendly_servers
        ORDER BY created_at DESC
      `);
      return rows;
    }

    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        base_url,
        username,
        enabled,
        created_at,
        updated_at,
        RIGHT(api_key, 4) AS api_key_last4,
        CASE WHEN api_key IS NULL OR api_key = '' THEN false ELSE true END AS has_api_key
      FROM admin.friendly_servers
      ORDER BY created_at DESC
    `);
    return rows.map(r => ({
      ...r,
      api_key_masked: r.has_api_key ? `****${r.api_key_last4}` : '',
    }));
  },

  async listEnabledWithSecrets() {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        base_url,
        username,
        api_key,
        enabled,
        created_at,
        updated_at
      FROM admin.friendly_servers
      WHERE enabled = true
      ORDER BY created_at DESC
    `);
    return rows.map(r => ({
      ...r,
      base_url: normalizeBaseUrl(r.base_url) || r.base_url,
    }));
  },

  async findById(id, { includeSecrets = false } = {}) {
    if (!id) return null;
    const { rows } = await pool.query(
      `
        SELECT
          id,
          name,
          base_url,
          username,
          ${includeSecrets ? 'api_key,' : 'RIGHT(api_key, 4) AS api_key_last4,'}
          enabled,
          created_at,
          updated_at
        FROM admin.friendly_servers
        WHERE id = $1
      `,
      [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (includeSecrets) {
      return {
        ...row,
        base_url: normalizeBaseUrl(row.base_url) || row.base_url,
      };
    }
    return {
      ...row,
      api_key_masked: row.api_key_last4 ? `****${row.api_key_last4}` : '',
      base_url: normalizeBaseUrl(row.base_url) || row.base_url,
    };
  },

  async create({ name, base_url, username = null, api_key, enabled = true } = {}) {
    const normalizedUrl = normalizeBaseUrl(base_url);
    if (!normalizedUrl) {
      throw new Error('base_url is required');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('name is required');
    }
    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      throw new Error('api_key is required');
    }

    const { rows } = await pool.query(
      `
        INSERT INTO admin.friendly_servers (name, base_url, username, api_key, enabled, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING id, name, base_url, username, enabled, created_at, updated_at
      `,
      [name.trim(), normalizedUrl, username ? String(username).trim() : null, api_key.trim(), !!enabled]
    );
    return rows[0];
  },

  async update(id, { name, base_url, username, api_key, enabled } = {}) {
    if (!id) throw new Error('id is required');

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(String(name).trim());
    }
    if (base_url !== undefined) {
      const normalizedUrl = normalizeBaseUrl(base_url);
      if (!normalizedUrl) throw new Error('base_url is invalid');
      fields.push(`base_url = $${idx++}`);
      values.push(normalizedUrl);
    }
    if (username !== undefined) {
      fields.push(`username = $${idx++}`);
      values.push(username ? String(username).trim() : null);
    }
    if (api_key !== undefined) {
      if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
        throw new Error('api_key is invalid');
      }
      fields.push(`api_key = $${idx++}`);
      values.push(api_key.trim());
    }
    if (enabled !== undefined) {
      fields.push(`enabled = $${idx++}`);
      values.push(!!enabled);
    }

    // Always bump updated_at
    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    const { rows } = await pool.query(
      `
        UPDATE admin.friendly_servers
        SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING id, name, base_url, username, enabled, created_at, updated_at
      `,
      values
    );
    return rows[0] || null;
  },

  async delete(id) {
    const { rows } = await pool.query(
      `
        DELETE FROM admin.friendly_servers
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );
    return rows[0] || null;
  }
};

export default FriendlyServerQueries;

