import swaggerJSDoc from "swagger-jsdoc";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "WhatsApp Dashboard Backend",
      version: "1.0.0",
      description: "Interakt proxy backend with fallback mocks",
    },
    servers: [{ url: "http://localhost:8000" }],
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
    // we'll annotate routes with JSDoc below
    "src/routes/*.ts",
  ],
};

export const swaggerSpec = swaggerJSDoc(options);


