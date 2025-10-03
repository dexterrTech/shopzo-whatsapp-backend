import { pool } from '../config/database';
import { env } from '../config/env';

export interface SessionMessagePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: boolean;
    body: string;
  };
}

export interface SessionMessageResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

export class SessionMessageService {
  /**
   * Send a session text message via Interakt API
   */
  static async sendSessionTextMessage(
    phoneNumberId: string,
    accessToken: string,
    wabaId: string,
    to: string,
    message: string
  ): Promise<SessionMessageResponse> {
    const payload: SessionMessagePayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    };

    console.log(`📤 Sending session message to ${to} via phone number ID: ${phoneNumberId}`);
    console.log(`🔑 Using WABA ID: ${wabaId}`);
    console.log(`📝 Message: "${message}"`);

    const response = await fetch(
      `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'x-access-token': accessToken,
          'x-waba-id': wabaId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Session message API error: ${response.status} ${response.statusText}`);
      console.error(`❌ Error details: ${errorText}`);
      throw new Error(`Session message API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Session message sent successfully:`, result);
    return result;
  }

  /** Send plain session text to the sender using webhook metadata */
  static async sendPlainSessionMessageFromWebhook(
    webhookData: any,
    text: string
  ): Promise<SessionMessageResponse | null> {
    try {
      const userPhone = this.extractUserPhoneFromWebhook(webhookData);
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);
      if (!userPhone || !wabaId || !phoneNumberId) return null;
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) return null;
      const to = userPhone.startsWith('+') ? userPhone : `+${userPhone}`;
      return await this.sendSessionTextMessage(phoneNumberId, accessToken, wabaId, to, text);
    } catch {
      return null;
    }
  }

  /** Send interactive buttons (quick replies) to the sender using webhook metadata */
  static async sendInteractiveButtonsFromWebhook(
    webhookData: any,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<any | null> {
    try {
      const userPhone = this.extractUserPhoneFromWebhook(webhookData);
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);
      if (!userPhone || !wabaId || !phoneNumberId) return null;
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) return null;
      const to = userPhone.startsWith('+') ? userPhone : `+${userPhone}`;

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title }
            }))
          }
        }
      } as any;

      const resp = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'x-access-token': accessToken,
            'x-waba-id': wabaId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        console.error('❌ Interactive buttons send failed', resp.status, resp.statusText, t);
        return null;
      }
      return await resp.json();
    } catch (e) {
      console.error('❌ Error sending interactive buttons:', e);
      return null;
    }
  }

  /** Fetch media URL by media ID using Interakt API */
  static async fetchMediaUrl(
    phoneNumberId: string,
    wabaId: string,
    accessToken: string,
    mediaId: string
  ): Promise<{ url: string; mime_type?: string } | null> {
    try {
      const url = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/media/${mediaId}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'x-access-token': accessToken,
          'x-waba-id': wabaId,
          'Content-Type': 'application/json'
        }
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.error('Failed to fetch media url', resp.status, resp.statusText, text);
        return null;
      }
      const data = await resp.json();
      return { url: String(data?.url || ''), mime_type: data?.mime_type };
    } catch (e) {
      console.error('Error fetching media url:', e);
      return null;
    }
  }

  /** Send media template to all contacts using webhook metadata */
  static async sendMediaTemplateToContactsUsingWebhook(
    webhookData: any,
    templateName: string,
    mediaLink: string,
    captionText?: string,
    languageCode?: string
  ): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>{
    try {
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);
      if (!wabaId || !phoneNumberId) return { ok: false, sent: 0, failed: 0, error: 'Missing wabaId/phoneNumberId' };
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) return { ok: false, sent: 0, failed: 0, error: 'Missing INTERAKT_ACCESS_TOKEN' };

      const userId = await this.findUserIdByWabaId(wabaId);
      if (!userId) return { ok: false, sent: 0, failed: 0, error: 'No user for WABA' };
      const numbers = await this.getContactNumbersByUserId(userId);
      if (numbers.length === 0) return { ok: false, sent: 0, failed: 0, error: 'No contacts for user' };

      // Determine language
      const approved = await this.fetchApprovedTemplatesDetailed(wabaId, accessToken);
      const meta = approved.find(t => t.name.toLowerCase() === templateName.toLowerCase());
      const lang = languageCode || meta?.language || 'en';

      let sent = 0, failed = 0;
      for (const rawTo of numbers) {
        const to = rawTo.startsWith('+') ? rawTo : `+${rawTo}`;
        const payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: lang },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'image',
                    image: { link: mediaLink }
                  }
                ]
              }
            ]
          }
        };
        // Ensure at least one BODY param for templates expecting {{1}}
        (payload.template.components as any[]).push({
          type: 'body',
          parameters: [
            { type: 'text', text: (captionText && captionText.trim().length > 0) ? captionText.trim() : '-' }
          ]
        });

        try {
          const url = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'x-access-token': accessToken,
              'x-waba-id': wabaId,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            console.error('Interakt media template send failed', resp.status, resp.statusText, t);
            failed++;
          } else {
            sent++;
          }
        } catch (e) { console.error('Interakt media template send error', e); failed++; }
      }

      return { ok: sent > 0, sent, failed };
    } catch (e: any) {
      return { ok: false, sent: 0, failed: 0, error: e?.message || 'Unknown error' };
    }
  }

  /** Send media template using WhatsApp media ID instead of link */
  static async sendMediaTemplateWithMediaIdToContactsUsingWebhook(
    webhookData: any,
    templateName: string,
    mediaId: string,
    captionText?: string,
    languageCode?: string
  ): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>{
    try {
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);
      if (!wabaId || !phoneNumberId) return { ok: false, sent: 0, failed: 0, error: 'Missing wabaId/phoneNumberId' };
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) return { ok: false, sent: 0, failed: 0, error: 'Missing INTERAKT_ACCESS_TOKEN' };

      const userId = await this.findUserIdByWabaId(wabaId);
      if (!userId) return { ok: false, sent: 0, failed: 0, error: 'No user for WABA' };
      const numbers = await this.getContactNumbersByUserId(userId);
      if (numbers.length === 0) return { ok: false, sent: 0, failed: 0, error: 'No contacts for user' };

      const approved = await this.fetchApprovedTemplatesDetailed(wabaId, accessToken);
      const meta = approved.find(t => t.name.toLowerCase() === templateName.toLowerCase());
      const lang = languageCode || meta?.language || 'en';

      let sent = 0, failed = 0;
      for (const rawTo of numbers) {
        const to = rawTo.startsWith('+') ? rawTo : `+${rawTo}`;
        const payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: lang },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'image',
                    image: { id: mediaId }
                  }
                ]
              }
            ]
          }
        };
        // Ensure at least one BODY param for templates expecting {{1}}
        (payload.template.components as any[]).push({
          type: 'body',
          parameters: [ { type: 'text', text: (captionText && captionText.trim().length > 0) ? captionText.trim() : '-' } ]
        });
        try {
          const url = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'x-access-token': accessToken,
              'x-waba-id': wabaId,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            console.error('Interakt media-id template send failed', resp.status, resp.statusText, t);
            failed++;
          } else { sent++; }
        } catch (e) { console.error('Interakt media-id template send error', e); failed++; }
      }

      return { ok: sent > 0, sent, failed };
    } catch (e: any) {
      return { ok: false, sent: 0, failed: 0, error: e?.message || 'Unknown error' };
    }
  }
  /** Lookup user_id by WABA id */
  static async findUserIdByWabaId(wabaId: string): Promise<number | null> {
    try {
      const q = `SELECT user_id FROM whatsapp_setups WHERE waba_id = $1 LIMIT 1`;
      const r = await pool.query(q, [wabaId]);
      return r.rows?.[0]?.user_id ?? null;
    } catch (e) {
      console.error('Error finding user by WABA ID:', e);
      return null;
    }
  }

  /** Get contact WhatsApp numbers for a user */
  static async getContactNumbersByUserId(userId: number): Promise<string[]> {
    try {
      const q = `SELECT whatsapp_number FROM contacts WHERE user_id = $1`;
      const r = await pool.query(q, [userId]);
      return (r.rows || []).map((row: any) => String(row.whatsapp_number)).filter(Boolean);
    } catch (e) {
      console.error('Error fetching contacts for user:', e);
      return [];
    }
  }

  /** Send a template by name to many recipients using webhook metadata */
  static async sendTemplateByNameToContactsUsingWebhook(
    webhookData: any,
    templateNameRaw: string,
    languageCode: string = 'en'
  ): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>{
    try {
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);
      if (!wabaId || !phoneNumberId) {
        return { ok: false, sent: 0, failed: 0, error: 'Missing wabaId/phoneNumberId' };
      }
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        return { ok: false, sent: 0, failed: 0, error: 'Missing INTERAKT_ACCESS_TOKEN' };
      }

      const userId = await this.findUserIdByWabaId(wabaId);
      if (!userId) {
        return { ok: false, sent: 0, failed: 0, error: 'No user found for WABA' };
      }
      const numbers = await this.getContactNumbersByUserId(userId);
      if (numbers.length === 0) {
        return { ok: false, sent: 0, failed: 0, error: 'No contacts found for user' };
      }

      // Resolve template (approved, language)
      const approvedTemplates = await this.fetchApprovedTemplatesDetailed(wabaId, accessToken);
      const inputName = String(templateNameRaw || '').trim();
      const metaMap = new Map<string, { name: string; language?: string }>();
      for (const t of approvedTemplates) metaMap.set(t.name.toLowerCase(), t);
      const matched = metaMap.get(inputName.toLowerCase());
      if (!matched) {
        return { ok: false, sent: 0, failed: 0, error: 'Template not found or not approved' };
      }
      const lang = languageCode || matched.language || 'en';

      let sent = 0; let failed = 0;
      for (const rawTo of numbers) {
        const to = rawTo.startsWith('+') ? rawTo : `+${rawTo}`;
        const payload = {
          messaging_product: 'whatsapp' as const,
          recipient_type: 'individual' as const,
          to,
          type: 'template' as const,
          template: { name: matched.name, language: { code: lang } }
        };
        try {
          const url = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'x-access-token': accessToken,
              'x-waba-id': wabaId,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            failed++;
          } else {
            sent++;
          }
        } catch {
          failed++;
        }
      }

      return { ok: sent > 0, sent, failed };
    } catch (e: any) {
      return { ok: false, sent: 0, failed: 0, error: e?.message || 'Unknown error' };
    }
  }
  /**
   * Send campaign notification message to user
   */
  static async sendCampaignNotificationMessage(
    userId: number,
    message: string = "All contacts from your dashboard have been selected. Here are your available templates:"
  ): Promise<SessionMessageResponse | null> {
    try {
      // Get user's WhatsApp setup details
      const userSetupQuery = `
        SELECT ws.waba_id, ws.phone_number_id, u.mobile_no
        FROM whatsapp_setups ws
        JOIN users_whatsapp u ON ws.user_id = u.id
        WHERE ws.user_id = $1
        LIMIT 1
      `;
      
      const userSetupResult = await pool.query(userSetupQuery, [userId]);
      
      if (userSetupResult.rows.length === 0) {
        console.warn(`No WhatsApp setup found for user ${userId}`);
        return null;
      }

      const { waba_id, phone_number_id, mobile_no } = userSetupResult.rows[0];
      
      if (!waba_id || !phone_number_id || !mobile_no) {
        console.warn(`Incomplete WhatsApp setup for user ${userId}:`, { waba_id, phone_number_id, mobile_no });
        return null;
      }

      // Get access token from environment file
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        console.error('❌ INTERAKT_ACCESS_TOKEN not found in environment variables');
        console.error('Please set INTERAKT_ACCESS_TOKEN=rC8uFUXFoRz5jtnSbG2RzhEm6tVBgliN in your .env file');
        return null;
      }

      console.log(`🔑 Using access token from env: ${accessToken.substring(0, 10)}...`);

      // Send the session message
      const response = await this.sendSessionTextMessage(
        phone_number_id,
        accessToken,
        waba_id,
        mobile_no,
        message
      );

      console.log(`✅ Campaign notification sent to user ${userId} (${mobile_no})`);
      return response;

    } catch (error) {
      console.error(`❌ Failed to send campaign notification to user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Fetch templates from Interakt API
   */
  static async fetchTemplates(wabaId: string, accessToken: string): Promise<string[]> {
    try {
      console.log(`📋 Fetching templates for WABA: ${wabaId}`);
      
      const response = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${wabaId}/message_templates?fields=name,status,language&limit=50`,
        {
          method: 'GET',
          headers: {
            'x-access-token': accessToken,
            'x-waba-id': wabaId,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to fetch templates: ${response.status} ${response.statusText} - ${errorText}`);
        return [];
      }

      const data = await response.json();
      console.log(`📋 Fetched ${data.data?.length || 0} templates`);

      // Filter only approved templates and extract names
      const approvedTemplates = data.data
        ?.filter((template: any) => template.status === 'APPROVED')
        ?.map((template: any) => template.name)
        ?.slice(0, 10) || []; // Limit to 10 templates

      console.log(`✅ Found ${approvedTemplates.length} approved templates:`, approvedTemplates);
      return approvedTemplates;

    } catch (error) {
      console.error('❌ Error fetching templates:', error);
      return [];
    }
  }

  /**
   * Fetch approved templates with language metadata
   */
  static async fetchApprovedTemplatesDetailed(
    wabaId: string,
    accessToken: string
  ): Promise<Array<{ name: string; language?: string }>> {
    try {
      const response = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${wabaId}/message_templates?fields=name,status,language&limit=100`,
        {
          method: 'GET',
          headers: {
            'x-access-token': accessToken,
            'x-waba-id': wabaId,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to fetch templates (detailed): ${response.status} ${response.statusText} - ${errorText}`);
        return [];
      }

      const data = await response.json();
      const approved = (data.data || [])
        .filter((t: any) => t?.status === 'APPROVED')
        .map((t: any) => ({ name: String(t?.name || ''), language: t?.language })) as Array<{ name: string; language?: string }>;

      return approved;
    } catch (e) {
      console.error('❌ Error fetching templates (detailed):', e);
      return [];
    }
  }

  /**
   * Send a template by name using webhook data (extracts WABA/Phone IDs and recipient)
   */
  static async sendTemplateByNameUsingWebhook(
    webhookData: any,
    templateNameRaw: string,
    languageCode: string = 'en'
  ): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const userPhone = this.extractUserPhoneFromWebhook(webhookData);
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);

      if (!userPhone || !wabaId || !phoneNumberId) {
        return { ok: false, error: 'Missing userPhone/wabaId/phoneNumberId from webhook' };
      }

      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        return { ok: false, error: 'Missing INTERAKT_ACCESS_TOKEN' };
      }

      // Verify template exists and is approved, and capture language
      const approvedTemplates = await this.fetchApprovedTemplatesDetailed(wabaId, accessToken);
      const inputName = String(templateNameRaw || '').trim();
      if (!inputName) {
        return { ok: false, error: 'Empty template name' };
      }

      // Find case-insensitive match while preserving casing and language
      const metaMap = new Map<string, { name: string; language?: string }>();
      for (const t of approvedTemplates) {
        metaMap.set(t.name.toLowerCase(), t);
      }
      const matched = metaMap.get(inputName.toLowerCase());
      if (!matched) {
        return { ok: false, error: 'Template not found or not approved' };
      }

      const languageToUse = matched.language || 'en';

      const payload = {
        messaging_product: 'whatsapp' as const,
        recipient_type: 'individual' as const,
        to: userPhone.startsWith('+') ? userPhone : `+${userPhone}`,
        type: 'template' as const,
        template: {
          name: matched.name,
          language: { code: languageCode || languageToUse }
        }
      };

      const url = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'x-access-token': accessToken,
          'x-waba-id': wabaId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!resp.ok) {
        console.error('❌ Interakt template send failed', { status: resp.status, statusText: resp.statusText, data });
        return { ok: false, error: `Interakt template send failed: ${resp.status} ${resp.statusText}`, data };
      }

      return { ok: true, data };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Unknown error' };
    }
  }

  /**
   * Format templates list into message
   */
  static formatTemplatesMessage(templates: string[]): string {
    if (templates.length === 0) {
      return "All contacts from your dashboard have been selected. Here are your available templates:\n\nNo approved templates found.";
    }

    let message = "All contacts from your dashboard have been selected. Here are your available templates:\n\n";
    
    templates.forEach((template, index) => {
      message += `${index + 1}. ${template}\n`;
    });

    return message.trim();
  }

  /**
   * Send session message using webhook data directly
   */
  static async sendSessionMessageFromWebhook(
    webhookData: any,
    message?: string
  ): Promise<SessionMessageResponse | null> {
    try {
      // Extract data from webhook
      const userPhone = this.extractUserPhoneFromWebhook(webhookData);
      const wabaId = this.extractWabaIdFromWebhook(webhookData);
      const phoneNumberId = this.extractPhoneNumberIdFromWebhook(webhookData);

      console.log(`🔍 Extracted from webhook:`, { userPhone, wabaId, phoneNumberId });

      if (!userPhone || !wabaId || !phoneNumberId) {
        console.warn('Missing required data from webhook:', { userPhone, wabaId, phoneNumberId });
        return null;
      }

      // Get access token from environment file
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        console.error('❌ INTERAKT_ACCESS_TOKEN not found in environment variables');
        console.error('Please set INTERAKT_ACCESS_TOKEN=rC8uFUXFoRz5jtnSbG2RzhEm6tVBgliN in your .env file');
        return null;
      }

      console.log(`🔑 Using access token from env: ${accessToken.substring(0, 10)}...`);

      // If no custom message provided, fetch templates and format message
      let finalMessage = message;
      if (!finalMessage) {
        console.log('📋 Fetching templates to create message...');
        const templates = await this.fetchTemplates(wabaId, accessToken);
        finalMessage = this.formatTemplatesMessage(templates);
      }

      // Send the session message using webhook data
      const response = await this.sendSessionTextMessage(
        phoneNumberId,
        accessToken,
        wabaId,
        userPhone,
        finalMessage
      );

      console.log(`✅ Session message sent using webhook data to ${userPhone} (WABA: ${wabaId}, Phone ID: ${phoneNumberId})`);
      return response;

    } catch (error) {
      console.error(`❌ Failed to send session message from webhook:`, error);
      return null;
    }
  }

  /**
   * Get user's phone number from webhook data
   */
  static extractUserPhoneFromWebhook(webhookData: any): string | null {
    try {
      // Extract phone number from webhook body data
      if (webhookData?.entry) {
        for (const entry of webhookData.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              // Check for incoming messages first
              if (change.value?.messages) {
                for (const message of change.value.messages) {
                  if (message.from) {
                    return message.from;
                  }
                }
              }
              // Check for status updates
              if (change.value?.statuses) {
                for (const status of change.value.statuses) {
                  if (status.recipient_id) {
                    return status.recipient_id;
                  }
                }
              }
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Error extracting user phone from webhook:', error);
      return null;
    }
  }

  /**
   * Get WABA ID from webhook data
   */
  static extractWabaIdFromWebhook(webhookData: any): string | null {
    try {
      // Extract WABA ID from webhook body data
      if (webhookData?.entry) {
        for (const entry of webhookData.entry) {
          if (entry.id) {
            return entry.id; // The entry ID is the WABA ID
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Error extracting WABA ID from webhook:', error);
      return null;
    }
  }

  /**
   * Get phone number ID from webhook data
   */
  static extractPhoneNumberIdFromWebhook(webhookData: any): string | null {
    try {
      // Extract phone number ID from webhook body data
      if (webhookData?.entry) {
        for (const entry of webhookData.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.value?.metadata?.phone_number_id) {
                return change.value.metadata.phone_number_id;
              }
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Error extracting phone number ID from webhook:', error);
      return null;
    }
  }

  /**
   * Find user by phone number
   */
  static async findUserByPhoneNumber(phoneNumber: string): Promise<number | null> {
    try {
      // Clean phone number (remove + and any formatting)
      const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
      
      const query = `
        SELECT id FROM users_whatsapp 
        WHERE mobile_no = $1 OR mobile_no = $2 OR mobile_no = $3
        LIMIT 1
      `;
      
      const result = await pool.query(query, [
        phoneNumber,           // Original format
        `+${cleanPhone}`,      // With + prefix
        cleanPhone             // Just numbers
      ]);
      
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error('Error finding user by phone number:', error);
      return null;
    }
  }
}



