// import { pool } from '../config/database'; // Temporarily commented out

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

// Mock data for testing without database
const mockContacts: Contact[] = [
  {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    whatsapp_number: "+1234567890",
    phone: "+1234567890",
    created_at: new Date("2024-01-01"),
    last_seen_at: new Date("2024-01-15")
  },
  {
    id: 2,
    name: "Jane Smith",
    email: "jane@example.com",
    whatsapp_number: "+1987654321",
    phone: "+1987654321",
    created_at: new Date("2024-01-02"),
    last_seen_at: new Date("2024-01-16")
  },
  {
    id: 3,
    name: "Bob Johnson",
    email: "bob@example.com",
    whatsapp_number: "+1122334455",
    phone: "+1122334455",
    created_at: new Date("2024-01-03"),
    last_seen_at: new Date("2024-01-17")
  }
];

export class ContactService {
  static async getAllContacts(limit?: number): Promise<Contact[]> {
    // Mock implementation - return sample data
    console.log("Mock ContactService: getAllContacts called with limit:", limit);
    return limit ? mockContacts.slice(0, limit) : mockContacts;
  }

  static async getContactById(id: number): Promise<Contact | null> {
    // Mock implementation
    console.log("Mock ContactService: getContactById called with id:", id);
    return mockContacts.find(contact => contact.id === id) || null;
  }

  static async getContactByWhatsAppNumber(whatsappNumber: string): Promise<Contact | null> {
    // Mock implementation
    console.log("Mock ContactService: getContactByWhatsAppNumber called with:", whatsappNumber);
    return mockContacts.find(contact => contact.whatsapp_number === whatsappNumber) || null;
  }

  static async createContact(data: CreateContactData): Promise<Contact> {
    // Mock implementation
    console.log("Mock ContactService: createContact called with:", data);
    const newContact: Contact = {
      id: mockContacts.length + 1,
      ...data,
      created_at: new Date(),
      last_seen_at: new Date()
    };
    mockContacts.push(newContact);
    return newContact;
  }

  static async updateContact(data: UpdateContactData): Promise<Contact | null> {
    // Mock implementation
    console.log("Mock ContactService: updateContact called with:", data);
    const index = mockContacts.findIndex(contact => contact.id === data.id);
    if (index === -1) return null;
    
    mockContacts[index] = { ...mockContacts[index], ...data };
    return mockContacts[index];
  }

  static async deleteContact(id: number): Promise<boolean> {
    // Mock implementation
    console.log("Mock ContactService: deleteContact called with id:", id);
    const index = mockContacts.findIndex(contact => contact.id === id);
    if (index === -1) return false;
    
    mockContacts.splice(index, 1);
    return true;
  }

  static async searchContacts(searchTerm: string, limit?: number): Promise<Contact[]> {
    // Mock implementation
    console.log("Mock ContactService: searchContacts called with:", searchTerm, limit);
    const filtered = mockContacts.filter(contact => 
      contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.whatsapp_number.includes(searchTerm)
    );
    return limit ? filtered.slice(0, limit) : filtered;
  }
}
