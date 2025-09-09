import express, { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";
import { env } from "../config/env";
import axios from "axios";

const router = Router();

// POST /api/uploads/start - Start a Graph Resumable Upload session
router.post("/start", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId as number | undefined;
    if (!userId) return res.status(401).json({ error: true, message: "Authentication required" });

    const bodySchema = z.object({
      file_name: z.string().min(1),
      file_length: z.number().int().positive(),
      file_type: z.enum(["application/pdf", "image/jpeg", "image/jpg", "image/png", "video/mp4"]),
      graph_version: z.string().optional(),
      app_id: z.string().optional(),
    });
    const body = bodySchema.parse(req.body);

    // Fetch business token for this user
    const setup = await pool.query(
      "SELECT business_token FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (setup.rows.length === 0 || !setup.rows[0].business_token) {
      return res.status(400).json({ error: true, message: "WhatsApp setup not found or missing business token" });
    }
    const businessToken: string = setup.rows[0].business_token;

    const version = body.graph_version || "v23.0"; // per docs provided
    const appId = body.app_id || env.APP_ID;

    const url = `${env.FACEBOOK_GRAPH_API_BASE_URL}/${version}/${appId}/uploads`;

    const params = new URLSearchParams();
    params.set("file_name", body.file_name);
    params.set("file_length", String(body.file_length));
    params.set("file_type", body.file_type);

    const startRes = await axios.post(url + `?${params.toString()}`, undefined, {
      headers: { Authorization: `OAuth ${businessToken}` },
      timeout: 30000,
    });

    return res.status(200).json(startRes.data);
  } catch (err: any) {
    console.error("Upload start error:", err?.response?.status, err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data || err.message });
  }
});

// POST /api/uploads/:sessionId/chunk - Upload binary chunk (or full file) with file_offset
router.post(
  "/:sessionId/chunk",
  authenticateToken,
  // Use raw body for binary data
  express.raw({ type: () => true, limit: "50mb" }),
  async (req, res) => {
    try {
      const userId = (req as any).user?.userId as number | undefined;
      if (!userId) return res.status(401).json({ error: true, message: "Authentication required" });

      const paramsSchema = z.object({ sessionId: z.string().min(1) });
      const { sessionId } = paramsSchema.parse(req.params);

      const offsetHeader = req.header("file_offset");
      const fileOffset = Number(offsetHeader ?? "0");
      if (!Number.isInteger(fileOffset) || fileOffset < 0) {
        return res.status(400).json({ error: true, message: "Invalid or missing file_offset header" });
      }

      // Fetch business token for this user
      const setup = await pool.query(
        "SELECT business_token FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [userId]
      );
      if (setup.rows.length === 0 || !setup.rows[0].business_token) {
        return res.status(400).json({ error: true, message: "WhatsApp setup not found or missing business token" });
      }
      const businessToken: string = setup.rows[0].business_token;

      const version = req.query["graph_version"] || "v23.0";
      const url = `${env.FACEBOOK_GRAPH_API_BASE_URL}/${version}/upload:${sessionId}`;

      const uploadRes = await axios.post(url, req.body, {
        headers: {
          Authorization: `OAuth ${businessToken}`,
          "file_offset": String(fileOffset),
          // Do not set content-type explicitly so axios uses application/octet-stream
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
      });

      return res.status(200).json(uploadRes.data);
    } catch (err: any) {
      console.error("Upload chunk error:", err?.response?.status, err?.response?.data || err.message);
      return res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data || err.message });
    }
  }
);

// GET /api/uploads/:sessionId/status - Get current file_offset for resume
router.get("/:sessionId/status", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId as number | undefined;
    if (!userId) return res.status(401).json({ error: true, message: "Authentication required" });

    const paramsSchema = z.object({ sessionId: z.string().min(1) });
    const { sessionId } = paramsSchema.parse(req.params);

    // Fetch business token for this user
    const setup = await pool.query(
      "SELECT business_token FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (setup.rows.length === 0 || !setup.rows[0].business_token) {
      return res.status(400).json({ error: true, message: "WhatsApp setup not found or missing business token" });
    }
    const businessToken: string = setup.rows[0].business_token;

    const version = req.query["graph_version"] || "v23.0";
    const url = `${env.FACEBOOK_GRAPH_API_BASE_URL}/${version}/upload:${sessionId}`;

    const statusRes = await axios.get(url, {
      headers: { Authorization: `OAuth ${businessToken}` },
      timeout: 30000,
    });

    return res.status(200).json(statusRes.data);
  } catch (err: any) {
    console.error("Upload status error:", err?.response?.status, err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data || err.message });
  }
});

export default router;




