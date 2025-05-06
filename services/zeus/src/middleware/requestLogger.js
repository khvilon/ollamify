import pool from '../db/conf.js';
import logger from '../utils/logger.js';

export const requestLogger = async (req, res, next) => {
    // Skip logging if the request has JWT authentication
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ey')) {
        return next();
    }

    const startTime = Date.now();
    let client;

    try {
        client = await pool.connect();

        // Store original response methods
        const originalJson = res.json;
        const originalSend = res.send;
        let responseBody = null;

        // Intercept response.json()
        res.json = function(body) {
            responseBody = body;
            return originalJson.call(this, body);
        };

        // Intercept response.send()
        res.send = function(body) {
            responseBody = body;
            return originalSend.call(this, body);
        };

        // Once the response is finished
        res.on('finish', async () => {
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            try {
                // Extract user information from headers
                const userHeader = req.headers['x-user'];
                let userName = null;
                let userKey = null;
                
                if (userHeader) {
                    try {
                        const userData = JSON.parse(userHeader);
                        userName = userData.username;
                        
                        if (userName) {
                            // Get user's API key from database
                            const apiKeyResult = await client.query(
                                `SELECT ak.name as user_key
                                 FROM admin.api_keys ak
                                 JOIN admin.users u ON u.id = ak.user_id
                                 WHERE u.username = $1
                                 ORDER BY ak.created_at DESC
                                 LIMIT 1`,
                                [userName]
                            );
                            
                            if (apiKeyResult.rows.length > 0) {
                                userKey = apiKeyResult.rows[0].user_key;
                            }
                        }
                    } catch (error) {
                        logger.error('Failed to process user information:', error);
                    }
                }

                var ip
                try {
                    ip = req.ip || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]
                } catch {
                    ip = ""
                }

                const logEntry = {
                    user_name: userName,
                    user_key: userKey,
                    request_method: req.method,
                    request_path: req.path,
                    request_body: JSON.stringify(req.body),
                    ip_address: JSON.stringify(ip),
                    response_body: JSON.stringify(responseBody),
                    response_time: responseTime
                };

                await client.query(
                    `INSERT INTO admin.user_logs 
                    (user_name, user_key, request_method, request_path, request_body, ip_address, 
                     response_body, response_time)
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)`,
                    [
                        logEntry.user_name,
                        logEntry.user_key,
                        logEntry.request_method,
                        logEntry.request_path,
                        logEntry.request_body,
                        logEntry.ip_address,
                        logEntry.response_body,
                        logEntry.response_time
                    ]
                );

                logger.info(`Logged request-response cycle for ${req.path} (${responseTime}ms)`);
            } catch (error) {
                logger.error('Error logging response:', error);
            } finally {
                client.release();
            }
        });

        next();
    } catch (error) {
        logger.error('Error setting up response logging:', error);
        if (client) client.release();
        next();
    }
};
