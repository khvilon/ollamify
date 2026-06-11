import { randomUUID } from 'node:crypto';
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { createOllamifyMcpServer } from '../mcp/server.js';
import logger from '../utils/logger.js';

const router = express.Router();
const transports = {};
const servers = {};

function jsonRpcError(res, status, message) {
  res.status(status).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message
    },
    id: null
  });
}

async function closeSession(sessionId) {
  const transport = transports[sessionId];
  const server = servers[sessionId];

  delete transports[sessionId];
  delete servers[sessionId];

  try {
    if (transport) {
      await transport.close();
    }
  } catch (error) {
    logger.warn(`Error closing MCP transport ${sessionId}:`, error);
  }

  try {
    if (server) {
      await server.close();
    }
  } catch (error) {
    logger.warn(`Error closing MCP server ${sessionId}:`, error);
  }
}

router.all('/', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      const existingTransport = transports[sessionId];
      if (!(existingTransport instanceof StreamableHTTPServerTransport)) {
        jsonRpcError(res, 400, 'Bad Request: session exists but uses another MCP transport');
        return;
      }
      transport = existingTransport;
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      let mcpServer;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: initializedSessionId => {
          transports[initializedSessionId] = transport;
          servers[initializedSessionId] = mcpServer;
        }
      });

      mcpServer = createOllamifyMcpServer();

      transport.onclose = () => {
        const initializedSessionId = transport.sessionId;
        if (initializedSessionId) {
          delete transports[initializedSessionId];
          delete servers[initializedSessionId];
        }
      };

      await mcpServer.connect(transport);
    } else if (req.method === 'DELETE' && sessionId) {
      await closeSession(sessionId);
      res.status(204).end();
      return;
    } else {
      jsonRpcError(res, 400, 'Bad Request: no valid MCP session id or initialize request');
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP Streamable HTTP request:', error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, 'Internal MCP server error');
    }
  }
});

router.get('/sse', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/api/mcp/messages', res);
    const mcpServer = createOllamifyMcpServer();

    transports[transport.sessionId] = transport;
    servers[transport.sessionId] = mcpServer;

    res.on('close', () => {
      delete transports[transport.sessionId];
      delete servers[transport.sessionId];
    });

    await mcpServer.connect(transport);
  } catch (error) {
    logger.error('Error opening MCP SSE transport:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal MCP server error');
    }
  }
});

router.post('/messages', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];

    if (!(transport instanceof SSEServerTransport)) {
      res.status(400).send('No SSE transport found for sessionId');
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP SSE message:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal MCP server error');
    }
  }
});

export async function closeMcpTransports() {
  await Promise.all(Object.keys(transports).map(closeSession));
}

export default router;
