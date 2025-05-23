import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { specs } from './swagger.js';
import { externalSpecs } from './swagger-external.js';
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

// API документация (полная - для админов)
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', (req, res, next) => {
  swaggerUi.setup(specs)(req, res, next);
});

// Внешняя API документация (только для external endpoints)
app.get('/api/docs', (req, res) => {
  const theme = req.query.theme || 'light'; // по умолчанию светлая тема
  
  const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Ollamify External API</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui.css" />
    <style>
       /* Минимальные стили - светлая тема по умолчанию */
       .swagger-ui .topbar { display: none; }
       .swagger-ui .info .description { line-height: 1.6; }
       .swagger-ui .btn.authorize { 
         background-color: #49cc90 !important; 
         border-color: #49cc90 !important;
         color: white !important;
       }
       
       ${theme === 'dark' ? `
       /* Стили для темной темы */
       .swagger-ui {
         background-color: #1a1a1a !important;
       }
       .swagger-ui .info .title {
         color: #60a5fa !important;
       }
       .swagger-ui .info .description,
       .swagger-ui .info .description p,
       .swagger-ui .info .description h2,
       .swagger-ui .info .description h3,
       .swagger-ui .info .description *,
       .swagger-ui .info .description ol,
       .swagger-ui .info .description ul,
       .swagger-ui .info .description li,
       .swagger-ui .info .description div,
       .swagger-ui .info .description code,
       .swagger-ui .info .description span {
         color: #f3f4f6 !important;
       }
       .swagger-ui .scheme-container .schemes > label {
         color: #f3f4f6 !important;
       }
       .swagger-ui .opblock .opblock-summary {
         border-color: #374151 !important;
         background: #374151 !important;
       }
       .swagger-ui .opblock .opblock-summary-description {
         color: #d1d5db !important;
       }
       .swagger-ui .parameter__name {
         color: #ffffff !important;
       }
       .swagger-ui .parameter__type {
         color: #60a5fa !important;
       }
       .swagger-ui .response-col_description__inner p {
         color: #f3f4f6 !important;
       }
       .swagger-ui .model-box {
         background: #374151 !important;
       }
       .swagger-ui .model .property {
         color: #f3f4f6 !important;
       }
       .swagger-ui .property-row .property-name {
         color: #ffffff !important;
       }
       
       /* Исправляем темный текст rgb(59, 65, 81) */
       .swagger-ui .opblock .opblock-summary-path,
       .swagger-ui .opblock .opblock-summary-method,
       .swagger-ui .opblock-description-wrapper p,
       .swagger-ui .opblock-external-docs-wrapper,
       .swagger-ui .opblock-section-header h4,
       .swagger-ui .parameters-col_description p,
       .swagger-ui .parameter__extension,
       .swagger-ui .parameter__in,
       .swagger-ui .renderedMarkdown p,
       .swagger-ui .response-col_description p,
       .swagger-ui .responses-inner h4,
       .swagger-ui .responses-inner h5,
       .swagger-ui .model-title,
       .swagger-ui .model-subtitle,
       .swagger-ui table thead tr th,
       .swagger-ui table tbody tr td {
         color: #f3f4f6 !important;
       }
       
       /* Исправляем элементы с цветом #3b4151 */
       .swagger-ui *[style*="color: rgb(59, 65, 81)"],
       .swagger-ui *[style*="color:#3b4151"] {
         color: #f3f4f6 !important;
       }
       ` : ''}
     </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/api/docs/swagger.json',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.presets.standalone
        ],
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list'
      });
    </script>
  </body>
</html>`;
  res.send(html);
});

// JSON эндпоинт для Swagger спецификации
app.get('/api/docs/swagger.json', (req, res) => {
  res.json(externalSpecs);
});

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
