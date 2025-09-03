import { pool } from '../config/database';

export interface Contact {
  id: number;
  user_id: number;
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
  user_id: number;
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

export interface UpdateContactData extends Partial<Omit<CreateContactData, 'user_id'>> {
}

export class ContactService {
  static async getAllContacts(userId: number, limit?: number): Promise<Contact[]> {
    try {
      console.log("ContactService: getAllContacts called with userId:", userId, "limit:", limit);
      const query = `
        SELECT * FROM contacts 
        WHERE user_id = $1
        ORDER BY created_at DESC 
        ${limit ? 'LIMIT $2' : ''}
      `;
      const params = limit ? [userId, limit] : [userId];
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting all contacts:', error);
      throw error;
    }
  }

  static async getContactById(id: number, userId: number): Promise<Contact | null> {
    try {
      console.log("ContactService: getContactById called with id:", id, "userId:", userId);
      const query = `
        SELECT * FROM contacts 
        WHERE id = $1 AND user_id = $2
      `;
      const result = await pool.query(query, [id, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting contact by ID:', error);
      throw error;
    }
  }

  static async getContactByWhatsAppNumber(whatsappNumber: string, userId: number): Promise<Contact | null> {
    try {
      console.log("ContactService: getContactByWhatsAppNumber called with whatsappNumber:", whatsappNumber, "userId:", userId);
      const query = `
        SELECT * FROM contacts 
        WHERE whatsapp_number = $1 AND user_id = $2
      `;
      const result = await pool.query(query, [whatsappNumber, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting contact by WhatsApp number:', error);
      throw error;
    }
  }

  static async searchContacts(searchTerm: string, userId: number, limit?: number): Promise<Contact[]> {
    try {
      console.log("ContactService: searchContacts called with searchTerm:", searchTerm, "userId:", userId, "limit:", limit);
      const query = `
        SELECT * FROM contacts 
        WHERE user_id = $1 AND (
          name ILIKE $2 OR 
          email ILIKE $2 OR 
          whatsapp_number ILIKE $2 OR 
          phone ILIKE $2
        )
        ORDER BY created_at DESC
        ${limit ? 'LIMIT $3' : ''}
      `;
      const searchPattern = `%${searchTerm}%`;
      const params = limit ? [userId, searchPattern, limit] : [userId, searchPattern];
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error searching contacts:', error);
      throw error;
    }
  }

  static async createContact(data: CreateContactData): Promise<Contact> {
    try {
      console.log("ContactService: createContact called with:", data);
      const query = `
        INSERT INTO contacts (
          user_id, name, email, whatsapp_number, phone, telegram_id, viber_id, 
          line_id, instagram_id, facebook_id, created_at, last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *
      `;
      const params = [
        data.user_id, data.name, data.email, data.whatsapp_number, data.phone,
        data.telegram_id, data.viber_id, data.line_id, data.instagram_id, data.facebook_id
      ];
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  static async updateContact(id: number, userId: number, data: UpdateContactData): Promise<Contact | null> {
    try {
      console.log("ContactService: updateContact called with id:", id, "userId:", userId, "data:", data);
      
      // Build dynamic query based on provided fields
      const fields = [];
      const values = [];
      let paramIndex = 1;
      
      if (data.name !== undefined) {
        fields.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.email !== undefined) {
        fields.push(`email = $${paramIndex++}`);
        values.push(data.email);
      }
      if (data.whatsapp_number !== undefined) {
        fields.push(`whatsapp_number = $${paramIndex++}`);
        values.push(data.whatsapp_number);
      }
      if (data.phone !== undefined) {
        fields.push(`phone = $${paramIndex++}`);
        values.push(data.phone);
      }
      if (data.telegram_id !== undefined) {
        fields.push(`telegram_id = $${paramIndex++}`);
        values.push(data.telegram_id);
      }
      if (data.viber_id !== undefined) {
        fields.push(`viber_id = $${paramIndex++}`);
        values.push(data.viber_id);
      }
      if (data.line_id !== undefined) {
        fields.push(`line_id = $${paramIndex++}`);
        values.push(data.line_id);
      }
      if (data.instagram_id !== undefined) {
        fields.push(`instagram_id = $${paramIndex++}`);
        values.push(data.instagram_id);
      }
      if (data.facebook_id !== undefined) {
        fields.push(`facebook_id = $${paramIndex++}`);
        values.push(data.facebook_id);
      }
      
      if (fields.length === 0) {
        // No fields to update, just return the contact
        return this.getContactById(id, userId);
      }
      
      const query = `
        UPDATE contacts 
        SET ${fields.join(', ')}, last_seen_at = NOW()
        WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
        RETURNING *
      `;
      values.push(id, userId);
      
      const result = await pool.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error updating contact:', error);
      throw error;
    }
  }

  static async deleteContact(id: number, userId: number): Promise<boolean> {
    try {
      console.log("ContactService: deleteContact called with id:", id, "userId:", userId);
      const query = `
        DELETE FROM contacts 
        WHERE id = $1 AND user_id = $2
      `;
      const result = await pool.query(query, [id, userId]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting contact:', error);
      throw error;
    }
  }
}
