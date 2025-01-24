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

// Получение списка всех документов
router.get('/', async (req, res) => {
  const { project } = req.query;
  
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
        return res.json([]);
      }
      
      // Получаем документы конкретного проекта
      const result = await pool.query(`
        SELECT 
          id,
          name,
          content_hash,
          total_chunks,
          loaded_chunks,
          metadata,
          created_at,
          '${project}' as project
        FROM "${project}".documents
        ORDER BY created_at DESC
      `);
      logger.info(`Found ${result.rows.length} documents in project "${project}"`);
      res.json(result.rows);
    } else {
      // Получаем все документы из всех проектов
      logger.info('Fetching documents from all projects');
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
      `);
      
      logger.info(`Found ${schemas.rows.length} project schemas`);
      const allDocuments = [];
      
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
          
          const docs = await pool.query(`
            SELECT 
              id,
              name,
              content_hash,
              total_chunks,
              loaded_chunks,
              metadata,
              created_at,
              '${projectName}' as project
            FROM "${projectName}".documents
            ORDER BY created_at DESC
          `);
          logger.info(`Found ${docs.rows.length} documents in project "${projectName}"`);
          allDocuments.push(...docs.rows);
        } catch (err) {
          logger.error(`Error fetching documents from project "${projectName}":`, err);
          // Продолжаем с следующим проектом
          continue;
        }
      }
      
      logger.info(`Returning ${allDocuments.length} documents in total`);
      res.json(allDocuments);
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

// Загрузка документа (файл или текст)
router.post('/', uploadWithEncoding, async (req, res) => {
  try {
    logger.info('POST /documents request received');
    logger.info('Request body:', {
      project: req.body.project,
      hasFile: !!req.file,
      hasContent: !!req.body.content,
      metadata: req.body.metadata,
      fileSize: req.file ? req.file.size : null
    });

    const { project, content, metadata = {}, name, model } = req.body;
    
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

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Получаем информацию о проекте и его модели эмбеддингов
        const projectInfo = await client.query(`
          SELECT name, embedding_model 
          FROM admin.projects 
          WHERE name = $1
        `, [project]);

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
        const chunks = splitIntoChunks(documentContent);
        const totalChunks = chunks.length;
        
        logger.info(`Document "${metadata.name}" content length: ${documentContent.length}`);
        logger.info(`Split into ${totalChunks} chunks`);

        // Создаем документ
        const result = await client.query(`
          INSERT INTO "${project}".documents 
            (name, content_hash, total_chunks, loaded_chunks, metadata)
          VALUES 
            ($1, $2, $3, $4, $5)
          RETURNING id, name, content_hash, total_chunks, loaded_chunks, metadata, created_at
        `, [metadata.name || 'Untitled Document', contentHash, totalChunks, 0, metadata]);

        const document = result.rows[0];
        const documentId = document.id;
        logger.info(`Created document with ID ${documentId}`);

        // Коммитим транзакцию создания документа
        await client.query('COMMIT');

        // Отправляем ответ сразу после создания документа
        res.json({
          ...document,
          project,
          loadedChunks: 0,
          totalChunks
        });

        // Запускаем обработку чанков асинхронно
        (async () => {
          const chunkClient = await pool.connect();
          try {
            // Сохраняем чанки с эмбеддингами
            for (let i = 0; i < chunks.length; i++) {
              logger.info(`Processing chunk ${i + 1}/${chunks.length}`);
              const chunk = chunks[i];
              
              try {
                await chunkClient.query('BEGIN');

                // Получаем эмбеддинг для чанка, используя модель из проекта
                const embedding = await getEmbedding(chunk, projectEmbeddingModel);
                logger.info(`Got embedding with dimension ${embedding.length}`);

                // Сохраняем чанк
                await chunkClient.query(`
                  INSERT INTO "${project}".chunks
                    (document_id, chunk_index, content, embedding)
                  VALUES
                    ($1, $2, $3, $4)
                `, [documentId, i, chunk, `[${embedding.join(',')}]`]);

                // Обновляем количество загруженных чанков
                await chunkClient.query(`
                  UPDATE "${project}".documents
                  SET loaded_chunks = loaded_chunks + 1
                  WHERE id = $1
                `, [documentId]);

                await chunkClient.query('COMMIT');
              } catch (chunkError) {
                logger.error(`Error processing chunk ${i + 1}:`, chunkError);
                await chunkClient.query('ROLLBACK');
                // Продолжаем обработку следующих чанков
              }
            }

            logger.info(`Successfully processed all chunks for document ${documentId}`);
          } catch (processingError) {
            logger.error('Error in async processing:', processingError);
          } finally {
            chunkClient.release();
          }
        })();
      } catch (dbError) {
        logger.error('Database error:', dbError);
        await client.query('ROLLBACK');
        client.release();
        throw dbError;
      }
    } catch (processingError) {
      logger.error('Error processing document:', processingError);
      return res.status(500).json({
        error: 'Failed to process document',
        details: processingError.message,
        stack: processingError.stack
      });
    }
  } catch (error) {
    logger.error('Unhandled error in document upload:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      stack: error.stack
    });
  }
});

// Получение конкретного документа
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
    const result = await pool.query(`
      SELECT 
        d.*,
        c.content,
        '${project}' as project
      FROM "${project}".documents d
      LEFT JOIN "${project}".chunks c ON c.document_id = d.id
      WHERE d.id = $1
    `, [id]);
    
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

// Удаление документа
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

export default router;