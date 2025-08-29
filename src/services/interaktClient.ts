import axios, { AxiosInstance } from "axios";
import { env } from "../config/env";

export type InteraktClientDeps = {
  baseURL?: string;
  wabaId?: string;
  accessToken?: string;
};

export class InteraktClient {
  private http: AxiosInstance;
  private wabaId?: string;
  private interaktHttp: AxiosInstance;
  private graphHttp: AxiosInstance;

  constructor({ baseURL, wabaId, accessToken }: InteraktClientDeps = {}) {
    this.wabaId = wabaId ?? env.INTERAKT_WABA_ID;
    
    // Use Facebook Graph API for WhatsApp actions
    const apiBaseURL = baseURL ?? env.FACEBOOK_GRAPH_API_BASE_URL;
    //const apiBaseURL = baseURL ?? env.INTERAKT_AMPED_EXPRESS_BASE_URL;
    
    const http = axios.create({
      baseURL: apiBaseURL,
      timeout: 15_000,
    });

    http.interceptors.request.use((config) => {
      const token = accessToken ?? env.INTERAKT_ACCESS_TOKEN;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers["Authorization"] = `Bearer ${token}`;
      }
      config.headers = config.headers ?? {};
      config.headers["Content-Type"] = "application/json";
      return config;
    });

    this.http = http;

    // Facebook Graph API client without default auth; per-call tokens will be provided
    this.graphHttp = axios.create({
      baseURL: env.FACEBOOK_GRAPH_API_BASE_URL,
      timeout: 15_000,
    });

    // Separate client for Interakt public API calls (e.g., TP signup)
    const interakt = axios.create({
      baseURL: env.INTERAKT_API_BASE_URL || "https://api.interakt.ai",
      timeout: 15_000,
    });

    interakt.interceptors.request.use((config) => {
      const token = accessToken ?? env.INTERAKT_ACCESS_TOKEN;
      if (token) {
        config.headers = config.headers ?? {};
        // Interakt docs show raw token in Authorization header (no Bearer)
        config.headers["Authorization"] = token;
      }
      config.headers = config.headers ?? {};
      config.headers["Content-Type"] = "application/json";
      return config;
    });

    this.interaktHttp = interakt;
  }

  async getPhoneNumbers(params?: { sort?: "asc" | "desc" }) {
    if (!this.wabaId) {
      // Force an error to trigger fallback upstream
      throw new Error("Missing INTERAKT_WABA_ID");
    }
    // Facebook Graph API endpoint for phone numbers
    const url = `/${this.wabaId}/phone_numbers`;
    const res = await this.http.get(url, { params });
    return res.data;
  }

  async createTextTemplate(body: {
    name: string;
    language: string;
    category: "AUTHENTICATION" | "MARKETING" | "UTILITY";
    components: unknown[];
    auto_category?: boolean;
  }) {
    const wabaId = this.wabaId;
    if (!wabaId) throw new Error("Missing INTERAKT_WABA_ID");
    // Facebook Graph API endpoint for templates
    const url = `/${wabaId}/message_templates`;
    const res = await this.http.post(url, body);
    return res.data;
  }

  async getTemplates(params?: { fields?: string; limit?: number }) {
    const wabaId = this.wabaId;
    if (!wabaId) throw new Error("Missing INTERAKT_WABA_ID");
    // Facebook Graph API endpoint for templates
    const url = `/${wabaId}/message_templates`;
    const res = await this.http.get(url, { params });
    return res.data;
  }

  async getTemplateById(templateId: string) {
    const wabaId = this.wabaId;
    if (!wabaId) throw new Error("Missing INTERAKT_WABA_ID");
    // Facebook Graph API endpoint for specific template
    const url = `/${wabaId}/message_templates/${templateId}`;
    const res = await this.http.get(url);
    return res.data;
  }

  async getContacts(params?: { limit?: number; after?: string }) {
    // Facebook Graph API doesn't have a direct contacts endpoint like Interakt
    // This would need to be implemented differently for Facebook
    throw new Error("Contacts endpoint not available in Facebook Graph API");
  }

  async sendMediaTemplate(body: any) {
    const phoneNumId = env.INTERAKT_PHONE_NUMBER_ID;
    if (!phoneNumId) throw new Error("Missing INTERAKT_PHONE_NUMBER_ID");
    // Facebook Graph API endpoint for sending messages
    const url = `/${phoneNumId}/messages`;
    const res = await this.http.post(url, body);
    return res.data;
  }

  async sendSessionMessage(body: {
    messaging_product: "whatsapp";
    recipient_type?: "individual";
    to: string;
    type: "text" | "image" | "video" | "audio" | "document" | "location" | "contact" | "sticker" | "reaction" | "interactive";
    text?: { 
      body: string; 
      preview_url?: boolean; 
    };
    image?: { link: string; caption?: string };
    video?: { link: string; caption?: string };
    audio?: { link: string };
    document?: { link: string; caption?: string; filename?: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contact?: { contacts: Array<{ name: { first_name: string; last_name?: string }; phones: Array<{ phone: string; type?: string }> }> };
    sticker?: { link: string };
    reaction?: { message_id: string; emoji: string };
    interactive?: any; // Interactive messages can be complex, using any for now
  }) {
    const phoneNumId = env.INTERAKT_PHONE_NUMBER_ID;
    if (!phoneNumId) throw new Error("Missing INTERAKT_PHONE_NUMBER_ID");
    // Facebook Graph API endpoint for sending messages
    const url = `/${phoneNumId}/messages`;
    const res = await this.http.post(url, body);
    return res.data;
  }

  async sendTestTemplate(body: {
    messaging_product: "whatsapp";
    to: string;
    type: "template";
    template: {
      name: string;
      language: {
        code: string;
      };
    };
  }) {
    const phoneNumId = env.INTERAKT_PHONE_NUMBER_ID;
    if (!phoneNumId) throw new Error("Missing INTERAKT_PHONE_NUMBER_ID");
    
    // Use Facebook Graph API format as shown in sir's curl command
    const url = `/${phoneNumId}/messages`;
    const res = await this.http.post(url, body);
    return res.data;
  }

  // NEW: Message Analytics API
  async getMessageAnalytics(params: {
    start?: number; // Unix timestamp
    end?: number;   // Unix timestamp
    granularity?: "DAY" | "MONTH" | "YEAR";
    fields?: string;
  }) {
    const wabaId = this.wabaId;
    if (!wabaId) throw new Error("Missing INTERAKT_WABA_ID");

    // Build the analytics query string
    let fields = params.fields || "analytics";
    
    if (params.start && params.end) {
      fields += `.start(${params.start}).end(${params.end})`;
    }
    
    if (params.granularity) {
      fields += `.granularity(${params.granularity})`;
    }

    // Use Interakt Amped Express API for analytics
    const analyticsHttp = axios.create({
      baseURL: env.INTERAKT_AMPED_EXPRESS_BASE_URL,
      timeout: 15_000,
    });

    analyticsHttp.interceptors.request.use((config) => {
      const token = env.INTERAKT_ACCESS_TOKEN;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers["x-access-token"] = token;
        config.headers["x-waba-id"] = wabaId;
      }
      config.headers = config.headers ?? {};
      config.headers["Content-Type"] = "application/json";
      return config;
    });

    const url = `/${wabaId}`;
    const res = await analyticsHttp.get(url, { 
      params: { fields } 
    });
    return res.data;
  }

  /**
   * Interakt Tech Partner signup call
   * Docs: POST /v1/organizations/tp-signup/
   */
  async techPartnerSignup(payload: {
    waba_id: string;
    solution_id?: string;
    phone_number?: string;
    authorizationTokenOverride?: string; // optional runtime token
  }) {
    const body: any = {
      entry: [
        {
          changes: [
            {
              value: {
                event: "PARTNER_ADDED",
                waba_info: {
                  waba_id: payload.waba_id,
                },
              },
            },
          ],
        },
      ],
      object: "tech_partner",
    };

    if (payload.solution_id) {
      body.entry[0].changes[0].value.waba_info.solution_id = payload.solution_id;
    }
    if (payload.phone_number) {
      body.entry[0].changes[0].value.waba_info.phone_number = payload.phone_number;
    }

    const headersOverride = payload.authorizationTokenOverride
      ? { Authorization: payload.authorizationTokenOverride }
      : undefined;

    const res = await this.interaktHttp.post(
      "/v1/organizations/tp-signup/",
      body,
      headersOverride ? { headers: headersOverride } : undefined
    );
    return res.data;
  }

  // Exchange Embedded Signup code for business token
  async exchangeCodeForBusinessToken(params: { appId: string; appSecret: string; code: string; graphVersion?: string }) {
    const version = params.graphVersion || env.FACEBOOK_API_VERSION || 'v18.0';
    const url = `/${version}/oauth/access_token`;
    const res = await this.graphHttp.get(url, {
      params: {
        client_id: params.appId,
        client_secret: params.appSecret,
        code: params.code,
      },
    });
    return res.data; // expected to include access_token
  }

  // Subscribe app to customer's WABA webhooks
  async subscribeAppToWaba(params: { wabaId: string; businessToken: string; graphVersion?: string }) {
    const version = params.graphVersion || env.FACEBOOK_API_VERSION || 'v18.0';
    const url = `/${version}/${params.wabaId}/subscribed_apps`;
    const res = await this.graphHttp.post(url, {}, {
      headers: { Authorization: `Bearer ${params.businessToken}` },
    });
    return res.data;
  }

  // Register customer's phone number for Cloud API
  async registerBusinessPhoneNumber(params: { phoneNumberId: string; businessToken: string; pin: string; graphVersion?: string }) {
    const version = params.graphVersion || env.FACEBOOK_API_VERSION || 'v18.0';
    const url = `/${version}/${params.phoneNumberId}/register`;
    const body = { messaging_product: 'whatsapp', pin: params.pin } as any;
    const res = await this.graphHttp.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.businessToken}`,
      },
    });
    return res.data;
  }

  // Send a text message using business token and customer's phone number id
  async sendTextMessageWithBusinessToken(params: { phoneNumberId: string; businessToken: string; to: string; body: string; graphVersion?: string }) {
    const version = params.graphVersion || env.FACEBOOK_API_VERSION || 'v18.0';
    const url = `/${version}/${params.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: { body: params.body },
    };
    const res = await this.graphHttp.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.businessToken}`,
      },
    });
    return res.data;
  }
  // Send a template message using business token
  async sendTemplateMessageWithBusinessToken(params: { phoneNumberId: string; businessToken: string; to: string; templateName: string; languageCode: string; graphVersion?: string }) {
    const version = params.graphVersion || env.FACEBOOK_API_VERSION || 'v18.0';
    const url = `/${version}/${params.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode },
      },
    } as any;
    const res = await this.graphHttp.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.businessToken}`,
      },
    });
    return res.data;
  }
}

export const interaktClient = new InteraktClient();


