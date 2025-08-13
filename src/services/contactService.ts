import { pool } from '../config/database';

export interface Contact {
  id: number;
  name?: string;
  email?: string;
  whatsapp_number: string;
  phone?: string;
  telegram_id?: string;
  viber_id?: string;
  line_id?: string;
  instagram_id?: string;
  facebook_id?: string;
  created_at: Date;
  last_seen_at: Date;
}

export interface CreateContactData {
  name?: string;
  email?: string;
  whatsapp_number: string;
  phone?: string;
  telegram_id?: string;
  viber_id?: string;
  line_id?: string;
  instagram_id?: string;
  facebook_id?: string;
}

export interface UpdateContactData extends Partial<CreateContactData> {
  id: number;
}

export class ContactService {
  static async getAllContacts(limit?: number): Promise<Contact[]> {
    const query = `
      SELECT * FROM contacts 
      ORDER BY created_at DESC 
      ${limit ? 'LIMIT $1' : ''}
    `;
    
    const params = limit ? [limit] : [];
    const result = await pool.query(query, params);
    return result.rows;
  }

  static async getContactById(id: number): Promise<Contact | null> {
    const query = 'SELECT * FROM contacts WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async getContactByWhatsAppNumber(whatsappNumber: string): Promise<Contact | null> {
    const query = 'SELECT * FROM contacts WHERE whatsapp_number = $1';
    const result = await pool.query(query, [whatsappNumber]);
    return result.rows[0] || null;
  }

  static async createContact(data: CreateContactData): Promise<Contact> {
    const query = `
      INSERT INTO contacts (
        name, email, whatsapp_number, phone, telegram_id, 
        viber_id, line_id, instagram_id, facebook_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    
    const values = [
      data.name || null,
      data.email || null,
      data.whatsapp_number,
      data.phone || null,
      data.telegram_id || null,
      data.viber_id || null,
      data.line_id || null,
      data.instagram_id || null,
      data.facebook_id || null
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async updateContact(data: UpdateContactData): Promise<Contact | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic query based on provided fields
    if (data.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.email !== undefined) {
      fields.push(`email = $${paramCount++}`);
      values.push(data.email);
    }
    if (data.whatsapp_number !== undefined) {
      fields.push(`whatsapp_number = $${paramCount++}`);
      values.push(data.whatsapp_number);
    }
    if (data.phone !== undefined) {
      fields.push(`phone = $${paramCount++}`);
      values.push(data.phone);
    }
    if (data.telegram_id !== undefined) {
      fields.push(`telegram_id = $${paramCount++}`);
      values.push(data.telegram_id);
    }
    if (data.viber_id !== undefined) {
      fields.push(`viber_id = $${paramCount++}`);
      values.push(data.viber_id);
    }
    if (data.line_id !== undefined) {
      fields.push(`line_id = $${paramCount++}`);
      values.push(data.line_id);
    }
    if (data.instagram_id !== undefined) {
      fields.push(`instagram_id = $${paramCount++}`);
      values.push(data.instagram_id);
    }
    if (data.facebook_id !== undefined) {
      fields.push(`facebook_id = $${paramCount++}`);
      values.push(data.facebook_id);
    }

    if (fields.length === 0) {
      return this.getContactById(data.id);
    }

    fields.push(`last_seen_at = CURRENT_TIMESTAMP`);
    values.push(data.id);

    const query = `
      UPDATE contacts 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  static async deleteContact(id: number): Promise<boolean> {
    const query = 'DELETE FROM contacts WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  static async searchContacts(searchTerm: string, limit?: number): Promise<Contact[]> {
    const query = `
      SELECT * FROM contacts 
      WHERE 
        name ILIKE $1 OR 
        email ILIKE $1 OR 
        whatsapp_number ILIKE $1 OR 
        phone ILIKE $1
      ORDER BY created_at DESC 
      ${limit ? 'LIMIT $2' : ''}
    `;
    
    const searchPattern = `%${searchTerm}%`;
    const params = limit ? [searchPattern, limit] : [searchPattern];
    const result = await pool.query(query, params);
    return result.rows;
  }
}
