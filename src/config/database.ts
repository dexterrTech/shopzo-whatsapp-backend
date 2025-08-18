import { Pool } from 'pg';
import { env } from './env';
import { runMigrations } from './migrations';
import { seedDatabase } from './seed';

// Build connection string from environment variables
const buildConnectionString = () => {
  return env.DB_CONNECTION_STRING;
};

const connectionString = buildConnectionString();

export const pool = new Pool({
  connectionString: connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test the connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
  // Extract database info from connection string for logging
  const dbUrl = new URL(connectionString);
  console.log(`Database: ${dbUrl.pathname.slice(1)} on ${dbUrl.hostname}:${dbUrl.port || 5432}`);
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Do not exit; keep service running so fallback data and non-DB routes keep working
});

export async function initDatabase() {
  try {
    await runMigrations();
    await seedDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}
