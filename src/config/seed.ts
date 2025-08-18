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
      return;
    }
    
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
