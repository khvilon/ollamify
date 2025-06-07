-- Create admin schema
CREATE SCHEMA IF NOT EXISTS admin;

-- Create users table
CREATE TABLE IF NOT EXISTS admin.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    api_keys JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create default admin user with password 'admin'
INSERT INTO admin.users (username, email, password_hash, is_admin)
SELECT 'admin', 'admin@example.com', '$2b$10$c0zWIHFrB1MpYcdBkTPkYOY1F3jPUddZ2LzApfaXT4.BcXVqX/L6G', true
WHERE NOT EXISTS (
    SELECT 1 FROM admin.users WHERE is_admin = true
);

-- Create projects table
CREATE TABLE IF NOT EXISTS admin.projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_by INTEGER REFERENCES admin.users(id),
    embedding_model VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index on project name
CREATE UNIQUE INDEX IF NOT EXISTS projects_name_idx ON admin.projects(name);

-- Create api_keys table
CREATE TABLE IF NOT EXISTS admin.api_keys (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    key_value TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES admin.users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON admin.api_keys(user_id);

-- Grant privileges to khvilon
ALTER USER khvilon WITH SUPERUSER;

-- Create vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create user_logs table
CREATE TABLE IF NOT EXISTS admin.user_logs (
    id SERIAL PRIMARY KEY,
    user_name TEXT,
    user_key TEXT,
    api_key_name TEXT,
    request_method TEXT NOT NULL,
    request_path TEXT NOT NULL,
    request_body JSONB,
    ip_address TEXT,
    response_body JSONB,
    response_time INTEGER,
    model_name TEXT,
    request_summary TEXT,
    endpoint_category TEXT,
    user_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on created_at for efficient querying
CREATE INDEX IF NOT EXISTS user_logs_created_at_idx ON admin.user_logs(created_at);

-- Add api_key_name column if it doesn't exist (migration)
ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS api_key_name TEXT;

-- Add missing columns if they don't exist (migrations)
ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS request_summary TEXT;
ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS endpoint_category TEXT;
ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS user_text TEXT;
