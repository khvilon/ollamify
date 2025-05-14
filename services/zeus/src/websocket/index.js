import WebSocket, { WebSocketServer } from 'ws';
import logger from '../utils/logger.js';

// Храним соединения по типам сообщений
const connections = {
  models: new Set(),
  documents: new Set(),
  projects: new Set()
};

let wss = null;

export function initWebSocketServer(server) {
  wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws, request) => {
    logger.info(`WebSocket connection established: ${request.url}`);
    
    // Определяем тип соединения по URL
    const url = new URL(request.url, 'http://localhost');
    const type = url.pathname.replace(/^\/ws\//, '');
    
    if (connections[type]) {
      connections[type].add(ws);
      logger.info(`Added to ${type} connections, total: ${connections[type].size}`);
      
      // Отправляем приветственное сообщение
      ws.send(JSON.stringify({
        type: 'connected', 
        message: `Connected to ${type} updates`
      }));
      
      // Выводим информацию о всех активных соединениях
      logger.info('Active WebSocket connections:');
      Object.keys(connections).forEach(connType => {
        logger.info(`- ${connType}: ${connections[connType].size} clients`);
      });
    } else {
      logger.warn(`Unknown WebSocket connection type: ${type}`);
    }
    
    ws.on('close', () => {
      logger.info(`WebSocket connection closed: ${request.url}`);
      // Удаляем соединение из всех наборов
      Object.keys(connections).forEach(key => {
        connections[key].delete(ws);
      });
      
      // Выводим информацию о соединениях после удаления
      logger.info('Active WebSocket connections after disconnect:');
      Object.keys(connections).forEach(connType => {
        logger.info(`- ${connType}: ${connections[connType].size} clients`);
      });
    });
    
    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    });
    
    // Обработка сообщений от клиента для проверки соединения
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (e) {
        logger.warn(`Invalid WebSocket message: ${message}`);
      }
    });
    
    // Отправляем ping каждые 30 секунд для поддержания соединения
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });
  
  logger.info('WebSocket server initialized');
  return wss;
}

// Функция для отправки сообщения через WebSocket
function sendWebSocketMessage(channel, data) {
  if (!connections[channel] || connections[channel].size === 0) {
    logger.info(`No clients connected to channel ${channel}, skipping broadcast`);
    return 0;
  }
  
  let sentCount = 0;
  connections[channel].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
        sentCount++;
      } catch (error) {
        logger.error(`Error sending message to client: ${error.message}`);
      }
    } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
      // Удаляем закрытые соединения
      connections[channel].delete(client);
    }
  });
  
  logger.info(`Sent update to ${sentCount} clients on channel ${channel}`);
  return sentCount;
}

export function broadcastModelUpdate(model) {
  if (!model) {
    logger.warn('Attempted to broadcast undefined model update');
    return;
  }
  
  // Обеспечиваем совместимость с обоими форматами обновлений
  const updateData = {
    type: 'model_update',
    model: {
      name: model.name,
      downloadStatus: model.downloadStatus ? model.downloadStatus : {
        status: model.status || 'downloading',
        progress: model.progress || 0,
        message: model.message || `Progress: ${model.progress || 0}%`
      }
    },
    timestamp: Date.now()
  };
  
  const data = JSON.stringify(updateData);
  
  logger.info(`Broadcasting to channel: models`);
  logger.info(`Model update data: ${JSON.stringify({
    name: model.name,
    status: updateData.model.downloadStatus.status,
    progress: updateData.model.downloadStatus.progress
  })}`);
  
  return sendWebSocketMessage('models', data);
}

export function broadcastDocumentUpdate(document) {
  if (!document) {
    logger.warn('Attempted to broadcast undefined document update');
    return;
  }
  
  const data = JSON.stringify({
    type: 'document_update',
    document,
    timestamp: Date.now()
  });
  
  logger.info(`Broadcasting to channel: documents`);
  
  return sendWebSocketMessage('documents', data);
}

export function broadcastProjectUpdate(project) {
  if (!project) {
    logger.warn('Attempted to broadcast undefined project update');
    return;
  }
  
  const data = JSON.stringify({
    type: 'project_update',
    project,
    timestamp: Date.now()
  });
  
  logger.info(`Broadcasting to channel: projects`);
  
  return sendWebSocketMessage('projects', data);
}

export function broadcastProjectStatsUpdate(projectId, stats) {
  if (!projectId || !stats) {
    logger.warn('Attempted to broadcast undefined project stats update');
    return;
  }
  
  const data = JSON.stringify({
    type: 'project_stats_update',
    projectId,
    stats,
    timestamp: Date.now()
  });
  
  logger.info(`Broadcasting project stats update to channel: projects`);
  
  return sendWebSocketMessage('projects', data);
} 