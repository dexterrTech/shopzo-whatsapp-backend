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
  connectionTimeoutMillis: 60000, // Increased from 10s to 60s for Cloud Run
  statement_timeout: 300000, // 5 minutes for long-running migrations
  query_timeout: 300000, // 5 minutes for queries
  ssl: env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

// Test the connection
pool.on('connect', (client) => {
  console.log('✅ Connected to PostgreSQL database');
  // Extract database info from connection string for logging
  const dbUrl = new URL(connectionString);
  console.log(`📊 Database: ${dbUrl.pathname.slice(1)} on ${dbUrl.hostname}:${dbUrl.port || 5432}`);
  console.log(`🔗 Connection pool size: ${pool.totalCount} total, ${pool.idleCount} idle, ${pool.waitingCount} waiting`);
});

pool.on('error', (err: any, client) => {
  console.error('❌ Unexpected error on idle client:', {
    message: err.message,
    code: err.code,
    detail: err.detail,
    hint: err.hint,
    position: err.position,
    internalPosition: err.internalPosition,
    internalQuery: err.internalQuery,
    where: err.where,
    schema: err.schema,
    table: err.table,
    column: err.column,
    dataType: err.dataType,
    constraint: err.constraint,
    file: err.file,
    line: err.line,
    routine: err.routine
  });
  // Do not exit; keep service running so fallback data and non-DB routes keep working
});

pool.on('acquire', (client) => {
  // console.log(`🔗 Client acquired from pool. Pool stats: ${pool.totalCount} total, ${pool.idleCount} idle, ${pool.waitingCount} waiting`);
});

pool.on('remove', (client) => {
  //console.log(`🗑️ Client removed from pool. Pool stats: ${pool.totalCount} total, ${pool.idleCount} idle, ${pool.waitingCount} waiting`);
});

// Retry function for database operations
async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3,
  delayMs: number = 2000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 ${operationName} - Attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ ${operationName} failed on attempt ${attempt}:`, error);
      
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying ${operationName} in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 1.5; // Exponential backoff
      }
    }
  }
  
  throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError!.message}`);
}

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

export async function initDatabase() {
  try {
    console.log('🔌 Starting database initialization...');
    
    // Test connection first with retry
    await retryDatabaseOperation(
      async () => {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('✅ Database connection test successful');
      },
      'Database connection test',
      3,
      2000
    );
    
    // Run migrations with retry
    await retryDatabaseOperation(
      () => runMigrations(),
      'Database migrations',
      3,
      3000
    );
    
    // Skip seeding for now
    console.log('⏭️ Skipping database seeding');
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
}
