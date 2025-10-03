import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";

const router = Router();

const payloadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  mobile_no: z.string().optional(),
  gst_required: z.boolean().optional(),
  gst_number: z.string().optional(),
  business_contact_name: z.string().optional(),
  business_contact_phone: z.string().optional(),
  business_address: z.string().optional(),
  user_id: z.number().int().optional(),
});

// POST /api/provision/business
// Looks up the user's hashed password and forwards the payload to the external provision API
router.post("/business", authenticateToken, async (req, res) => {
  try {
    const body = payloadSchema.parse(req.body || {});

    // Only allow the designated aggregator account to trigger provisioning
    const callerEmail = (req as any).user?.email;
    if (callerEmail !== "aggregator@shopzo.app") {
      return res.status(403).json({ success: false, message: "Provisioning not allowed for this account" });
    }

    // Find the created user's hashed password (by id or email)
    let passwordHash: string | null = null;
    if (body.user_id) {
      let r;
      try {
        r = await pool.query('SELECT password_hash FROM users_whatsapp WHERE id = $1 LIMIT 1', [body.user_id]);
      } catch (e: any) {
        console.error('[Provision] DB lookup by user_id failed:', e?.message || e);
        return res.status(500).json({ success: false, message: 'Database error while fetching password hash (by id)' });
      }
      passwordHash = r.rows[0]?.password_hash || null;
    }
    if (!passwordHash) {
      let r2;
      try {
        r2 = await pool.query('SELECT password_hash FROM users_whatsapp WHERE email = $1 LIMIT 1', [body.email]);
      } catch (e: any) {
        console.error('[Provision] DB lookup by email failed:', e?.message || e);
        return res.status(500).json({ success: false, message: 'Database error while fetching password hash (by email)' });
      }
      passwordHash = r2.rows[0]?.password_hash || null;
    }

    if (!passwordHash) {
      console.warn('[Provision] Password hash not found for email:', body.email, 'user_id:', body.user_id);
      return res.status(404).json({ success: false, message: "User password hash not found" });
    }

    // Build external payload including hashed password
    const externalPayload: any = {
      name: body.name,
      email: body.email,
      mobile_no: body.mobile_no,
      gst_required: body.gst_required,
      gst_number: body.gst_number,
      business_contact_name: body.business_contact_name,
      business_contact_phone: body.business_contact_phone,
      business_address: body.business_address,
      password: passwordHash,
    };

    const url = 'https://api-dashboard.shopzo.app/api/business/provision/';
    const headers: Record<string, string> = {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Exchange-Credentials-Secret': 'Dexterr@2492025',
    };

    let upstream: any;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(externalPayload),
      });
    } catch (e: any) {
      console.error('[Provision] Upstream request failed:', e?.message || e);
      return res.status(502).json({ success: false, message: 'Failed to reach external provision API' });
    }

    const text = await upstream.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstream.ok) {
      console.error('[Provision] Upstream error', upstream.status, data);
      return res.status(upstream.status).json({ success: false, message: 'External API error', details: data });
    }
    return res.status(201).json(data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    console.error('Provision proxy error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error', error: error?.message });
  }
});

export default router;




