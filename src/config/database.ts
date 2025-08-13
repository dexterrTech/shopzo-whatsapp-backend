import { Pool } from 'pg';
import { runMigrations } from './migrations';
import { seedDatabase } from './seed';

const connectionString = 'postgresql+psycopg2://postgres:newpassword@localhost:5432/whatsapp_dashboard';

// Remove the +psycopg2 part as it's not needed for Node.js
const cleanConnectionString = connectionString.replace('postgresql+psycopg2://', 'postgresql://');

export const pool = new Pool({
  connectionString: cleanConnectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test the connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
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
