import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import interaktRoutes from "./routes/interaktRoutes";
import contactRoutes from "./routes/contactRoutes";
import campaignRoutes from "./routes/campaignRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { numericPort, env } from "./config/env";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/spec";
import { initDatabase } from "./config/database";

const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
});

app.use("/api/interakt", interaktRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/campaigns", campaignRoutes);

// Swagger docs
app.get("/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    app.listen(numericPort, () => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://localhost:${numericPort}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();


