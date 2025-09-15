import { pool } from './database';

export async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
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

    // Add new aggregator fields
    await pool.query(`
      ALTER TABLE users_whatsapp 
      ADD COLUMN IF NOT EXISTS mobile_no VARCHAR(20),
      ADD COLUMN IF NOT EXISTS gst_required BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS gst_number VARCHAR(15),
      ADD COLUMN IF NOT EXISTS aggregator_name VARCHAR(255)
    `);

    // Check if contacts table exists and has user_id column
    const tableCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'contacts' AND column_name = 'user_id'
    `);

    if (tableCheck.rows.length === 0) {
      // Table doesn't exist or user_id column doesn't exist
      console.log('Creating contacts table with user_id column...');
      
      // Drop existing table if it exists (without user_id)
      await pool.query(`DROP TABLE IF EXISTS contacts CASCADE`);
      
      // Create new table with user_id
      await pool.query(`
        CREATE TABLE contacts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
          name VARCHAR(255),
          email VARCHAR(255),
          whatsapp_number VARCHAR(20) NOT NULL,
          phone VARCHAR(20),
          telegram_id VARCHAR(100),
          viber_id VARCHAR(100),
          line_id VARCHAR(100),
          instagram_id VARCHAR(100),
          facebook_id VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, whatsapp_number)
        );
      `);
      
      console.log('Contacts table created with user_id column');
    } else {
      console.log('Contacts table already has user_id column');
    }

    // Create indexes for better performance (after ensuring user_id column exists)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_number ON contacts(whatsapp_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
      CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
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

    // Safe add: phone_number on wallet_transactions for linking to recipient
    await pool.query(`
      ALTER TABLE wallet_transactions
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_phone ON wallet_transactions(phone_number);
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

    // Messages library: store successful outbound messages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users_whatsapp(id) ON DELETE SET NULL,
        to_number VARCHAR(32) NOT NULL,
        message_type VARCHAR(32) NOT NULL,
        template_id VARCHAR(128),
        campaign_id VARCHAR(128),
        message_id VARCHAR(128),
        status VARCHAR(32) NOT NULL DEFAULT 'SENT',
        payload_json JSONB,
        response_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_to_number ON messages(to_number);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
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
    // Safe column adds/upgrades for existing databases (suspense support)
    await pool.query(`
      ALTER TABLE wallet_accounts
      ADD COLUMN IF NOT EXISTS suspense_balance_paise INTEGER NOT NULL DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE wallet_transactions
      ADD COLUMN IF NOT EXISTS suspense_balance_after_paise INTEGER;
    `);
    // Refresh wallet_transactions.type check to include suspense types
    await pool.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
        EXCEPTION WHEN undefined_object THEN
          -- nothing
          NULL;
        END;
        ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
          CHECK (type IN ('RECHARGE','DEBIT','REFUND','ADJUSTMENT','SUSPENSE_DEBIT','SUSPENSE_REFUND'));
      END$$;
    `);

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

    // Create wallet_logs table for tracking wallet transactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('credit', 'debit', 'refund', 'adjustment')),
        amount_paise INTEGER NOT NULL,
        amount_currency VARCHAR(10) DEFAULT 'INR',
        description TEXT,
        reference_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create WhatsApp setups table for tracking user WhatsApp Business setup
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_setups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        phone_number_id VARCHAR(255),
        waba_id VARCHAR(255),
        business_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN (
          'not_started', 
          'embedded_signup_completed', 
          'tp_signup_completed', 
          'wallet_check_completed',
          'templates_setup_completed', 
          'setup_completed'
        )),
        business_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_setups_user_id ON whatsapp_setups(user_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_setups_status ON whatsapp_setups(status);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_setups_waba_id ON whatsapp_setups(waba_id);
    `);

    // Create campaigns table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('IMMEDIATE', 'SCHEDULED')),
        audience_type VARCHAR(20) NOT NULL CHECK (audience_type IN ('ALL', 'SEGMENTED', 'QUICK')),
        message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('TEMPLATE', 'REGULAR', 'BOT')),
        template_id VARCHAR(255),
        message_content TEXT,
        audience_size INTEGER NOT NULL,
        scheduled_at TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED')),
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create message_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id SERIAL PRIMARY KEY,
        campaign_id VARCHAR(255) NOT NULL,
        to_number VARCHAR(20) NOT NULL,
        template_name VARCHAR(255) NOT NULL,
        language_code VARCHAR(10) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        read_at TIMESTAMP,
        failed_at TIMESTAMP,
        error_message TEXT,
        user_id INTEGER NOT NULL REFERENCES users_whatsapp(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);
      CREATE INDEX IF NOT EXISTS idx_message_logs_campaign_id ON message_logs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_message_logs_user_id ON message_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_message_logs_status ON message_logs(status);
      CREATE INDEX IF NOT EXISTS idx_message_logs_created_at ON message_logs(created_at);
    `);

    // Create webhook_logs table for comprehensive webhook data logging
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN ('verification', 'message_status', 'incoming_message', 'tech_partner', 'unknown')),
        http_method VARCHAR(10) NOT NULL,
        request_url TEXT NOT NULL,
        query_params JSONB,
        headers JSONB,
        body_data JSONB,
        response_status INTEGER,
        response_data TEXT,
        processing_time_ms INTEGER,
        error_message TEXT,
        user_id INTEGER REFERENCES users_whatsapp(id) ON DELETE SET NULL,
        phone_number_id VARCHAR(255),
        waba_id VARCHAR(255),
        message_id VARCHAR(255),
        conversation_id VARCHAR(255),
        event_type VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )
    `);

    // Create indexes for webhook_logs
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_type ON webhook_logs(webhook_type);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_user_id ON webhook_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_phone_number_id ON webhook_logs(phone_number_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_waba_id ON webhook_logs(waba_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id ON webhook_logs(message_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_conversation_id ON webhook_logs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);
    `);

    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
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
