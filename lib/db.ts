import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const sslModeFromUrl = connectionString?.match(/sslmode=([^&]+)/i)?.[1]?.toLowerCase();
const sslRequestedByUrl = ['require', 'verify-ca', 'verify-full'].includes(sslModeFromUrl || '');
const sslRequestedByEnv = process.env.PGSSLMODE?.toLowerCase() === 'require';

const pool = new Pool({
  connectionString,
  ...(sslRequestedByUrl || sslRequestedByEnv
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
  max: 10,
  idleTimeoutMillis: 30000,
});

export default pool;
