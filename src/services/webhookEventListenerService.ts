import { pool } from '../config/database';
import { SessionMessageService } from './sessionMessageService';
import { env } from '../config/env';

export interface WebhookEvent {
  id: number;
  webhook_type: string;
  http_method: string;
  request_url: string;
  headers: any;
  body_data: any;
  phone_number_id?: string;
  waba_id?: string;
  message_id?: string;
  conversation_id?: string;
  event_type?: string;
  created_at: string;
}

export class WebhookEventListenerService {
  private static isListening = false;
  private static pollInterval: NodeJS.Timeout | null = null;
  private static lastProcessedId = 0;
  // Deduplication cache for incoming message IDs to avoid duplicate handling
  private static processedMessageIdToTs: Map<string, number> = new Map();
  private static readonly DEDUP_TTL_MS = 120000; // 2 minutes
  // Hold pending media per user phone awaiting confirmation
  private static pendingMediaByUser: Map<string, { mediaId: string; wabaId: string; phoneNumberId: string; ts: number }> = new Map();
  // Deduplication cache for session messages to prevent duplicate responses
  private static sentSessionMessages: Map<string, number> = new Map();
  private static readonly SESSION_MSG_DEDUP_TTL_MS = 300000; // 5 minutes
  // Deduplication cache for webhook events to prevent duplicate processing
  private static processedWebhookEvents: Map<string, number> = new Map();
  private static readonly WEBHOOK_DEDUP_TTL_MS = 60000; // 1 minute

  /**
   * Check if a session message has already been sent to prevent duplicates
   */
  private static hasSessionMessageBeenSent(userPhone: string, messageType: string): boolean {
    const now = Date.now();
    const key = `${userPhone}:${messageType}`;
    
    // Cleanup old entries
    for (const [k, ts] of this.sentSessionMessages) {
      if (now - ts > this.SESSION_MSG_DEDUP_TTL_MS) {
        this.sentSessionMessages.delete(k);
      }
    }
    
    return this.sentSessionMessages.has(key);
  }

  /**
   * Mark a session message as sent to prevent duplicates
   */
  private static markSessionMessageSent(userPhone: string, messageType: string): void {
    const key = `${userPhone}:${messageType}`;
    this.sentSessionMessages.set(key, Date.now());
  }

  /**
   * Clear session message deduplication cache (useful for testing or manual reset)
   */
  static clearSessionMessageCache(): void {
    this.sentSessionMessages.clear();
    console.log('🧹 Session message deduplication cache cleared');
  }

  /**
   * Clear webhook event deduplication cache (useful for testing or manual reset)
   */
  static clearWebhookEventCache(): void {
    this.processedWebhookEvents.clear();
    console.log('🧹 Webhook event deduplication cache cleared');
  }

  /**
   * Clear all deduplication caches
   */
  static clearAllCaches(): void {
    this.sentSessionMessages.clear();
    this.processedWebhookEvents.clear();
    this.processedMessageIdToTs.clear();
    this.pendingMediaByUser.clear();
    console.log('🧹 All deduplication caches cleared');
  }

  /**
   * Get session message cache statistics for debugging
   */
  static getSessionMessageCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.sentSessionMessages.entries()).map(([key, timestamp]) => ({
      key,
      age: now - timestamp
    }));
    
    return {
      size: this.sentSessionMessages.size,
      entries
    };
  }

  /**
   * Check if a webhook event has already been processed to prevent duplicates
   */
  private static hasWebhookEventBeenProcessed(eventId: number, eventType: string): boolean {
    const now = Date.now();
    const key = `${eventId}:${eventType}`;
    
    // Cleanup old entries
    for (const [k, ts] of this.processedWebhookEvents) {
      if (now - ts > this.WEBHOOK_DEDUP_TTL_MS) {
        this.processedWebhookEvents.delete(k);
      }
    }
    
    return this.processedWebhookEvents.has(key);
  }

  /**
   * Mark a webhook event as processed to prevent duplicates
   */
  private static markWebhookEventProcessed(eventId: number, eventType: string): void {
    const key = `${eventId}:${eventType}`;
    this.processedWebhookEvents.set(key, Date.now());
  }

  /**
   * Start listening for new webhook events
   */
  static startListening(pollIntervalMs: number = 5000): void {
    if (this.isListening) {
      console.log('Webhook event listener is already running');
      return;
    }

    console.log('🔄 Starting webhook event listener...');
    this.isListening = true;

    // Get the latest webhook log ID to start from
    this.initializeLastProcessedId();

    // Start polling for new webhook events
    this.pollInterval = setInterval(async () => {
      try {
        await this.processNewWebhookEvents();
      } catch (error) {
        console.error('Error processing webhook events:', error);
      }
    }, pollIntervalMs);

    console.log('✅ Webhook event listener started');
  }

  /**
   * Stop listening for webhook events
   */
  static stopListening(): void {
    if (!this.isListening) {
      console.log('Webhook event listener is not running');
      return;
    }

    console.log('🛑 Stopping webhook event listener...');
    this.isListening = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log('✅ Webhook event listener stopped');
  }

  /**
   * Initialize the last processed ID from the most recent webhook log
   */
  private static async initializeLastProcessedId(): Promise<void> {
    try {
      const query = `
        SELECT id FROM webhook_logs 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query);
      if (result.rows.length > 0) {
        this.lastProcessedId = result.rows[0].id;
        console.log(`📊 Initialized webhook listener from ID: ${this.lastProcessedId}`);
      }
    } catch (error) {
      console.error('Error initializing last processed ID:', error);
    }
  }

  /**
   * Process new webhook events since the last processed ID
   */
  static async processNewWebhookEvents(): Promise<void> {
    try {
      const query = `
        SELECT id, webhook_type, http_method, request_url, headers, body_data,
               phone_number_id, waba_id, message_id, conversation_id, event_type, created_at
        FROM webhook_logs 
        WHERE id > $1 
        ORDER BY created_at ASC
      `;
      
      const result = await pool.query(query, [this.lastProcessedId]);
      
      if (result.rows.length === 0) {
        return; // No new events
      }

      console.log(`📨 Processing ${result.rows.length} new webhook events...`);

      for (const event of result.rows) {
        await this.processWebhookEvent(event);
        this.lastProcessedId = event.id;
      }

    } catch (error) {
      console.error('Error processing new webhook events:', error);
    }
  }

  /**
   * Process a single webhook event
   */
  private static async processWebhookEvent(event: WebhookEvent): Promise<void> {
    try {
      console.log(`🔍 Processing webhook event ${event.id}: ${event.webhook_type} - ${event.http_method} ${event.request_url}`);

      // Check for campaign creation events
      if (this.isCampaignCreationEvent(event)) {
        if (this.hasWebhookEventBeenProcessed(event.id, 'campaign_creation')) {
          console.log(`🔄 Campaign creation event ${event.id} already processed, skipping duplicate`);
          return;
        }
        console.log(`🎯 Campaign creation event detected: ${event.id}`);
        await this.handleCampaignCreationEvent(event);
        this.markWebhookEventProcessed(event.id, 'campaign_creation');
        return;
      }

      // Check if this is an incoming message with campaign command
      if (this.isIncomingMessageEvent(event)) {
        if (this.hasWebhookEventBeenProcessed(event.id, 'incoming_message')) {
          console.log(`🔄 Incoming message event ${event.id} already processed, skipping duplicate`);
          return;
        }
        console.log(`📨 Incoming campaign command message detected: ${event.id}`);
        const handled = await this.tryHandleTemplateSelection(event);
        if (!handled) {
          await this.handleIncomingMessageEvent(event);
        }
        this.markWebhookEventProcessed(event.id, 'incoming_message');
        return;
      } else if (this.hasAnyIncomingMessage(event)) {
        if (this.hasWebhookEventBeenProcessed(event.id, 'any_incoming_message')) {
          console.log(`🔄 Any incoming message event ${event.id} already processed, skipping duplicate`);
          return;
        }
        // If it's any incoming message (e.g., user replied with a template name), try to handle selection only
        const handled = await this.tryHandleTemplateSelection(event);
        if (!handled) {
          // If image arrived as per media template path, try to consume it
          const mediaHandled = await this.tryHandleIncomingImageForMediaTemplate(event);
          if (!mediaHandled) {
            // Not valid selection and not image for media path; ignore
          }
        }
        this.markWebhookEventProcessed(event.id, 'any_incoming_message');
        return;
      }

      // Check if this is a message status event that might indicate user interaction
      if (event.webhook_type === 'message_status' && this.isUserInteractionEvent(event)) {
        if (this.hasWebhookEventBeenProcessed(event.id, 'user_interaction')) {
          console.log(`🔄 User interaction event ${event.id} already processed, skipping duplicate`);
          return;
        }
        console.log(`💬 User interaction event detected: ${event.id}`);
        await this.handleUserInteractionEvent(event);
        this.markWebhookEventProcessed(event.id, 'user_interaction');
        return;
      }

    } catch (error) {
      console.error(`Error processing webhook event ${event.id}:`, error);
    }
  }

  /**
   * Check if the webhook event is related to campaign creation
   */
  private static isCampaignCreationEvent(event: WebhookEvent): boolean {
    // Check if the request URL contains campaign creation endpoints
    const campaignEndpoints = [
      '/api/send-template/campaigns',
      '/api/campaigns',
      '/api/template-campaign'
    ];

    return campaignEndpoints.some(endpoint => 
      event.request_url.includes(endpoint) && event.http_method === 'POST'
    );
  }

  /**
   * Check if the webhook event indicates user interaction (like message read)
   */
  private static isUserInteractionEvent(event: WebhookEvent): boolean {
    try {
      if (!event.body_data) return false;

      const bodyData = typeof event.body_data === 'string' 
        ? JSON.parse(event.body_data) 
        : event.body_data;

      // Check for message status updates that indicate user interaction
      if (bodyData.entry) {
        for (const entry of bodyData.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.value?.statuses) {
                for (const status of change.value.statuses) {
                  // Check for read status or other user interactions
                  if (status.status === 'read' || status.status === 'delivered') {
                    return true;
                  }
                }
              }
            }
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking user interaction event:', error);
      return false;
    }
  }

  /**
   * Check if the webhook event contains an incoming message with campaign command
   */
  private static isIncomingMessageEvent(event: WebhookEvent): boolean {
    try {
      if (!event.body_data) return false;

      const bodyData = typeof event.body_data === 'string' 
        ? JSON.parse(event.body_data) 
        : event.body_data;

      // Check for incoming messages
      if (bodyData.entry) {
        for (const entry of bodyData.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.value?.messages) {
                for (const message of change.value.messages) {
                  // Check if it's a text message
                  if (message.type === 'text' && message.text?.body) {
                    const messageText = message.text.body.toLowerCase().trim();
                    // Check for campaign creation command
                    if (messageText.includes('/create') && 
                        messageText.includes('campaign') && 
                        messageText.includes('send')) {
                      return true;
                    }
                  }
                }
              }
            }
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking incoming message event:', error);
      return false;
    }
  }

  /**
   * Extract incoming message text from webhook event
   */
  private static extractIncomingMessageText(event: WebhookEvent): string | null {
    try {
      if (!event.body_data) return null;

      const bodyData = typeof event.body_data === 'string' 
        ? JSON.parse(event.body_data) 
        : event.body_data;

      if (bodyData.entry) {
        for (const entry of bodyData.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.value?.messages) {
                for (const message of change.value.messages) {
                  // Support plain text
                  if (message.type === 'text' && message.text?.body) {
                    // Dedup incoming message by its id
                    const msgId = String(message.id || '');
                    if (msgId) {
                      const now = Date.now();
                      // Cleanup old entries
                      for (const [k, ts] of this.processedMessageIdToTs) {
                        if (now - ts > this.DEDUP_TTL_MS) this.processedMessageIdToTs.delete(k);
                      }
                      if (this.processedMessageIdToTs.has(msgId)) {
                        return null; // already processed recently
                      }
                      this.processedMessageIdToTs.set(msgId, now);
                    }
                    return message.text.body;
                  }
                  // Support interactive button replies (treat title as text command)
                  if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
                    const msgId = String(message.id || '');
                    if (msgId) {
                      const now = Date.now();
                      for (const [k, ts] of this.processedMessageIdToTs) {
                        if (now - ts > this.DEDUP_TTL_MS) this.processedMessageIdToTs.delete(k);
                      }
                      if (this.processedMessageIdToTs.has(msgId)) {
                        return null;
                      }
                      this.processedMessageIdToTs.set(msgId, now);
                    }
                    const title = message.interactive?.button_reply?.title;
                    const id = message.interactive?.button_reply?.id;
                    // Prefer ID, fallback to title
                    return (id || title) ? String(id || title) : null;
                  }
                }
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting incoming message text:', error);
      return null;
    }
  }

  /**
   * Check if the webhook event contains any incoming message (used to catch template name replies)
   */
  private static hasAnyIncomingMessage(event: WebhookEvent): boolean {
    try {
      if (!event.body_data) return false;
      const bodyData = typeof event.body_data === 'string' ? JSON.parse(event.body_data) : event.body_data;
      return Boolean(
        bodyData?.entry?.some((entry: any) =>
          entry?.changes?.some((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0)
        )
      );
    } catch {
      return false;
    }
  }

  /** If the last incoming is an image and we are in media template path, send media template */
  private static async tryHandleIncomingImageForMediaTemplate(event: WebhookEvent): Promise<boolean> {
    try {
      console.log('🖼️ Checking for incoming image to use in media template...');
      const bodyData = typeof event.body_data === 'string' ? JSON.parse(event.body_data) : event.body_data;
      const entry = bodyData?.entry?.[0];
      const change = entry?.changes?.[0];
      const messages = change?.value?.messages || [];
      const meta = change?.value?.metadata;
      const phoneNumberId = meta?.phone_number_id;
      const wabaId = entry?.id;
      const msg = messages[0];
      if (!msg || msg.type !== 'image') return false;
      const mediaId = msg?.image?.id;
      if (!mediaId || !phoneNumberId || !wabaId) return false;

      const accessToken = env.INTERAKT_ACCESS_TOKEN || process.env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) return false;

      // Store pending media and ask confirmation
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (!userPhone) return false;
      this.pendingMediaByUser.set(userPhone, { mediaId, wabaId, phoneNumberId, ts: Date.now() });
      // Cleanup old entries
      const now = Date.now();
      for (const [k, v] of this.pendingMediaByUser) {
        if (now - v.ts > this.DEDUP_TTL_MS) this.pendingMediaByUser.delete(k);
      }
      await SessionMessageService.sendInteractiveButtonsFromWebhook(
        event.body_data,
        'Send this image to all contacts?',
        [
          { id: 'CONFIRM_SEND_IMAGE_YES', title: 'Yes' },
          { id: 'CONFIRM_SEND_IMAGE_NO', title: 'No' }
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to parse a template selection from a free text reply
   * Accepts case-insensitive template name; sends selected template and confirms
   */
  private static async tryHandleTemplateSelection(event: WebhookEvent): Promise<boolean> {
    const msg = this.extractIncomingMessageText(event);
    if (!msg) return false;

    const candidate = msg.trim();
    if (!candidate) return false;

    // Branches based on instruction flow
    const lc = candidate.toLowerCase();
    if (lc === 'show templates' || lc === 'show_templates' || lc === 'show templates'.toUpperCase() || lc === 'show_templates'.toUpperCase() || lc === 'SHOW_TEMPLATES') {
      // Check if we've already sent template list to this user
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (userPhone && this.hasSessionMessageBeenSent(userPhone, 'template_list')) {
        console.log(`🔄 Template list already sent to ${userPhone}, skipping duplicate`);
        return true;
      }
      
      // List templates using existing flow
      await SessionMessageService.sendSessionMessageFromWebhook(event.body_data);
      
      if (userPhone) {
        this.markSessionMessageSent(userPhone, 'template_list');
      }
      return true;
    }
    if (lc === 'use media template' || lc === 'use_media_template' || lc === 'USE MEDIA TEMPLATE' || lc === 'USE_MEDIA_TEMPLATE') {
      // Check if we've already sent media template prompt to this user
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (userPhone && this.hasSessionMessageBeenSent(userPhone, 'media_template_prompt')) {
        console.log(`🔄 Media template prompt already sent to ${userPhone}, skipping duplicate`);
        return true;
      }
      
      // Prompt for media
      await SessionMessageService.sendPlainSessionMessageFromWebhook(
        event.body_data,
        'Please send the image to use in the media template. Optionally, reply a caption after sending the image.'
      );
      
      if (userPhone) {
        this.markSessionMessageSent(userPhone, 'media_template_prompt');
      }
      return true;
    }

    // Confirmation for sending the captured image
    if (lc === 'CONFIRM_SEND_IMAGE_YES' || lc === 'confirm_send_image_yes') {
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (!userPhone) return true;
      const pending = this.pendingMediaByUser.get(userPhone);
      if (!pending) {
        await SessionMessageService.sendPlainSessionMessageFromWebhook(event.body_data, 'No pending image found. Please choose "Use media template" and send an image.');
        return true;
      }
      const result = await SessionMessageService.sendMediaTemplateWithMediaIdToContactsUsingWebhook(
        event.body_data,
        'shopzo_marketting_mansoon',
        pending.mediaId
      );
      this.pendingMediaByUser.delete(userPhone);
      if (result.ok) {
        await SessionMessageService.sendPlainSessionMessageFromWebhook(event.body_data, `Campaign sent successfully to ${result.sent} contact(s).`);
      } else {
        await SessionMessageService.sendPlainSessionMessageFromWebhook(event.body_data, 'Failed to send campaign. Please try again.');
      }
      return true;
    }
    if (lc === 'CONFIRM_SEND_IMAGE_NO' || lc === 'confirm_send_image_no') {
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (userPhone) this.pendingMediaByUser.delete(userPhone);
      await SessionMessageService.sendPlainSessionMessageFromWebhook(event.body_data, 'Cancelled.');
      return true;
    }

    // Guard: only allow template selection after command flow has been initiated recently for this conversation
    // Simple heuristic: require the last bot message to have been the templates list. For now, we gate by checking
    // that the candidate contains no spaces and is alphanumeric/underscores, to reduce accidental triggers.
    const looksLikeTemplateName = /^[a-z0-9_\.\-]+$/i.test(candidate);
    if (!looksLikeTemplateName) return false;

    // Send to contacts (not to the sender) based on WABA → user_id → contacts
    const bulk = await SessionMessageService.sendTemplateByNameToContactsUsingWebhook(event.body_data, candidate, 'en');
    if (bulk.ok && bulk.sent > 0) {
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      if (userPhone && this.hasSessionMessageBeenSent(userPhone, 'campaign_success')) {
        console.log(`🔄 Campaign success message already sent to ${userPhone}, skipping duplicate`);
        return true;
      }
      
      await SessionMessageService.sendSessionMessageFromWebhook(
        event.body_data,
        `Campaign sent successfully to ${bulk.sent} contact(s).`
      );
      
      if (userPhone) {
        this.markSessionMessageSent(userPhone, 'campaign_success');
      }
      return true;
    }
    return false;
  }

  /**
   * Handle campaign creation event
   */
  private static async handleCampaignCreationEvent(event: WebhookEvent): Promise<void> {
    try {
      // Extract user information from the webhook event using multiple methods
      const userId = await this.getUserIdFromEvent(event);
      
      if (!userId) {
        console.warn(`Could not extract user ID from campaign creation event ${event.id}`);
        return;
      }

      // Send campaign notification message
      const response = await SessionMessageService.sendCampaignNotificationMessage(
        userId,
        "All contacts from your dashboard have been selected. Here are your available templates:"
      );

      if (response) {
        console.log(`✅ Campaign notification sent to user ${userId} for event ${event.id}`);
      } else {
        console.warn(`❌ Failed to send campaign notification to user ${userId} for event ${event.id}`);
      }

    } catch (error) {
      console.error(`Error handling campaign creation event ${event.id}:`, error);
    }
  }

  /**
   * Handle incoming message event with campaign command
   */
  private static async handleIncomingMessageEvent(event: WebhookEvent): Promise<void> {
    try {
      // Extract the message text
      const messageText = this.extractIncomingMessageText(event);
      console.log(`📝 User message: "${messageText}"`);

      // Extract user phone number from webhook data
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      console.log(`📞 Extracted user phone: ${userPhone}`);
      
      if (!userPhone) {
        console.warn(`Could not extract user phone from incoming message event ${event.id}`);
        console.log(`🔍 Webhook body data:`, JSON.stringify(event.body_data, null, 2));
        return;
      }

      // Check if we've already sent a campaign command response to this user
      if (this.hasSessionMessageBeenSent(userPhone, 'campaign_command')) {
        console.log(`🔄 Campaign command response already sent to ${userPhone}, skipping duplicate`);
        return;
      }

      // If command: send only the instruction line and ask for action
      const instruction = 'All contacts from your dashboard have been selected.';
      console.log(`📤 Attempting to send interactive buttons to ${userPhone}`);
      
      // Send as interactive buttons
      let response = await SessionMessageService.sendInteractiveButtonsFromWebhook(
        event.body_data,
        instruction,
        [
          { id: 'SHOW_TEMPLATES', title: 'Show templates' },
          { id: 'USE_MEDIA_TEMPLATE', title: 'Use media template' }
        ]
      );

      if (response) {
        console.log(`✅ Session message sent using webhook data to ${userPhone} for command: "${messageText}"`);
        this.markSessionMessageSent(userPhone, 'campaign_command');
        return;
      }

      // Fallback: Find user by phone number and use database setup
      console.log(`🔄 Interactive buttons failed, falling back to database lookup for user ${userPhone}`);
      const userId = await SessionMessageService.findUserByPhoneNumber(userPhone);
      
      if (!userId) {
        console.warn(`Could not find user for phone number ${userPhone} in event ${event.id}`);
        console.log(`🔍 Attempted phone number variations: ${userPhone}, +${userPhone}, ${userPhone.replace(/[^\d]/g, '')}`);
        return;
      }

      console.log(`👤 Found user ID: ${userId} for phone: ${userPhone}`);

      // Send the campaign notification message using database setup
      response = await SessionMessageService.sendCampaignNotificationMessage(
        userId,
        "All contacts from your dashboard have been selected. Here are your available templates:"
      );

      if (response) {
        console.log(`✅ Campaign notification sent to user ${userId} (${userPhone}) for command: "${messageText}"`);
        this.markSessionMessageSent(userPhone, 'campaign_command');
      } else {
        console.warn(`❌ Failed to send campaign notification to user ${userId} (${userPhone}) for event ${event.id}`);
      }

    } catch (error) {
      console.error(`Error handling incoming message event ${event.id}:`, error);
    }
  }

  /**
   * Handle user interaction event (like message read)
   */
  private static async handleUserInteractionEvent(event: WebhookEvent): Promise<void> {
    try {
      // Extract user phone number from webhook data
      const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
      
      if (!userPhone) {
        console.warn(`Could not extract user phone from interaction event ${event.id}`);
        return;
      }

      // Find user by phone number
      const userId = await SessionMessageService.findUserByPhoneNumber(userPhone);
      
      if (!userId) {
        console.warn(`Could not find user for phone number ${userPhone} in event ${event.id}`);
        return;
      }

      // Send a response message to the user
      const response = await SessionMessageService.sendCampaignNotificationMessage(
        userId,
        "Thank you for your message! How can I help you today?"
      );

      if (response) {
        console.log(`✅ Response message sent to user ${userId} (${userPhone}) for event ${event.id}`);
      } else {
        console.warn(`❌ Failed to send response message to user ${userId} (${userPhone}) for event ${event.id}`);
      }

    } catch (error) {
      console.error(`Error handling user interaction event ${event.id}:`, error);
    }
  }

  /**
   * Extract user ID from webhook event
   */
  private static extractUserIdFromEvent(event: WebhookEvent): number | null {
    try {
      // Try to extract from headers (if user info is passed in headers)
      if (event.headers?.authorization) {
        // You might need to decode JWT token here if user info is in the token
        // For now, we'll try to get it from the request body
      }

      // Try to extract from request body
      if (event.body_data) {
        const bodyData = typeof event.body_data === 'string' 
          ? JSON.parse(event.body_data) 
          : event.body_data;

        // Look for user_id in the body
        if (bodyData.user_id) {
          return parseInt(bodyData.user_id);
        }

        // Look for user info in nested objects
        if (bodyData.user?.id) {
          return parseInt(bodyData.user.id);
        }
      }

      return null;
    } catch (error) {
      console.error('Error extracting user ID from event:', error);
      return null;
    }
  }

  /**
   * Extract user ID from JWT token in headers
   */
  private static extractUserIdFromToken(authHeader: string): number | null {
    try {
      // Simple JWT decode (in production, use a proper JWT library)
      const token = authHeader.replace('Bearer ', '');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return payload.userId || payload.id || null;
    } catch (error) {
      console.error('Error extracting user ID from token:', error);
      return null;
    }
  }

  /**
   * Get user ID from webhook event using multiple methods
   */
  private static async getUserIdFromEvent(event: WebhookEvent): Promise<number | null> {
    // Method 1: Try to extract from request body
    let userId = this.extractUserIdFromEvent(event);
    if (userId) return userId;

    // Method 2: Try to extract from JWT token in headers
    if (event.headers?.authorization) {
      userId = this.extractUserIdFromToken(event.headers.authorization);
      if (userId) return userId;
    }

    // Method 3: Try to find user by phone number from webhook data
    const userPhone = SessionMessageService.extractUserPhoneFromWebhook(event.body_data);
    if (userPhone) {
      userId = await SessionMessageService.findUserByPhoneNumber(userPhone);
      if (userId) return userId;
    }

    // Method 4: For campaign creation events, try to get the most recent user who created a campaign
    if (this.isCampaignCreationEvent(event)) {
      try {
        const query = `
          SELECT user_id FROM campaigns 
          WHERE created_at >= NOW() - INTERVAL '5 minutes'
          ORDER BY created_at DESC 
          LIMIT 1
        `;
        const result = await pool.query(query);
        if (result.rows.length > 0) {
          return result.rows[0].user_id;
        }
      } catch (error) {
        console.error('Error getting recent campaign user:', error);
      }
    }

    return null;
  }

  /**
   * Get current status of the listener
   */
  static getStatus(): { isListening: boolean; lastProcessedId: number } {
    return {
      isListening: this.isListening,
      lastProcessedId: this.lastProcessedId
    };
  }
}
