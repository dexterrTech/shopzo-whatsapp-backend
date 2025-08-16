import swaggerJSDoc from "swagger-jsdoc";
import { env } from "../config/env";
import path from "path";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "WhatsApp Dashboard API",
      version: "1.0.0",
      description: "API for WhatsApp Dashboard with Interakt integration new",
    },
    servers: [{ url: `http://localhost:${env.PORT || 8080}` }],
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


