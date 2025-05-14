import express from 'express';
import pool from '../db/conf.js';
import { createProjectSchema } from '../db/init.js';
import multer from 'multer';
import crypto from 'crypto';
import pdfParseFork from 'pdf-parse-fork';
import mammoth from 'mammoth';
import { getEmbedding, getEmbeddingDimension, splitIntoChunks } from '../embeddings.js';
import { render_page, sanitizeText } from '../documentsTools.js';
import DocumentQueries from '../db/documents.js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import qdrantClient from '../db/qdrant.js';
import { broadcastDocumentUpdate, broadcastProjectStatsUpdate } from '../websocket/index.js';

dotenv.config();

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
if (!EMBEDDING_MODEL) {
  throw new Error('EMBEDDING_MODEL environment variable is required');
}

const router = express.Router();

// Configure multer for handling large files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
}).single('file');

// Middleware to handle file uploads with proper encoding
const uploadWithEncoding = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      logger.error('Multer error:', err);
      return res.status(400).json({
        error: 'File upload error',
        details: err.message
      });
    }
    
    // Ensure originalname is properly decoded from UTF-8
    if (req.file) {
      req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }
    next();
  });
};

/**
 * @swagger
 * /documents:
 *   get:
 *     tags: [Documents]
 *     summary: Get list of documents
 *     description: Retrieve a paginated list of documents with optional filtering and search
 *     parameters:
 *       - in: query
 *         name: project
 *         schema:
 *           type: string
 *         description: Project name to filter documents
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: order_by
 *         schema:
 *           type: string
 *           enum: [created_at, name, total_chunks, loaded_chunks]
 *           default: created_at
 *         description: Field to sort by
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *         description: Sort order
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search query for document names
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentList'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
  const { 
    project, 
    page = 1, 
    limit = 10, 
    order_by = 'created_at', 
    order = 'DESC',
    search = '',
    project_filter = ''
  } = req.query;
  
  const offset = (page - 1) * limit;
  
  // Проверяем допустимые значения для сортировки
  const allowedOrderBy = ['created_at', 'name', 'total_chunks', 'loaded_chunks'];
  const orderByField = allowedOrderBy.includes(order_by) ? order_by : 'created_at';
  const orderDirection = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
  try {
    if (project) {
      // Проверяем существует ли схема
      const schemaExists = await pool.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = $1
      `, [project]);
      
      if (schemaExists.rows.length === 0) {
        logger.info(`Project "${project}" not found, returning empty array`);
        return res.json({
          documents: [],
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          total_pages: 0
        });
      }
      
      // Формируем параметры запроса
      const queryParams = [];
      let paramIndex = 1;

      // Добавляем LIMIT и OFFSET
      queryParams.push(limit);
      queryParams.push(offset);

      // Формируем условия WHERE для поиска
      const whereConditions = [];

      if (search) {
        whereConditions.push(`name ILIKE $${paramIndex}`);
        queryParams.push(`%${search}%`);
        paramIndex++;
        logger.info(`Search condition added: search="${search}", paramIndex=${paramIndex-1}`);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';
      
      logger.info(`Executing search query with conditions: ${whereClause}`);
      logger.info(`Query params: ${JSON.stringify(queryParams)}`);

      // Получаем общее количество документов с учетом поиска
      const countResult = await pool.query(`
        SELECT COUNT(*) as total
        FROM "${project}".documents
        ${whereClause}
      `, whereConditions.length > 0 ? queryParams.slice(2) : []);
      
      const total = parseInt(countResult.rows[0].total);
      const total_pages = Math.ceil(total / limit);
      
      // Получаем документы с пагинацией и поиском
      const result = await pool.query(`
        SELECT 
          id,
          name,
          content_hash,
          total_chunks,
          loaded_chunks,
          metadata,
          created_at,
          external_id,
          '${project}' as project
        FROM "${project}".documents
        ${whereClause}
        ORDER BY ${orderByField} ${orderDirection}
        LIMIT $1 OFFSET $2
      `, queryParams);
      
      logger.info(`Found ${result.rows.length} documents in project "${project}" (page ${page} of ${total_pages})`);
      
      res.json({
        documents: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages
      });
    } else {
      // Для всех проектов
      const schemas = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN (
          'information_schema',
          'pg_catalog',
          'pg_toast',
          'public',
          'admin'
        )
        AND schema_name NOT LIKE 'pg_%'
        ${project_filter ? `AND schema_name = $1` : ''}
      `, project_filter ? [project_filter] : []);
      
      logger.info(`Found ${schemas.rows.length} project schemas`);
      
      let total = 0;
      const allDocuments = [];
      
      // Формируем условия WHERE для поиска
      const whereConditions = [];
      const queryParams = [];
      let paramIndex = 1;

      if (search) {
        whereConditions.push(`name ILIKE $${paramIndex}`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';
      
      logger.info(`Executing search query with conditions: ${whereClause}`);
      logger.info(`Query params: ${JSON.stringify(queryParams)}`);

      for (const schema of schemas.rows) {
        const projectName = schema.schema_name;
        try {
          // Проверяем существование таблицы documents в схеме
          const tableExists = await pool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = $1 
              AND table_name = 'documents'
            )
          `, [projectName]);
          
          if (!tableExists.rows[0].exists) {
            logger.info(`Table 'documents' does not exist in schema "${projectName}", skipping`);
            continue;
          }
          
          // Получаем количество документов в проекте
          const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM "${projectName}".documents
            ${whereClause}
          `, queryParams);
          
          total += parseInt(countResult.rows[0].total);
          
          // Получаем документы с пагинацией
          const docs = await pool.query(`
            SELECT 
              id,
              name,
              content_hash,
              total_chunks,
              loaded_chunks,
              metadata,
              created_at,
              external_id,
              '${projectName}' as project
            FROM "${projectName}".documents
            ${whereClause}
            ORDER BY ${orderByField} ${orderDirection}
            LIMIT ${parseInt(limit)} OFFSET ${offset}
          `, queryParams);
          
          allDocuments.push(...docs.rows);
        } catch (err) {
          logger.error(`Error fetching documents from project "${projectName}":`, err);
          continue;
        }
      }
      
      // Сортируем все документы
      allDocuments.sort((a, b) => {
        const aValue = a[orderByField];
        const bValue = b[orderByField];
        if (orderDirection === 'ASC') {
          return aValue > bValue ? 1 : -1;
        }
        return aValue < bValue ? 1 : -1;
      });
      
      const total_pages = Math.ceil(total / limit);
      
      logger.info(`Returning ${allDocuments.length} documents (page ${page} of ${total_pages})`);
      
      res.json({
        documents: allDocuments,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages
      });
    }
  } catch (error) {
    logger.error('Error in GET /documents:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

// Получение списка проектов (схем)
router.get('/projects', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT name, embedding_model 
            FROM admin.projects 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        logger.error('Error getting projects:', err);
        res.status(500).json({ error: 'Failed to get projects' });
    }
});

/**
 * @swagger
 * /documents:
 *   post:
 *     tags: [Documents]
 *     summary: Upload a document
 *     description: Upload a new document file or text content
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document file to upload (PDF, DOCX, TXT)
 *               project:
 *                 type: string
 *                 description: Project name to associate document with
 *               name:
 *                 type: string
 *                 description: Custom name for the document (optional)
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *               - project
 *             properties:
 *               content:
 *                 type: string
 *                 description: Text content for the document
 *               project:
 *                 type: string
 *                 description: Project name to associate document with
 *               name:
 *                 type: string
 *                 description: Custom name for the document (optional)
 *     responses:
 *       200:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Document'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', uploadWithEncoding, async (req, res) => {
  // Объявляем client до try-блока, чтобы он был доступен в catch
  let client;
  let clientReleased = false;
  try {
    logger.info('POST /documents request received');
    logger.info('Request body:', {
      project: req.body.project,
      hasFile: !!req.file,
      hasContent: !!req.body.content,
      metadata: req.body.metadata,
      fileSize: req.file ? req.file.size : null
    });

    const { project, content, metadata = {}, name, model, external_id, single_chunk } = req.body;
    
    if (!project) {
      logger.error('Missing project parameter');
      return res.status(400).json({
        error: 'Project parameter is required',
        code: 'MISSING_PROJECT'
      });
    }

    // Проверяем модель
    const embeddingModel = model || EMBEDDING_MODEL;

    let documentContent;
    try {
      if (req.file) {
        logger.info(`Processing uploaded file: ${req.file.originalname} (${req.file.mimetype}, size: ${req.file.size} bytes)`);
        
        // Проверяем тип файла
        const supportedTypes = {
          'text/plain': async (buffer) => buffer.toString('utf-8'),
          'application/pdf': async (buffer) => {
            const options = { pagerender: render_page };
            const pdfData = await pdfParseFork(buffer, options);
            return pdfData.text;
          },
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': async (buffer) => {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
          },
          'application/msword': async (buffer) => {
            // Для старых .doc файлов пока нет поддержки
            throw new Error('Old .doc format is not supported. Please convert to .docx');
          }
        };

        const fileHandler = supportedTypes[req.file.mimetype];
        if (!fileHandler) {
          return res.status(400).json({
            error: 'Unsupported file type. Only text, PDF and DOCX files are supported.',
            code: 'UNSUPPORTED_FILE_TYPE'
          });
        }

        try {
          logger.info(`Extracting text from ${req.file.mimetype} file...`);
          const extractedText = await fileHandler(req.file.buffer);
          logger.info('Text extraction completed, sanitizing...');
          documentContent = sanitizeText(extractedText);
          logger.info(`Extracted and sanitized ${documentContent.length} characters`);
        } catch (error) {
          logger.error('Error processing file:', error);
          return res.status(400).json({
            error: `Failed to process ${req.file.mimetype} file: ${error.message}`,
            details: error.stack
          });
        }

        metadata.filename = req.file.originalname;
        metadata.name = name || req.file.originalname;
      } else if (content) {
        try {
          documentContent = sanitizeText(content);
          metadata.name = name || content.split(' ').slice(0, 3).join(' ');
          logger.info(`Processing text content, length: ${documentContent.length}`);
        } catch (error) {
          logger.error('Error processing content:', error);
          return res.status(400).json({
            error: error.message,
            code: 'INVALID_CONTENT'
          });
        }
      } else {
        logger.error('Neither file nor content provided');
        return res.status(400).json({
          error: 'Either file or content must be provided',
          code: 'MISSING_CONTENT'
        });
      }

      const contentHash = crypto
        .createHash('sha256')
        .update(documentContent)
        .digest('hex');

      client = await pool.connect();
      logger.info('Got database connection');
      try {
        await client.query('BEGIN');
        logger.info('Started transaction');

        // Получаем информацию о проекте и его модели эмбеддингов
        logger.info(`Getting project info for "${project}"`);
        const projectInfo = await client.query(`
          SELECT name, embedding_model 
          FROM admin.projects 
          WHERE name = $1
        `, [project]);
        logger.info(`Got project info, found ${projectInfo.rows.length} rows`);

        if (projectInfo.rows.length === 0) {
          throw new Error(`Project "${project}" not found`);
        }

        const projectEmbeddingModel = projectInfo.rows[0].embedding_model;
        logger.info(`Using project embedding model: ${projectEmbeddingModel}`);
        
        // Проверяем существование схемы проекта
        const schemaExists = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = $1
        `, [project]);

        if (schemaExists.rows.length === 0) {
          logger.info(`Creating new schema for project ${project}`);
          const dimension = await getEmbeddingDimension(projectEmbeddingModel);
          await createProjectSchema(project, dimension);
        }

        logger.info('Splitting text into chunks...');
        let chunks;
        if (single_chunk === 'true' || single_chunk === true) {
          logger.info('Using single chunk mode');
          chunks = [documentContent];
        } else {
          chunks = splitIntoChunks(documentContent);
        }
        logger.info(`Document "${metadata.name}" content length: ${documentContent.length}`);
        logger.info(`Split into ${chunks.length} chunks`);

        // Если есть external_id, проверяем существование документа
        if (external_id) {
          logger.info(`Checking for existing document with external_id: ${external_id}`);
          const existingDoc = await client.query(`
            SELECT id, content_hash
            FROM "${project}".documents
            WHERE external_id = $1
          `, [external_id]);

          if (existingDoc.rows.length > 0) {
            const doc = existingDoc.rows[0];
            if (doc.content_hash === contentHash) {
              logger.info(`Document with external_id ${external_id} already exists with same content`);
              await client.query('COMMIT');
              client.release();
              clientReleased = true;
              return res.json({
                ...doc,
                project,
                status: 'exists',
                message: 'Document already exists with same content'
              });
            } else {
              logger.info(`Updating existing document with external_id ${external_id}`);
              
              // Удаляем запрос на удаление из chunks таблицы
              // Вместо этого удаляем старые векторы только из Qdrant
              try {
                await qdrantClient.deleteDocument(project, doc.id);
                logger.info(`Deleted old vectors from Qdrant for document ${doc.id}`);
              } catch (qdrantError) {
                logger.warn(`Failed to delete vectors from Qdrant: ${qdrantError.message}`);
                // Продолжаем выполнение, даже если удаление из Qdrant не удалось
              }

              // Обновляем документ
              const result = await client.query(`
                UPDATE "${project}".documents
                SET name = $1, content_hash = $2, total_chunks = $3, loaded_chunks = 0, metadata = $4
                WHERE id = $5
                RETURNING id, name, content_hash, total_chunks, loaded_chunks, metadata, created_at, external_id
              `, [metadata.name || 'Untitled Document', contentHash, chunks.length, metadata, doc.id]);

              const document = result.rows[0];
              await client.query('COMMIT');
              client.release();
              clientReleased = true;

              res.json({
                ...document,
                project,
                status: 'updated',
                message: 'Document updated with new content',
                loadedChunks: 0,
                totalChunks: chunks.length
              });

              // Запускаем обработку чанков асинхронно
              processChunks(project, document.id, chunks, projectEmbeddingModel);
              return;
            }
          }
        }

        // Создаем новый документ
        const result = await client.query(`
          INSERT INTO "${project}".documents 
            (name, content_hash, total_chunks, loaded_chunks, metadata, external_id)
          VALUES 
            ($1, $2, $3, $4, $5, $6)
          RETURNING id, name, content_hash, total_chunks, loaded_chunks, metadata, created_at, external_id
        `, [metadata.name || 'Untitled Document', contentHash, chunks.length, 0, metadata, external_id]);

        const document = result.rows[0];
        const documentId = document.id;
        logger.info(`Created document with ID ${documentId}`);

        await client.query('COMMIT');
        client.release();
        clientReleased = true;
        logger.info('Database connection released after successful document creation');

        res.json({
          ...document,
          project,
          status: 'created',
          message: 'Document created successfully',
          loadedChunks: 0,
          totalChunks: chunks.length
        });

        // Запускаем обработку чанков асинхронно
        processChunks(project, documentId, chunks, projectEmbeddingModel);

        // Отправляем WebSocket уведомление о новом документе
        broadcastDocumentUpdate({
          ...document,
          project
        });

        // Запускаем процесс обработки документа асинхронно
        processDocument(documentContent, contentHash, project, documentId)
          .then(() => {
            logger.info(`Document ${documentId} fully processed`);
            // Отправляем WebSocket уведомление о завершении обработки
            broadcastDocumentUpdate({
              ...document,
              loaded_chunks: chunks.length,
              project
            });
            
            // Обновляем статистику проекта
            updateProjectStats(project);
          })
          .catch(error => {
            logger.error(`Error processing document ${documentId}:`, error);
          });
      } catch (dbError) {
        logger.error('Database error:', dbError);
        if (!clientReleased) {
          await client.query('ROLLBACK');
          client.release();
          clientReleased = true;
          logger.info('Database connection released after database error');
        }
        throw dbError;
      }
    } catch (processingError) {
      logger.error('Error processing document:', processingError);
      if (client && !clientReleased) {
        await client.query('ROLLBACK');
        client.release();
        clientReleased = true;
        logger.info('Database connection released after processing error');
      }
      return res.status(500).json({
        error: 'Failed to process document',
        details: processingError.message,
        code: 'PROCESSING_ERROR'
      });
    }
  } catch (error) {
    logger.error('Unhandled error in document upload:', error);
    if (client && !clientReleased) {
      client.release();
      clientReleased = true;
      logger.info('Database connection released after unhandled error');
    }
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @swagger
 * /documents/{id}:
 *   get:
 *     tags: [Documents]
 *     summary: Get document by ID
 *     description: Retrieve a specific document by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *       - in: query
 *         name: project
 *         required: true
 *         schema:
 *           type: string
 *         description: Project name
 *     responses:
 *       200:
 *         description: Document details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ 
      error: 'Project parameter is required',
      code: 'MISSING_PROJECT'
    });
  }
  
  try {
    // Получаем базовую информацию о документе из PostgreSQL
    logger.info(`Getting document info from PostgreSQL for document ${id} in project "${project}"`);
    const result = await pool.query(`
      SELECT 
        d.*,
        NULL as content,
        '${project}' as project
      FROM "${project}".documents d
      WHERE d.id = $1
    `, [id]);
    
    // Если документ найден, пытаемся получить содержимое из Qdrant
    if (result.rows.length > 0) {
      try {
        logger.info(`Getting document content from Qdrant for document ${id}`);
        const qdrantContent = await qdrantClient.search(project, null, 1, {
          must: [
            { key: 'document_id', match: { value: parseInt(id) } }
          ]
        });
        
        if (qdrantContent && qdrantContent.length > 0) {
          logger.info(`Found content in Qdrant for document ${id}`);
          result.rows[0].content = qdrantContent[0].content;
        }
      } catch (qdrantError) {
        logger.warn(`Failed to get content from Qdrant: ${qdrantError.message}`);
        // Продолжаем выполнение, даже если Qdrant не вернул результат
      }
    }
    
    if (result.rows.length === 0) {
      logger.info(`Document with ID ${id} not found in project "${project}"`);
      return res.status(404).json({
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }
    
    logger.info(`Document with ID ${id} found in project "${project}"`);
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching document:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

/**
 * @swagger
 * /documents/{id}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete a document
 *     description: Delete a document by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *       - in: query
 *         name: project
 *         required: true
 *         schema:
 *           type: string
 *         description: Project name
 *     responses:
 *       204:
 *         description: Document deleted successfully
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({
      error: 'Project parameter is required',
      code: 'MISSING_PROJECT'
    });
  }
  
  try {
    await DocumentQueries.delete(project, id);
    logger.info(`Document with ID ${id} deleted from project "${project}"`);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting document:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

// Функция для асинхронной обработки чанков
async function processChunks(project, documentId, chunks, embeddingModel) {
  try {
    // Получаем информацию о документе
    const docResult = await pool.query(`
      SELECT name, metadata FROM "${project}".documents WHERE id = $1
    `, [documentId]);
    
    if (docResult.rows.length === 0) {
      logger.error(`Document ${documentId} not found`);
      return;
    }
    
    const documentName = docResult.rows[0].name;
    const documentMetadata = docResult.rows[0].metadata || {};
    
    logger.info(`Document metadata: ${JSON.stringify(documentMetadata)}`);
    
    // Проверяем, что модель эмбеддинга правильная
    if (!embeddingModel) {
      logger.error(`No embedding model specified for project ${project}, trying to get from database`);
      const projectModelInfo = await qdrantClient.getProjectEmbeddingModel(project);
      if (!projectModelInfo) {
        logger.error(`Could not determine embedding model for project ${project}`);
        return;
      }
      embeddingModel = projectModelInfo;
    }
    
    logger.info(`Using embedding model: ${embeddingModel} for project ${project}`);
    
    // Батч точек для оптимизированной загрузки в Qdrant
    const batchSize = 10; // Размер батча
    const points = [];
    
    // Сохраняем чанки с эмбеддингами
    for (let i = 0; i < chunks.length; i++) {
      logger.info(`Processing chunk ${i + 1}/${chunks.length}`);
      const chunk = chunks[i];
      
      try {
        // Получаем эмбеддинг для чанка
        logger.info(`Getting embedding for chunk ${i + 1} using model ${embeddingModel}`);
        const embedding = await getEmbedding(chunk, embeddingModel);
        
        // Готовим точку для Qdrant
        const point = {
          id: `${documentId}_${i}`, // Уникальный ID для точки
          vector: embedding,
          payload: {
            document_id: documentId,
            chunk_index: i,
            content: chunk,
            filename: documentName,
            project: project,
            created_at: new Date().toISOString(),
            metadata: documentMetadata // Добавляем метаданные документа
          }
        };
        
        // Добавляем точку в батч
        points.push(point);
        
        // Если батч достиг нужного размера или это последний чанк, отправляем в Qdrant
        if (points.length >= batchSize || i === chunks.length - 1) {
          // Сохраняем батч в Qdrant
          await qdrantClient.upsertPoints(project, points);
          logger.info(`Saved batch of ${points.length} points to Qdrant`);
          
          // Обновляем количество загруженных чанков в PostgreSQL
          await pool.query(`
            UPDATE "${project}".documents
            SET loaded_chunks = loaded_chunks + ${points.length}
            WHERE id = $1
          `, [documentId]);
          
          // Очищаем батч
          points.length = 0;
          
          // Получаем обновленную информацию о документе
          const docInfo = await pool.query(`
            SELECT id, name, content_hash, total_chunks, loaded_chunks, metadata, created_at, external_id
            FROM "${project}".documents
            WHERE id = $1
          `, [documentId]);
          
          if (docInfo.rows.length > 0) {
            // Отправляем WebSocket уведомление о прогрессе
            broadcastDocumentUpdate({
              ...docInfo.rows[0],
              project
            });
          }
        }
      } catch (chunkError) {
        logger.error(`Error processing chunk ${i + 1}:`, chunkError);
        // Продолжаем обработку следующих чанков
      }
    }

    logger.info(`Successfully processed all chunks for document ${documentId}`);
  } catch (processingError) {
    logger.error('Error in async processing:', processingError);
  }
}

// Функция для обработки документа
async function processDocument(text, contentHash, project, documentId) {
  try {
    logger.info(`Starting document processing for ${documentId} in project ${project}`);
    
    // Получаем информацию о документе
    const docResult = await pool.query(`
      SELECT * FROM "${project}".documents WHERE id = $1
    `, [documentId]);
    
    if (docResult.rows.length === 0) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    // Документ уже обрабатывается через processChunks, 
    // эта функция в текущей реализации просто ожидает завершения
    // и может использоваться для дополнительной обработки в будущем
    
    return true;
  } catch (error) {
    logger.error(`Error in document processing for ${documentId}:`, error);
    throw error;
  }
}

// Функция для обновления статистики проекта
async function updateProjectStats(projectName) {
  try {
    // Получаем количество документов в проекте
    const result = await pool.query(`
      SELECT COUNT(*) as document_count
      FROM "${projectName}".documents
    `);
    
    const stats = {
      document_count: parseInt(result.rows[0].document_count)
    };
    
    // Получаем ID проекта
    const projectResult = await pool.query(`
      SELECT id FROM admin.projects WHERE name = $1
    `, [projectName]);
    
    if (projectResult.rows.length > 0) {
      const projectId = projectResult.rows[0].id;
      // Отправляем обновление статистики проекта через WebSocket
      broadcastProjectStatsUpdate(projectId, stats);
    }
  } catch (error) {
    logger.error(`Error updating project stats for ${projectName}:`, error);
  }
}

export default router;