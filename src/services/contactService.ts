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
    try {
      console.log("ContactService: getAllContacts called with limit:", limit);
      const query = `
        SELECT * FROM contacts 
        ORDER BY created_at DESC 
        ${limit ? 'LIMIT $1' : ''}
      `;
      const params = limit ? [limit] : [];
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting all contacts:', error);
      throw error;
    }
  }

  static async getContactById(id: number): Promise<Contact | null> {
    try {
      console.log("ContactService: getContactById called with id:", id);
      const query = 'SELECT * FROM contacts WHERE id = $1';
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting contact by id:', error);
      throw error;
    }
  }

  static async getContactByWhatsAppNumber(whatsappNumber: string): Promise<Contact | null> {
    try {
      console.log("ContactService: getContactByWhatsAppNumber called with:", whatsappNumber);
      const query = 'SELECT * FROM contacts WHERE whatsapp_number = $1';
      const result = await pool.query(query, [whatsappNumber]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting contact by WhatsApp number:', error);
      throw error;
    }
  }

  static async createContact(data: CreateContactData): Promise<Contact> {
    try {
      console.log("ContactService: createContact called with:", data);
      const query = `
        INSERT INTO contacts (
          name, email, whatsapp_number, phone, telegram_id, viber_id, 
          line_id, instagram_id, facebook_id, created_at, last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *
      `;
      const params = [
        data.name, data.email, data.whatsapp_number, data.phone,
        data.telegram_id, data.viber_id, data.line_id, data.instagram_id, data.facebook_id
      ];
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  static async updateContact(data: UpdateContactData): Promise<Contact | null> {
    try {
      console.log("ContactService: updateContact called with:", data);
      const { id, ...updateData } = data;
      
      const fields = Object.keys(updateData).map((key, index) => `${key} = $${index + 2}`);
      const values = Object.values(updateData);
      
      const query = `
        UPDATE contacts 
        SET ${fields.join(', ')}, last_seen_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      const params = [id, ...values];
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating contact:', error);
      throw error;
    }
  }

  static async deleteContact(id: number): Promise<boolean> {
    try {
      console.log("ContactService: deleteContact called with id:", id);
      const query = 'DELETE FROM contacts WHERE id = $1';
      const result = await pool.query(query, [id]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting contact:', error);
      throw error;
    }
  }

  static async searchContacts(searchTerm: string, limit?: number): Promise<Contact[]> {
    try {
      console.log("ContactService: searchContacts called with:", searchTerm, limit);
      const query = `
        SELECT * FROM contacts 
        WHERE name ILIKE $1 OR email ILIKE $1 OR whatsapp_number ILIKE $1
        ORDER BY created_at DESC
        ${limit ? 'LIMIT $2' : ''}
      `;
      const searchPattern = `%${searchTerm}%`;
      const params = limit ? [searchPattern, limit] : [searchPattern];
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error searching contacts:', error);
      throw error;
    }
  }
}
