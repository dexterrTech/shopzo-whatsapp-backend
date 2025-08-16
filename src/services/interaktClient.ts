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

  constructor({ baseURL, wabaId, accessToken }: InteraktClientDeps = {}) {
    this.wabaId = wabaId ?? env.INTERAKT_WABA_ID;
    
    // Use Facebook Graph API instead of Interakt API
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
}

export const interaktClient = new InteraktClient();


