import { pool } from '../config/database';

/**
 * Get user's WhatsApp setup information
 * @param userId - The user's ID
 * @returns Promise with waba_id and phone_number_id
 */
export async function getUserWhatsAppSetup(userId: number) {
  const result = await pool.query(
    'SELECT waba_id, phone_number_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL',
    [userId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('WhatsApp setup not completed. Please complete WhatsApp Business setup first.');
  }
  
  return result.rows[0];
}

// Export for TypeScript module resolution
export default { getUserWhatsAppSetup };
