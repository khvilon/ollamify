import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import documentsRouter from './routes/documents.js';
import modelsRouter from './routes/models.js';
import usersRouter from './routes/users.js';
import projectsRouter from './routes/projects.js';
import aiRouter from './routes/ai.js';
import { errorHandler } from './errors.js';

dotenv.config();

const app = express();
const port = process.env.ZEUS_PORT || 3004;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Middleware для парсинга информации о пользователе
app.use((req, res, next) => {
  const userHeader = req.headers['x-user'];
  console.log('Raw X-User header:', userHeader);
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader);
      console.log('Parsed user:', req.user);
    } catch (error) {
      console.error('Failed to parse X-User header:', error);
      console.error('Header value:', userHeader);
    }
  }
  next();
});

// API роуты
app.use('/api/documents', documentsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/ai', aiRouter);

// Глобальный обработчик ошибок
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Zeus server running on port ${port}`);
});
