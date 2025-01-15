import pool from './conf.js';
import { NotFoundError } from '../errors.js';

export const UserQueries = {
  async findAll() {
    const { rows } = await pool.query(`
      SELECT id, username, email, is_admin, created_at
      FROM admin.users
      ORDER BY created_at DESC
    `);
    return rows;
  },

  async findById(id) {
    const { rows } = await pool.query(`
      SELECT id, username, email, is_admin, created_at
      FROM admin.users
      WHERE id = $1
    `, [id]);
    
    if (!rows.length) {
      throw new NotFoundError('User');
    }
    
    return rows[0];
  },

  async update(id, updateData) {
    const updates = [];
    const values = [];
    let valueIndex = 1;

    // Формируем SET часть запроса из объекта updateData
    for (const [key, value] of Object.entries(updateData)) {
      updates.push(`${key} = $${valueIndex}`);
      values.push(value);
      valueIndex++;
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(id);
    const { rows } = await pool.query(`
      UPDATE admin.users
      SET ${updates.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING id, username, email, is_admin, created_at
    `, values);

    if (!rows.length) {
      throw new NotFoundError('User');
    }

    return rows[0];
  },

  async deleteById(id) {
    const { keys } = await pool.query(`
      DELETE FROM admin.api_keys
      WHERE user_id = $1
      RETURNING id
    `, [id]);

    const { rows } = await pool.query(`
      DELETE FROM admin.users
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (!rows.length) {
      throw new NotFoundError('User');
    }

    return rows[0];
  },

  async create(username, email, passwordHash, isAdmin) {
    const { rows } = await pool.query(`
      INSERT INTO admin.users (username, email, password_hash, is_admin)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, is_admin, created_at
    `, [username, email, passwordHash, isAdmin]);

    return rows[0];
  },

  async findApiKeysByUserId(userId) {
    const { rows } = await pool.query(`
      SELECT id, name, key_value, created_at
      FROM admin.api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return rows;
  },

  async createApiKey(name, keyValue, userId) {
    const { rows } = await pool.query(`
      INSERT INTO admin.api_keys (name, key_value, user_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, key_value, created_at
    `, [name, keyValue, userId]);
    return rows[0];
  },

  async updateApiKey(keyId, name, userId) {
    const { rows } = await pool.query(`
      UPDATE admin.api_keys
      SET name = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, name, key_value, created_at
    `, [name, keyId, userId]);

    if (!rows.length) {
      throw new NotFoundError('API key');
    }

    return rows[0];
  },

  async deleteApiKey(keyId, userId) {
    const { rows } = await pool.query(`
      DELETE FROM admin.api_keys
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `, [keyId, userId]);

    if (!rows.length) {
      throw new NotFoundError('API key');
    }

    return rows[0];
  }
};
