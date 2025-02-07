const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '34.93.195.0',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASS || 'Plotpointe!@3456',
  port: process.env.DB_PORT || 5432,
});

module.exports = pool;

