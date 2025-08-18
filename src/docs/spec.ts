import swaggerJSDoc from "swagger-jsdoc";
import { env } from "../config/env";
import path from "path";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "WhatsApp Dashboard API",
      version: "1.0.0",
      description: "API for WhatsApp Dashboard with Interakt integration new ",
    },
    servers: [
      { 
        url: `http://localhost:${env.PORT || 8000}`,
        description: 'Local Development'
      },
      {
        url: 'https://whatsapp-backend-315431551371.europe-west1.run.app',
        description: 'Production Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token for authentication"
        },
        InteraktHeaders: {
          type: "apiKey",
          in: "header",
          name: "x-access-token",
          description: "Interakt Access Token",
        },
      },
      schemas: {
        Contact: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              description: "Unique identifier for the contact"
            },
            name: {
              type: "string",
              description: "Contact's full name"
            },
            email: {
              type: "string",
              format: "email",
              description: "Contact's email address"
            },
            whatsapp_number: {
              type: "string",
              description: "WhatsApp number (required, unique)"
            },
            phone: {
              type: "string",
              description: "Alternative phone number"
            },
            telegram_id: {
              type: "string",
              description: "Telegram username or ID"
            },
            viber_id: {
              type: "string",
              description: "Viber ID"
            },
            line_id: {
              type: "string",
              description: "Line ID"
            },
            instagram_id: {
              type: "string",
              description: "Instagram username or ID"
            },
            facebook_id: {
              type: "string",
              description: "Facebook ID or username"
            },
            created_at: {
              type: "string",
              format: "date-time",
              description: "When the contact was created"
            },
            last_seen_at: {
              type: "string",
              format: "date-time",
              description: "When the contact was last seen"
            }
          },
          required: ["id", "whatsapp_number", "created_at", "last_seen_at"]
        },
        CreateContactRequest: {
          type: "object",
          properties: {
            name: {
              type: "string"
            },
            email: {
              type: "string",
              format: "email"
            },
            whatsapp_number: {
              type: "string"
            },
            phone: {
              type: "string"
            },
            telegram_id: {
              type: "string"
            },
            viber_id: {
              type: "string"
            },
            line_id: {
              type: "string"
            },
            instagram_id: {
              type: "string"
            },
            facebook_id: {
              type: "string"
            }
          },
          required: ["whatsapp_number"]
        },
        UpdateContactRequest: {
          type: "object",
          properties: {
            name: {
              type: "string"
            },
            email: {
              type: "string",
              format: "email"
            },
            whatsapp_number: {
              type: "string"
            },
            phone: {
              type: "string"
            },
            telegram_id: {
              type: "string"
            },
            viber_id: {
              type: "string"
            },
            line_id: {
              type: "string"
            },
            instagram_id: {
              type: "string"
            },
            facebook_id: {
              type: "string"
            }
          }
        }
      }
    },
  },
  apis: [
    // Try to scan both TypeScript and JavaScript files
    // This ensures compatibility in both development and production
    path.join(__dirname, "../routes/*.ts"),
    path.join(__dirname, "../routes/**/*.ts"),
    path.join(__dirname, "../routes/*.js"),
    path.join(__dirname, "../routes/**/*.js")
  ],
};

// Add debugging to see what files are being scanned
console.log("🔍 Swagger Configuration:");
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   __dirname: ${__dirname}`);
console.log(`   Scanning paths:`, options.apis);
console.log(`   Will scan both .ts and .js files for maximum compatibility`);

export const swaggerSpec = swaggerJSDoc(options);

// Debug: Log the generated spec
console.log("📊 Swagger Generation Results:");
console.log("   Generated spec paths:", Object.keys((swaggerSpec as any).paths || {}));
console.log("   Total endpoints found:", Object.keys((swaggerSpec as any).paths || {}).length);

// Check if swagger-jsdoc found any endpoints
if (!(swaggerSpec as any).paths || Object.keys((swaggerSpec as any).paths).length === 0) {
  console.log("❌ swagger-jsdoc found NO endpoints - this indicates a scanning issue");
  console.log("   This usually means:");
  console.log("   1. File paths are incorrect");
  console.log("   2. Files don't contain proper OpenAPI documentation");
  console.log("   3. Environment mismatch between dev and production");
} else {
  console.log("✅ swagger-jsdoc successfully scanned and found endpoints");
}

// If no endpoints found, create a comprehensive manual spec
if (!(swaggerSpec as any).paths || Object.keys((swaggerSpec as any).paths).length === 0) {
  console.log("⚠️  No endpoints found by swagger-jsdoc, creating comprehensive manual spec...");
  
  (swaggerSpec as any).paths = {
    "/api/test": {
      get: {
        tags: ["Test"],
        summary: "Test API Endpoint",
        description: "Simple test endpoint to verify API is working",
        responses: {
          200: {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    timestamp: { type: "string" },
                    routes: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/interaktWebhook": {
      get: {
        tags: ["Webhook"],
        summary: "Webhook Verification",
        description: "Facebook webhook verification endpoint. Returns hub.challenge parameter for verification. This matches the documentation requirements for Meta webhook setup.",
        parameters: [
          {
            in: "query",
            name: "hub.mode",
            schema: { type: "string" },
            description: "Webhook mode (usually 'subscribe')",
            example: "subscribe"
          },
          {
            in: "query",
            name: "hub.verify_token",
            schema: { type: "string" },
            description: "Webhook verification token from environment variables",
            example: "YOUR_VERIFY_TOKEN"
          },
          {
            in: "query",
            name: "hub.challenge",
            schema: { type: "string" },
            description: "Challenge string to verify webhook. Must be returned as response.",
            example: "123456",
            required: true
          }
        ],
        responses: {
          200: {
            description: "Webhook verified successfully - returns the hub.challenge value",
            content: {
              "text/plain": {
                schema: { type: "string" },
                example: "123456"
              }
            }
          },
          403: {
            description: "Webhook verification failed - invalid token or mode",
            content: {
              "text/plain": {
                schema: { type: "string" },
                example: "Forbidden"
              }
            }
          }
        }
      },
      post: {
        tags: ["Webhook"],
        summary: "Webhook Message Updates",
        description: "Receives message status updates and incoming messages from Facebook. Handles both WhatsApp Business Account events and Tech Partner events (PARTNER_ADDED).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  object: {
                    type: "string",
                    enum: ["whatsapp_business_account", "tech_partner"],
                    description: "Type of webhook object"
                  },
                  entry: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        changes: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              value: {
                                type: "object",
                                properties: {
                                  event: {
                                    type: "string",
                                    description: "Event type (e.g., PARTNER_ADDED)"
                                  },
                                  waba_info: {
                                    type: "object",
                                    properties: {
                                      waba_id: { type: "string" },
                                      solution_id: { type: "string" }
                                    }
                                  },
                                  messages: {
                                    type: "array",
                                    description: "Incoming messages"
                                  },
                                  statuses: {
                                    type: "array",
                                    description: "Message status updates"
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              examples: {
                "Tech Partner Event": {
                  value: {
                    object: "tech_partner",
                    entry: [{
                      changes: [{
                        value: {
                          event: "PARTNER_ADDED",
                          waba_info: {
                            waba_id: "123456789",
                            solution_id: "solution_123"
                          }
                        }
                      }]
                    }]
                  }
                },
                "WhatsApp Message": {
                  value: {
                    object: "whatsapp_business_account",
                    entry: [{
                      changes: [{
                        value: {
                          messages: [{
                            from: "1234567890",
                            text: { body: "Hello" }
                          }]
                        }
                      }]
                    }]
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "Webhook received and processed successfully"
          },
          500: {
            description: "Error processing webhook"
          }
        }
      }
    },
    "/api/interakt/phone-numbers": {
      get: {
        tags: ["Phone Numbers"],
        summary: "Get Phone Numbers",
        description: "Returns Interakt phone numbers",
        responses: {
          200: {
            description: "List of phone numbers"
          }
        }
      }
    },
    "/api/interakt/templates": {
      get: {
        tags: ["Templates"],
        summary: "Get All Templates",
        description: "Returns WABA message templates",
        responses: {
          200: {
            description: "List of templates"
          }
        }
      }
    },
    "/api/contacts": {
      get: {
        tags: ["Contacts"],
        summary: "Get all contacts",
        description: "Retrieve a list of all contacts with optional pagination",
        parameters: [
          {
            in: "query",
            name: "limit",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 50
            },
            description: "Maximum number of contacts to return"
          },
          {
            in: "query",
            name: "search",
            schema: {
              type: "string"
            },
            description: "Search term to filter contacts by name, email, or phone"
          }
        ],
        responses: {
          200: {
            description: "List of contacts retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/Contact"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Contacts"],
        summary: "Create a new contact",
        description: "Create a new contact with the provided information",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateContactRequest"
              }
            }
          }
        },
        responses: {
          201: {
            description: "Contact created successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Contact"
                }
              }
            }
          }
        }
      }
    },
    "/api/contacts/{id}": {
      get: {
        tags: ["Contacts"],
        summary: "Get contact by ID",
        description: "Retrieve a specific contact by their ID",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: {
              type: "integer"
            },
            description: "Contact ID"
          }
        ],
        responses: {
          200: {
            description: "Contact retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Contact"
                }
              }
            }
          },
          404: {
            description: "Contact not found"
          }
        }
      },
      put: {
        tags: ["Contacts"],
        summary: "Update a contact",
        description: "Update an existing contact's information",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: {
              type: "integer"
            },
            description: "Contact ID"
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdateContactRequest"
              }
            }
          }
        },
        responses: {
          200: {
            description: "Contact updated successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Contact"
                }
              }
            }
          },
          404: {
            description: "Contact not found"
          }
        }
      },
      delete: {
        tags: ["Contacts"],
        summary: "Delete a contact",
        description: "Delete a contact by their ID",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: {
              type: "integer"
            },
            description: "Contact ID"
          }
        ],
        responses: {
          200: {
            description: "Contact deleted successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Contact deleted successfully"
                    }
                  }
                }
              }
            }
          },
          404: {
            description: "Contact not found"
          }
        }
      }
    },
    "/api/campaigns": {
      get: {
        tags: ["Campaigns"],
        summary: "Get all campaigns",
        description: "Retrieve a list of all campaigns",
        responses: {
          200: {
            description: "List of campaigns retrieved successfully"
          }
        }
      }
    },
    "/api/interakt/tech-partner-onboarding": {
      post: {
        tags: ["Webhook"],
        summary: "Tech Partner Onboarding API",
        description: "Handles tech partner onboarding when PARTNER_ADDED event is received from Meta. This endpoint can be called manually if the webhook event is not received within 5-7 minutes.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["entry", "object"],
                properties: {
                  entry: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        changes: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              value: {
                                type: "object",
                                properties: {
                                  event: {
                                    type: "string",
                                    enum: ["PARTNER_ADDED"],
                                    description: "Event type must be PARTNER_ADDED"
                                  },
                                  waba_info: {
                                    type: "object",
                                    properties: {
                                      waba_id: {
                                        type: "string",
                                        description: "WhatsApp Business Account ID"
                                      },
                                      solution_id: {
                                        type: "string",
                                        description: "Solution ID from Meta"
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  object: {
                    type: "string",
                    enum: ["tech_partner"],
                    description: "Object type must be tech_partner"
                  }
                }
              },
              example: {
                entry: [{
                  changes: [{
                    value: {
                      event: "PARTNER_ADDED",
                      waba_info: {
                        waba_id: "123456789",
                        solution_id: "solution_123"
                      }
                    }
                  }]
                }],
                object: "tech_partner"
              }
            }
          }
        },
        responses: {
          200: {
            description: "Onboarding completed successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    event: {
                      type: "string",
                      enum: ["WABA_ONBOARDED"],
                      description: "Event type after successful onboarding"
                    },
                    isv_name_token: {
                      type: "string",
                      description: "ISV name token from Interakt"
                    },
                    waba_id: {
                      type: "string",
                      description: "WhatsApp Business Account ID"
                    },
                    phone_number_id: {
                      type: "string",
                      description: "Phone number ID assigned"
                    },
                    fallback: {
                      type: "boolean",
                      description: "Indicates if fallback data was used"
                    }
                  }
                },
                example: {
                  event: "WABA_ONBOARDED",
                  isv_name_token: "token_123",
                  waba_id: "123456789",
                  phone_number_id: "phone_456",
                  fallback: false
                }
              }
            }
          },
          400: {
            description: "Invalid webhook payload"
          }
        }
      }
    },
    "/api/interakt/webhook-url": {
      post: {
        tags: ["Webhook"],
        summary: "Add/Update Webhook URL",
        description: "Configures the webhook URL for a specific WABA (WhatsApp Business Account) to receive real-time updates from Meta.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["waba_id", "webhook_url", "verify_token"],
                properties: {
                  waba_id: {
                    type: "string",
                    description: "WhatsApp Business Account ID"
                  },
                  webhook_url: {
                    type: "string",
                    format: "uri",
                    description: "Webhook URL to receive updates"
                  },
                  verify_token: {
                    type: "string",
                    description: "Verification token for webhook security"
                  }
                }
              },
              example: {
                waba_id: "123456789",
                webhook_url: "https://yourdomain.com/webhook",
                verify_token: "VERIFY_TOKEN_123"
              }
            }
          }
        },
        responses: {
          200: {
            description: "Webhook URL configured successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: {
                      type: "boolean",
                      description: "Operation success status"
                    },
                    message: {
                      type: "string",
                      description: "Success message"
                    },
                    waba_id: {
                      type: "string",
                      description: "WABA ID that was configured"
                    },
                    webhook_url: {
                      type: "string",
                      description: "Webhook URL that was set"
                    },
                    fallback: {
                      type: "boolean",
                      description: "Indicates if fallback data was used"
                    }
                  }
                },
                example: {
                  success: true,
                  message: "Webhook URL configured successfully",
                  waba_id: "123456789",
                  webhook_url: "https://yourdomain.com/webhook",
                  fallback: false
                }
              }
            }
          }
        }
      }
    }
  };
  
  console.log("✅ Manual spec created with", Object.keys((swaggerSpec as any).paths).length, "endpoints");
}


