import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { specs } from './swagger.js';
import documentsRouter from './routes/documents.js';
import modelsRouter from './routes/models.js';
import usersRouter from './routes/users.js';
import projectsRouter from './routes/projects.js';
import aiRouter from './routes/ai.js';
import adminRouter from './routes/admin.js';
import ttsRouter from './routes/tts.js';
import sttRouter from './routes/stt.js';
import { errorHandler } from './errors.js';
import logger from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import initializeQdrantCollections from './db/init-qdrant.js';
import initializeAdminSchema from './db/admin-init.js';
import http from 'http';
import { initWebSocketServer } from './websocket/index.js';

dotenv.config();

const app = express();
const port = process.env.ZEUS_PORT || 3000;
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

// API документация
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Middleware для парсинга информации о пользователе
app.use((req, res, next) => {
  const userHeader = req.headers['x-user'];
  logger.info('Raw X-User header:', userHeader);
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader);
      logger.info('Parsed user:', req.user);
    } catch (error) {
      logger.error('Failed to parse X-User header:', error);
      logger.error('Header value:', userHeader);
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
app.use('/api/admin', adminRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/stt', sttRouter);

// Маршрут для проверки health
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Глобальный обработчик ошибок
app.use(errorHandler);

// Инициализируем WebSocket сервер
initWebSocketServer(server);

server.listen(port, () => {
  logger.info(`Zeus server running on port ${port}`);
  
  // Инициализируем административную схему сразу
  initializeAdminSchema()
    .then(() => {
      logger.info('Admin schema initialization completed');
    })
    .catch(error => {
      logger.error('Error initializing admin schema:', error);
    });
  
  // Инициализируем Qdrant после запуска сервера
  setTimeout(async () => {
    try {
      logger.info('Initializing Qdrant collections...');
      await initializeQdrantCollections();
      logger.info('Qdrant collections initialized');
    } catch (error) {
      logger.error('Error initializing Qdrant collections:', error);
    }
  }, 5000); // Добавляем задержку 5 секунд, чтобы сервисы успели запуститься
});
