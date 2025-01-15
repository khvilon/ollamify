import express from 'express';
import { UserQueries } from '../db/users.js';
import { asyncHandler } from '../errors.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const router = express.Router();
const saltRounds = 10;

const hashPassword = async (password) => {
  return await bcrypt.hash(password, saltRounds);
};

const generateApiKey = () => {
  return crypto.randomBytes(32)
    .toString('hex');
};

// Users CRUD
router.get('/', asyncHandler(async (req, res) => {
  const users = await UserQueries.findAll();
  res.json(users);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const user = await UserQueries.findById(req.params.id);
  res.json(user);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const updateData = {
    ...(email && { email }),
    ...(password && { password_hash: await hashPassword(password) }),
    ...(role && { is_admin: role === 'admin' })
  };
  
  const user = await UserQueries.update(req.params.id, updateData);
  res.json(user);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await UserQueries.deleteById(req.params.id);
  res.status(204).end();
}));

router.post('/', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const passwordHash = await hashPassword(password);
  const user = await UserQueries.create(email, email, passwordHash, role === 'admin');
  res.status(201).json(user);
}));

// API Keys
router.get('/:userId/api-keys', asyncHandler(async (req, res) => {
  const keys = await UserQueries.findApiKeysByUserId(req.params.userId);
  res.json(keys);
}));

router.post('/:userId/api-keys', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const keyValue = generateApiKey();
  const key = await UserQueries.createApiKey(name, keyValue, req.params.userId);
  res.status(201).json(key);
}));

router.put('/:userId/api-keys/:keyId', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const key = await UserQueries.updateApiKey(req.params.keyId, name, req.params.userId);
  res.json(key);
}));

router.delete('/:userId/api-keys/:keyId', asyncHandler(async (req, res) => {
  await UserQueries.deleteApiKey(req.params.keyId, req.params.userId);
  res.status(204).end();
}));

export default router;
