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
        InteraktHeaders: {
          type: "apiKey",
          in: "header",
          name: "x-access-token",
          description: "Interakt Access Token",
        },
      },
    },
  },
  apis: [
    // For development: scan TypeScript files
    // For production: scan compiled JavaScript files
    ...(process.env.NODE_ENV === 'development' ? [
      path.join(__dirname, "../routes/*.ts"),
      path.join(__dirname, "../routes/**/*.ts")
    ] : [
      path.join(__dirname, "../routes/*.js"),
      path.join(__dirname, "../routes/**/*.js")
    ])
  ],
};

// Add debugging to see what files are being scanned
console.log("🔍 Swagger Configuration:");
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   __dirname: ${__dirname}`);
console.log(`   Scanning paths:`, options.apis);
console.log(`   File extensions: ${process.env.NODE_ENV === 'development' ? '.ts' : '.js'}`);

export const swaggerSpec = swaggerJSDoc(options);

// Debug: Log the generated spec
console.log("Generated Swagger spec paths:", Object.keys((swaggerSpec as any).paths || {}));
console.log("Total endpoints found:", Object.keys((swaggerSpec as any).paths || {}).length);

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
    "/api/interakt/webhook": {
      get: {
        tags: ["Webhook"],
        summary: "Webhook Verification",
        description: "Facebook webhook verification endpoint",
        parameters: [
          {
            in: "query",
            name: "hub.challenge",
            schema: { type: "string" },
            description: "Challenge string to verify webhook"
          }
        ],
        responses: {
          200: {
            description: "Webhook verified successfully",
            content: {
              "text/plain": {
                schema: { type: "string" }
              }
            }
          }
        }
      },
      post: {
        tags: ["Webhook"],
        summary: "Webhook Message Updates",
        description: "Receives message status updates and incoming messages from Facebook",
        responses: {
          200: {
            description: "Webhook received successfully"
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
        description: "Retrieve a list of all contacts",
        responses: {
          200: {
            description: "List of contacts retrieved successfully"
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
    }
  };
  
  console.log("✅ Manual spec created with", Object.keys((swaggerSpec as any).paths).length, "endpoints");
}


