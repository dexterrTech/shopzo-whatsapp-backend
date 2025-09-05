import { pool } from '../config/database';

export interface WebhookLogData {
  webhook_type: 'verification' | 'message_status' | 'incoming_message' | 'tech_partner' | 'unknown';
  http_method: string;
  request_url: string;
  query_params?: any;
  headers?: any;
  body_data?: any;
  response_status?: number;
  response_data?: string;
  processing_time_ms?: number;
  error_message?: string;
  user_id?: number;
  phone_number_id?: string;
  waba_id?: string;
  message_id?: string;
  conversation_id?: string;
  event_type?: string;
}

export class WebhookLoggingService {
  /**
   * Log webhook data to database
   */
  static async logWebhook(data: WebhookLogData): Promise<void> {
    try {
      const query = `
        INSERT INTO webhook_logs (
          webhook_type, http_method, request_url, query_params, headers, body_data,
          response_status, response_data, processing_time_ms, error_message,
          user_id, phone_number_id, waba_id, message_id, conversation_id, event_type
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
      `;

      const values = [
        data.webhook_type,
        data.http_method,
        data.request_url,
        data.query_params ? JSON.stringify(data.query_params) : null,
        data.headers ? JSON.stringify(data.headers) : null,
        data.body_data ? JSON.stringify(data.body_data) : null,
        data.response_status,
        data.response_data,
        data.processing_time_ms,
        data.error_message,
        data.user_id,
        data.phone_number_id,
        data.waba_id,
        data.message_id,
        data.conversation_id,
        data.event_type
      ];

      await pool.query(query, values);
      console.log(`✅ Webhook logged: ${data.webhook_type} - ${data.http_method} ${data.request_url}`);
    } catch (error) {
      console.error('❌ Failed to log webhook:', error);
      // Don't throw error to avoid breaking webhook processing
    }
  }

  /**
   * Determine webhook type based on request data
   */
  static determineWebhookType(req: any, body?: any): WebhookLogData['webhook_type'] {
    // Check if it's a verification request
    if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
      return 'verification';
    }

    // Check if it's a tech partner event (Interakt onboarding)
    if (body?.object === 'tech_partner') {
      return 'tech_partner';
    }

    // Check if it's a WhatsApp Business Account event
    if (body?.object === 'whatsapp_business_account') {
      // Check for account updates (like PARTNER_ADDED)
      if (body.entry?.some((entry: any) => 
        entry.changes?.some((change: any) => change.field === 'account_update')
      )) {
        return 'tech_partner'; // Treat account updates as tech partner events
      }

      // Check for message status updates
      if (body.entry?.some((entry: any) => 
        entry.changes?.some((change: any) => change.value?.statuses)
      )) {
        return 'message_status';
      }

      // Check for incoming messages
      if (body.entry?.some((entry: any) => 
        entry.changes?.some((change: any) => change.value?.messages)
      )) {
        return 'incoming_message';
      }
    }

    return 'unknown';
  }

  /**
   * Extract relevant data from webhook body
   */
  static extractWebhookData(body: any): Partial<WebhookLogData> {
    const data: Partial<WebhookLogData> = {};

    if (body?.object === 'whatsapp_business_account') {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.value?.metadata?.phone_number_id) {
            data.phone_number_id = change.value.metadata.phone_number_id;
          }

          if (change.value?.statuses) {
            change.value.statuses.forEach((status: any) => {
              if (status.id) {
                data.message_id = status.id;
                data.conversation_id = status.id;
              }
              if (status.status) {
                data.event_type = status.status;
              }
            });
          }

          if (change.value?.messages) {
            change.value.messages.forEach((message: any) => {
              if (message.id) {
                data.message_id = message.id;
              }
              if (message.type) {
                data.event_type = message.type;
              }
            });
          }
        });
      });
    }

    if (body?.object === 'tech_partner') {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.value?.event) {
            data.event_type = change.value.event;
          }
          if (change.value?.waba_info?.waba_id) {
            data.waba_id = change.value.waba_info.waba_id;
          }
        });
      });
    }

    // Handle account_update events from whatsapp_business_account (PARTNER_ADDED)
    if (body?.object === 'whatsapp_business_account') {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.field === 'account_update' && change.value?.event) {
            data.event_type = change.value.event;
            if (change.value.waba_info?.waba_id) {
              data.waba_id = change.value.waba_info.waba_id;
            }
            if (change.value.waba_info?.phone_number_id) {
              data.phone_number_id = change.value.waba_info.phone_number_id;
            }
          }
        });
      });
    }

    return data;
  }

  /**
   * Get webhook logs with filtering
   */
  static async getWebhookLogs(filters: {
    webhook_type?: string;
    user_id?: number;
    phone_number_id?: string;
    waba_id?: string;
    event_type?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    try {
      let query = `
        SELECT 
          id, webhook_type, http_method, request_url, query_params, headers, body_data,
          response_status, response_data, processing_time_ms, error_message,
          user_id, phone_number_id, waba_id, message_id, conversation_id, event_type,
          created_at, processed_at
        FROM webhook_logs
        WHERE 1=1
      `;
      
      const values: any[] = [];
      let paramCount = 0;

      if (filters.webhook_type) {
        paramCount++;
        query += ` AND webhook_type = $${paramCount}`;
        values.push(filters.webhook_type);
      }

      if (filters.user_id) {
        paramCount++;
        query += ` AND user_id = $${paramCount}`;
        values.push(filters.user_id);
      }

      if (filters.phone_number_id) {
        paramCount++;
        query += ` AND phone_number_id = $${paramCount}`;
        values.push(filters.phone_number_id);
      }

      if (filters.waba_id) {
        paramCount++;
        query += ` AND waba_id = $${paramCount}`;
        values.push(filters.waba_id);
      }

      if (filters.event_type) {
        paramCount++;
        query += ` AND event_type = $${paramCount}`;
        values.push(filters.event_type);
      }

      if (filters.start_date) {
        paramCount++;
        query += ` AND created_at >= $${paramCount}`;
        values.push(filters.start_date);
      }

      if (filters.end_date) {
        paramCount++;
        query += ` AND created_at <= $${paramCount}`;
        values.push(filters.end_date);
      }

      query += ` ORDER BY created_at DESC`;

      if (filters.limit) {
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        values.push(filters.limit);
      }

      if (filters.offset) {
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        values.push(filters.offset);
      }

      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get webhook logs:', error);
      throw error;
    }
  }

  /**
   * Get webhook statistics
   */
  static async getWebhookStats() {
    try {
      const query = `
        SELECT 
          webhook_type,
          COUNT(*) as total_count,
          COUNT(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 END) as success_count,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count,
          AVG(processing_time_ms) as avg_processing_time_ms,
          MAX(created_at) as last_webhook_at
        FROM webhook_logs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY webhook_type
        ORDER BY total_count DESC
      `;

      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get webhook stats:', error);
      throw error;
    }
  }
}
