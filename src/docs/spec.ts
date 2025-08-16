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
    // Use absolute paths to ensure proper file scanning
    path.join(__dirname, "../routes/*.ts"),
    path.join(__dirname, "../routes/**/*.ts")
  ],
};

// Add debugging to see what files are being scanned
console.log("Swagger scanning paths:", options.apis);

export const swaggerSpec = swaggerJSDoc(options);

// Debug: Log the generated spec
console.log("Generated Swagger spec paths:", Object.keys((swaggerSpec as any).paths || {}));
console.log("Total endpoints found:", Object.keys((swaggerSpec as any).paths || {}).length);

// If no endpoints found, create a basic manual spec
if (!(swaggerSpec as any).paths || Object.keys((swaggerSpec as any).paths).length === 0) {
  console.log("No endpoints found by swagger-jsdoc, creating manual spec...");
  
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
    "/webhook": {
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
      }
    }
  };
  
  console.log("Manual spec created with", Object.keys((swaggerSpec as any).paths).length, "endpoints");
}


