import { pool } from './database';

export async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    // Create contacts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
        phone VARCHAR(20),
        telegram_id VARCHAR(100),
        viber_id VARCHAR(100),
        line_id VARCHAR(100),
        instagram_id VARCHAR(100),
        facebook_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_number ON contacts(whatsapp_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
    `);
    
    // Create users_whatsapp table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users_whatsapp (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'aggregator', 'super_admin')),
        is_approved BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP,
        approved_by INTEGER REFERENCES users_whatsapp(id),
        approved_at TIMESTAMP
      );
    `);
    
    // Create indexes for users table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users_whatsapp(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users_whatsapp(role);
      CREATE INDEX IF NOT EXISTS idx_users_is_approved ON users_whatsapp(is_approved);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users_whatsapp(created_at);
    `);
    
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
