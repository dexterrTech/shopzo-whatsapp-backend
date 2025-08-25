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

    // Create users table (already in use by auth) if not exists
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
        approved_by INTEGER,
        approved_at TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users_whatsapp(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users_whatsapp(role);
      CREATE INDEX IF NOT EXISTS idx_users_is_approved ON users_whatsapp(is_approved);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users_whatsapp(created_at);
    `);

    // Price plans for configurable conversation pricing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS price_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL DEFAULT 'Default',
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        utility_paise INTEGER NOT NULL DEFAULT 0,
        marketing_paise INTEGER NOT NULL DEFAULT 0,
        authentication_paise INTEGER NOT NULL DEFAULT 0,
        service_paise INTEGER NOT NULL DEFAULT 0,
        is_default BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INTEGER REFERENCES users_whatsapp(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_price_plans_default ON price_plans(is_default);
    `);

    // Create billing_logs table for tracking conversation costs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_logs (
        id SERIAL PRIMARY KEY,
        conversation_id VARCHAR(255) NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL CHECK (category IN ('utility', 'marketing', 'service', 'authentication')),
        recipient_number VARCHAR(20) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        billing_status VARCHAR(20) DEFAULT 'pending' CHECK (billing_status IN ('pending', 'paid', 'failed')),
        amount_paise INTEGER NOT NULL,
        amount_currency VARCHAR(10) DEFAULT 'INR',
        country_code VARCHAR(10),
        country_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_billing_logs_user_id ON billing_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_billing_logs_category ON billing_logs(category);
      CREATE INDEX IF NOT EXISTS idx_billing_logs_start_time ON billing_logs(start_time);
      CREATE INDEX IF NOT EXISTS idx_billing_logs_conversation_id ON billing_logs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_billing_logs_billing_status ON billing_logs(billing_status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_logs_conversation_per_user ON billing_logs(user_id, conversation_id);
    `);

    // Safe column adds for billing logs
    await pool.query(`
      ALTER TABLE billing_logs
      ADD COLUMN IF NOT EXISTS price_plan_id INTEGER REFERENCES price_plans(id);
    `);
    await pool.query(`
      ALTER TABLE billing_logs
      ADD COLUMN IF NOT EXISTS wallet_tx_id INTEGER REFERENCES wallet_transactions(id);
    `);
    
    // Wallet accounts and transactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        balance_paise INTEGER NOT NULL DEFAULT 0,
        suspense_balance_paise INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_id ON wallet_accounts(user_id);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        transaction_id VARCHAR(64) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('RECHARGE','DEBIT','REFUND','ADJUSTMENT','SUSPENSE_DEBIT','SUSPENSE_REFUND')),
        status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','failed')),
        amount_paise INTEGER NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        details VARCHAR(255),
        from_label VARCHAR(100),
        to_label VARCHAR(100),
        balance_after_paise INTEGER,
        suspense_balance_after_paise INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON wallet_transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON wallet_transactions(status);
    `);

    // User-specific price plan assignments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_price_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        price_plan_id INTEGER NOT NULL REFERENCES price_plans(id) ON DELETE RESTRICT,
        effective_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_price_plans_user_id ON user_price_plans(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_price_plans_effective ON user_price_plans(effective_from DESC);
    `);

    // WABA/phone to user mapping for webhook resolution
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waba_sources (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        phone_number_id TEXT,
        waba_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_sources_user_id ON waba_sources(user_id);
      CREATE INDEX IF NOT EXISTS idx_waba_sources_phone ON waba_sources(phone_number_id);
      CREATE INDEX IF NOT EXISTS idx_waba_sources_waba ON waba_sources(waba_id);
    `);

    // Aggregator/tenant mapping - updated structure
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_relationships (
        id SERIAL PRIMARY KEY,
        parent_user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        child_user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        relationship_type VARCHAR(20) NOT NULL DEFAULT 'business' CHECK (relationship_type IN ('business', 'aggregator')),
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_user_id, child_user_id)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_relationships_parent ON user_relationships(parent_user_id);
      CREATE INDEX IF NOT EXISTS idx_user_relationships_child ON user_relationships(child_user_id);
      CREATE INDEX IF NOT EXISTS idx_user_relationships_type ON user_relationships(relationship_type);
    `);

    // Country/category overrides per plan
    await pool.query(`
      CREATE TABLE IF NOT EXISTS price_plan_overrides (
        id SERIAL PRIMARY KEY,
        price_plan_id INTEGER NOT NULL REFERENCES price_plans(id) ON DELETE CASCADE,
        country_code VARCHAR(10) NOT NULL,
        category VARCHAR(50) NOT NULL CHECK (category IN ('utility','marketing','authentication','service')),
        amount_paise INTEGER NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        UNIQUE(price_plan_id, country_code, category)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_overrides_plan ON price_plan_overrides(price_plan_id);
      CREATE INDEX IF NOT EXISTS idx_plan_overrides_country ON price_plan_overrides(country_code);
    `);

    // Super Admin wallet configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_wallet (
        id SERIAL PRIMARY KEY,
        wallet_type VARCHAR(20) NOT NULL DEFAULT 'main' CHECK (wallet_type IN ('main', 'reserve')),
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        balance_paise INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wallet_type)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_system_wallet_type ON system_wallet(wallet_type);
    `);

    // Add unique constraints if they don't exist
    try {
      await pool.query(`
        ALTER TABLE price_plans 
        ADD CONSTRAINT uq_price_plans_name UNIQUE (name);
      `);
    } catch (error: any) {
      if (error.code !== '42710') { // 42710 = duplicate_object
        console.warn('Could not add unique constraint to price_plans.name:', error.message);
      }
    }

    // Safe column add: created_by for aggregator-owned plans
    await pool.query(`
      ALTER TABLE price_plans
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users_whatsapp(id);
    `);

    try {
      await pool.query(`
        ALTER TABLE system_wallet 
        ADD CONSTRAINT uq_system_wallet_type UNIQUE (wallet_type);
      `);
    } catch (error: any) {
      if (error.code !== '42710') { // 42710 = duplicate_object
        console.warn('Could not add unique constraint to system_wallet.wallet_type:', error.message);
      }
    }

    // Insert default system wallet if not exists
    await pool.query(`
      INSERT INTO system_wallet (wallet_type, balance_paise) 
      VALUES ('main', 10000000) 
      ON CONFLICT (wallet_type) DO NOTHING;
    `);

    // Insert default price plan if not exists
    await pool.query(`
      INSERT INTO price_plans (name, utility_paise, marketing_paise, authentication_paise, service_paise, is_default) 
      VALUES ('Default', 100, 150, 80, 120, true) 
      ON CONFLICT (name) DO NOTHING;
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
