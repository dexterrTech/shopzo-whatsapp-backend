import { pool } from './database';
import bcrypt from 'bcryptjs';

export async function seedDatabase() {
  try {
    console.log('Seeding database with sample data...');
    
    // Create default super admin user if not exists
    const existingAdmin = await pool.query(
      'SELECT id FROM users_whatsapp WHERE email = $1',
      ['admin@whatsapp.com']
    );

    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 12);
      
      await pool.query(
        `INSERT INTO users_whatsapp (name, email, password_hash, role, is_approved, is_active) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['Super Admin', 'admin@whatsapp.com', passwordHash, 'super_admin', true, true]
      );
      
      console.log('Default super admin created: admin@whatsapp.com / admin123');
    } else {
      console.log('Super admin already exists, skipping creation');
    }
    
    // Check if we already have contacts data
    const existingContacts = await pool.query('SELECT COUNT(*) FROM contacts');
    if (parseInt(existingContacts.rows[0].count) > 0) {
      console.log('Database already has contacts data, skipping contacts seed');
    } else {
      // Insert sample contacts
      const sampleContacts = [
        {
          name: 'John Doe',
          email: 'john.doe@example.com',
          whatsapp_number: '919876543210',
          phone: '+91 98765 43210',
          telegram_id: '@johndoe',
          viber_id: 'john.doe',
          line_id: 'johndoe123',
          instagram_id: 'john.doe',
          facebook_id: 'john.doe.123'
        },
        {
          name: 'Jane Smith',
          email: 'jane.smith@example.com',
          whatsapp_number: '919876543211',
          phone: '+91 98765 43211',
          telegram_id: '@janesmith',
          viber_id: 'jane.smith',
          line_id: 'janesmith123',
          instagram_id: 'jane.smith',
          facebook_id: 'jane.smith.123'
        },
        {
          name: 'Bob Johnson',
          email: 'bob.johnson@example.com',
          whatsapp_number: '919876543212',
          phone: '+91 98765 43212',
          telegram_id: '@bobjohnson',
          viber_id: 'bob.johnson',
          line_id: 'bobjohnson123',
          instagram_id: 'bob.johnson',
          facebook_id: 'bob.johnson.123'
        }
      ];
      
      for (const contact of sampleContacts) {
        await pool.query(`
          INSERT INTO contacts (
            name, email, whatsapp_number, phone, telegram_id, 
            viber_id, line_id, instagram_id, facebook_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          contact.name,
          contact.email,
          contact.whatsapp_number,
          contact.phone,
          contact.telegram_id,
          contact.viber_id,
          contact.line_id,
          contact.instagram_id,
          contact.facebook_id
        ]);
      }
      
      console.log(`Inserted ${sampleContacts.length} sample contacts`);
    }

    // Seed a default price plan if none exists
    const plans = await pool.query('SELECT COUNT(*) FROM price_plans');
    if (parseInt(plans.rows[0].count) === 0) {
      await pool.query(
        `INSERT INTO price_plans (name, currency, utility_paise, marketing_paise, authentication_paise, service_paise, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['Default', 'INR', 115, 163, 50, 0, true]
      );
      console.log('Seeded default price plan');
    }

    // Seed billing logs if none exist
    const billingLogs = await pool.query('SELECT COUNT(*) FROM billing_logs');
    if (parseInt(billingLogs.rows[0].count) === 0) {
      await seedBillingLogs();
    } else {
      console.log('Billing logs already exist, checking if user 2 has logs...');
      // First check if user ID 2 exists
      const userExists = await pool.query('SELECT id FROM users_whatsapp WHERE id = 2');
      if (userExists.rows.length === 0) {
        console.log('User ID 2 does not exist, skipping billing logs check');
      } else {
        // Check if user ID 2 has any billing logs
        const user2Logs = await pool.query('SELECT COUNT(*) FROM billing_logs WHERE user_id = 2');
        if (parseInt(user2Logs.rows[0].count) === 0) {
          console.log('User 2 has no billing logs, creating some...');
          await seedBillingLogsForUser2();
        } else {
          console.log('User 2 already has billing logs');
        }
      }
    }
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

// Run seed if this file is executed directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Database seeded successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

export async function seedBillingLogsForUser2() {
  try {
    console.log('Seeding billing logs for user ID 2...');
    
    const userId = 2; // atharva prakashsa pawar's user ID
    
    // First check if user ID 2 exists
    const userCheck = await pool.query('SELECT id FROM users_whatsapp WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      console.log(`User ID ${userId} does not exist, skipping billing logs creation`);
      return;
    }
    
    // Sample billing logs data for user ID 2
    const sampleLogs = [
      {
        conversation_id: `wamid.${Date.now()}_1`,
        user_id: userId,
        category: 'utility',
        recipient_number: '919373355199',
        start_time: '2025-08-18 18:34:00',
        end_time: '2025-08-18 18:34:00',
        billing_status: 'paid',
        amount_paise: 115,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: `wamid.${Date.now()}_2`,
        user_id: userId,
        category: 'marketing',
        recipient_number: '919876543210',
        start_time: '2025-08-18 19:15:00',
        end_time: '2025-08-18 19:20:00',
        billing_status: 'pending',
        amount_paise: 500,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: `wamid.${Date.now()}_3`,
        user_id: userId,
        category: 'service',
        recipient_number: '919876543211',
        start_time: '2025-08-18 20:00:00',
        end_time: '2025-08-18 20:05:00',
        billing_status: 'paid',
        amount_paise: 345,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: `wamid.${Date.now()}_4`,
        user_id: userId,
        category: 'authentication',
        recipient_number: '919876543212',
        start_time: '2025-08-18 21:00:00',
        end_time: '2025-08-18 21:10:00',
        billing_status: 'paid',
        amount_paise: 200,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: `wamid.${Date.now()}_5`,
        user_id: userId,
        category: 'utility',
        recipient_number: '919876543213',
        start_time: '2025-08-19 10:00:00',
        end_time: '2025-08-19 10:15:00',
        billing_status: 'paid',
        amount_paise: 275,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      }
    ];

         for (const log of sampleLogs) {
       await pool.query(`
         INSERT INTO billing_logs (
           conversation_id, user_id, category, recipient_number, 
           start_time, end_time, billing_status, amount_paise, 
           amount_currency, country_code, country_name
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       `, [
         log.conversation_id, log.user_id, log.category, log.recipient_number,
         log.start_time, log.end_time, log.billing_status, log.amount_paise,
         log.amount_currency, log.country_code, log.country_name
       ]);
     }

     console.log('Billing logs seeded successfully for user ID 2!');
  } catch (error) {
    console.error('Error seeding billing logs for user 2:', error);
    throw error;
  }
}

export async function seedBillingLogs() {
  try {
    console.log('Seeding billing logs...');
    
    // Get a sample user ID (assuming user with ID 1 exists)
    const userResult = await pool.query('SELECT id FROM users_whatsapp LIMIT 1');
    if (userResult.rows.length === 0) {
      console.log('No users found, skipping billing logs seed');
      return;
    }
    
    const userId = userResult.rows[0].id;
    
    // Sample billing logs data
    const sampleLogs = [
      {
        conversation_id: 'wamid.HBgNMTkzNzMzNTUxOTkVAgAREAABFzQxNjQ5NjQ5NjQ5NjQ5NjQ5NjQ5',
        user_id: userId,
        category: 'utility',
        recipient_number: '919373355199',
        start_time: '2025-08-18 18:34:00',
        end_time: '2025-08-18 18:34:00',
        billing_status: 'paid',
        amount_paise: 115,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: 'wamid.HBgNMTkzNzMzNTUxOTkVMgAREAABFzQxNjQ5NjQ5NjQ5NjQ5NjQ5NjQ5',
        user_id: userId,
        category: 'utility',
        recipient_number: '919876543210',
        start_time: '2025-08-18 19:15:00',
        end_time: '2025-08-18 19:20:00',
        billing_status: 'paid',
        amount_paise: 230,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: 'wamid.HBgNMTkzNzMzNTUxOTkVMwAREAABFzQxNjQ5NjQ5NjQ5NjQ5NjQ5NjQ5',
        user_id: userId,
        category: 'marketing',
        recipient_number: '919876543211',
        start_time: '2025-08-18 20:00:00',
        end_time: '2025-08-18 20:05:00',
        billing_status: 'pending',
        amount_paise: 500,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: 'wamid.HBgNMTkzNzMzNTUxOTkVNAAREAABFzQxNjQ5NjQ5NjQ5NjQ5NjQ5NjQ5',
        user_id: userId,
        category: 'service',
        recipient_number: '919876543212',
        start_time: '2025-08-18 21:00:00',
        end_time: '2025-08-18 21:10:00',
        billing_status: 'paid',
        amount_paise: 345,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: 'wamid.HBgNMTkzNzMzNTUxOTkVNQAREAABFzQxNjQ5NjQ5NjQ5NjQ5NjQ5NjQ5',
        user_id: userId,
        category: 'authentication',
        recipient_number: '919876543213',
        start_time: '2025-08-18 22:00:00',
        end_time: '2025-08-18 22:02:00',
        billing_status: 'paid',
        amount_paise: 100,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      }
    ];

         // Insert sample logs
     for (const log of sampleLogs) {
       await pool.query(`
         INSERT INTO billing_logs (
           conversation_id, user_id, category, recipient_number, 
           start_time, end_time, billing_status, amount_paise, 
           amount_currency, country_code, country_name
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       `, [
         log.conversation_id, log.user_id, log.category, log.recipient_number,
         log.start_time, log.end_time, log.billing_status, log.amount_paise,
         log.amount_currency, log.country_code, log.country_name
       ]);
     }

    console.log('Billing logs seeded successfully');
  } catch (error) {
    console.error('Failed to seed billing logs:', error);
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedBillingLogs()
    .then(() => {
      console.log('Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}
