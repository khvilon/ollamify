const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = express();

// Increase payload size limits and timeouts
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb'
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  if (req.method !== 'GET') {
    console.log('Body:', req.body);
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Middleware error:', err);
  
  if (err.code === 'ECONNABORTED') {
    console.log('Request aborted, sending 200 OK');
    return res.status(200).json({ message: 'OK' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: err.message
  });
});

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

// Helper function to hash API keys
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required',
      code: 'MISSING_CREDENTIALS'
    });
  }

  try {
    console.log('Login attempt for:', email);
    const result = await pool.query(
      'SELECT * FROM admin.users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    
    if (!match) {
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        username: user.username,
        isAdmin: user.is_admin
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// Verify session token
app.post('/auth/verify', async (req, res) => {
  console.log('=== Auth Verify Request ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Original URI:', req.headers['x-original-uri']);
  console.log('Authorization:', req.headers.authorization);
  
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('No authorization header found');
    return res.status(401).json({ 
      error: 'Unauthorized', 
      code: 'AUTH_REQUIRED' 
    });
  }

  // Extract token from Bearer
  const [scheme, token] = authHeader.split(' ');
  console.log('Auth scheme:', scheme);
  console.log('Token:', token ? token.substring(0, 10) + '...' : 'none');
  
  if (scheme !== 'Bearer' || !token) {
    console.log('Invalid auth header format');
    return res.status(401).json({ 
      error: 'Invalid authorization header', 
      code: 'INVALID_AUTH_HEADER' 
    });
  }

  try {
    let userInfo = null;
    const originalUri = req.headers['x-original-uri'] || '';
    console.log('Original URI:', originalUri);
    console.log('Checking /api/ai:', originalUri.includes('/api/ai'));
    console.log('Checking /api/v1/chat/completions:', originalUri.includes('/api/v1/chat/completions'));
    console.log('Checking /api/documents:', originalUri.includes('/api/documents'));
    console.log('Checking /api/tts:', originalUri.includes('/api/tts'));
    console.log('Checking /api/stt:', originalUri.includes('/api/stt'));
    
    const isExternalEndpoint = originalUri.includes('/api/ai') || 
                               originalUri.includes('/api/v1/chat/completions') || 
                               originalUri.includes('/api/documents') ||
                               originalUri.includes('/api/tts') ||
                               originalUri.includes('/api/stt');
    console.log('Is external endpoint:', isExternalEndpoint);

    // First try to verify as JWT
    try {
      console.log('Attempting JWT verification...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userInfo = decoded;
      console.log('JWT verification successful:', decoded);
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError.message);
      
      // If JWT verification fails, try as API key
      if (isExternalEndpoint) {
        console.log('Attempting API key verification...');
        console.log('Looking for API key:', token);
        
        // Compare token directly with stored API keys (no hashing)
        const result = await pool.query(
          `SELECT u.* 
           FROM admin.users u
           JOIN admin.api_keys k ON k.user_id = u.id
           WHERE k.key_value = $1`,
          [token]
        );
        console.log('Query result rows:', result.rows.length);

        if (result.rows.length === 0) {
          console.log('API key not found in database');
          return res.status(401).json({ 
            error: 'Invalid token or API key', 
            code: 'INVALID_CREDENTIALS' 
          });
        }

        const user = result.rows[0];
        console.log('Found user:', { id: user.id, email: user.email });
        userInfo = {
          userId: user.id,
          email: user.email,
          username: user.username,
          isAdmin: user.is_admin
        };
        console.log('API key verification successful for user:', userInfo);
      } else {
        console.log('Not an AI endpoint, JWT required');
        throw jwtError;
      }
    }

    // Check permissions
    console.log('Checking permissions:', { isExternalEndpoint, isAdmin: userInfo.isAdmin });

    // Set response headers with user info
    const userJson = JSON.stringify({
      id: userInfo.userId,
      email: userInfo.email,
      username: userInfo.username,
      role: userInfo.isAdmin ? 'admin' : 'user'
    });

    res.setHeader('X-User', userJson);
    console.log('Setting response headers:', {
      'X-User': userJson
    });

    console.log('Authentication successful');
    res.status(200).json({ authenticated: true });
  } catch (error) {
    console.error('Authentication failed with error:', error);
    res.status(401).json({ 
      error: 'Invalid token or API key', 
      code: 'INVALID_CREDENTIALS' 
    });
  }
});

// Generate API key (admin only)
app.post('/auth/api-keys', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check admin role
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, name } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Generate API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    const keyHash = hashApiKey(apiKey);

    // Add new API key to user's api_keys array
    await pool.query(
      `UPDATE admin.users 
       SET api_keys = api_keys || $1::jsonb 
       WHERE id = $2`,
      [JSON.stringify([{ name, hash: keyHash, created_at: new Date().toISOString() }]), userId]
    );

    res.json({ apiKey });
  } catch (error) {
    console.error('API key generation error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

const port = process.env.AUTH_PORT || 3003;
app.listen(port, () => {
  console.log(`Auth service running on port ${port}`);
  console.log('Environment:', {
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_DB: process.env.POSTGRES_DB,
    POSTGRES_PORT: process.env.POSTGRES_PORT,
    JWT_SECRET: process.env.JWT_SECRET ? '[SET]' : '[NOT SET]'
  });
});
