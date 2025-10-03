import { Router } from "express";
import { z } from "zod";
import { ContactService, CreateContactData, UpdateContactData } from "../services/contactService";
import { pool } from "../config/database";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Contacts
 *     description: Contact management and CRM operations
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     Contact:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique identifier for the contact
 *         user_id:
 *           type: integer
 *           description: ID of the user who owns this contact
 *         name:
 *           type: string
 *           description: Contact's full name
 *         email:
 *           type: string
 *           format: email
 *           description: Contact's email address (optional)
 *         whatsapp_number:
 *           type: string
 *           description: WhatsApp number (required, unique per user)
 *         phone:
 *           type: string
 *           description: Alternative phone number
 *         telegram_id:
 *           type: string
 *           description: Telegram username or ID
 *         viber_id:
 *           type: string
 *           description: Viber ID
 *         line_id:
 *           type: string
 *           description: Line ID
 *         instagram_id:
 *           type: string
 *           description: Instagram username or ID
 *         facebook_id:
 *           type: string
 *           description: Facebook ID or username
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: When the contact was created
 *         last_seen_at:
 *           type: string
 *           format: date-time
 *           description: When the contact was last seen
 *       required:
 *         - id
 *         - user_id
 *         - whatsapp_number
 *         - created_at
 *         - last_seen_at
 *     
 *     CreateContactRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *           description: Contact's email address (optional)
 *         whatsapp_number:
 *           type: string
 *         phone:
 *           type: string
 *         telegram_id:
 *           type: string
 *         viber_id:
 *           type: string
 *         line_id:
 *           type: string
 *         instagram_id:
 *           type: string
 *         facebook_id:
 *           type: string
 *       required:
 *         - whatsapp_number
 *     
 *     UpdateContactRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         whatsapp_number:
 *           type: string
 *         phone:
 *           type: string
 *         telegram_id:
 *           type: string
 *         viber_id:
 *           type: string
 *         line_id:
 *           type: string
 *         instagram_id:
 *           type: string
 *         facebook_id:
 *           type: string
 */

/**
 * @openapi
 * /api/contacts:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: Get user's contacts
 *     description: Retrieve a list of contacts belonging to the authenticated user with optional pagination
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *         description: Maximum number of contacts to return
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter contacts by name, email, or phone
 *     responses:
 *       200:
 *         description: List of contacts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Internal server error
 */
router.get("/", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      search: z.string().optional(),
    });

    const query = querySchema.parse(req.query);

    let contacts;
    if (query.search) {
      contacts = await ContactService.searchContacts(query.search, userId, query.limit, query.offset);
    } else {
      contacts = await ContactService.getAllContacts(userId, query.limit, query.offset);
    }

    res.json({ data: contacts });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/export:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: Export user's contacts as CSV
 *     description: Download all contacts belonging to the authenticated user (optionally filtered by search) as CSV
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter contacts by name, email, or phone
 *     responses:
 *       200:
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get("/export", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const querySchema = z.object({ search: z.string().optional() });
    const { search } = querySchema.parse(req.query);

    const contacts = search
      ? await ContactService.searchContacts(search, userId)
      : await ContactService.getAllContacts(userId);

    const headers = [
      'id','name','email','whatsapp_number','phone','telegram_id','viber_id','line_id','instagram_id','facebook_id','created_at','last_seen_at'
    ];
    const rows = contacts.map((c: any) => headers.map((h) => {
      const v = c[h as keyof typeof c];
      const s = v === null || v === undefined ? '' : String(v);
      // Escape CSV
      const needsQuotes = s.includes(',') || s.includes('\n') || s.includes('"');
      const escaped = s.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    }).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   get:
 *     tags:
 *       - Contacts
 *     summary: Get contact by ID
 *     description: Retrieve a specific contact by their ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Contact retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       404:
 *         description: Contact not found
 *       500:
 *         description: Internal server error
 */
router.get("/:id", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid contact ID" });
    }

    const contact = await ContactService.getContactById(id, userId);
    
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json(contact);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts:
 *   post:
 *     tags:
 *       - Contacts
 *     summary: Create a new contact
 *     description: Create a new contact with the provided information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateContactRequest'
 *     responses:
 *       201:
 *         description: Contact created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Invalid request data
 *       409:
 *         description: Contact with this WhatsApp number already exists
 *       500:
 *         description: Internal server error
 */
router.post("/", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const bodySchema = z.object({
      name: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")).transform(val => val === "" ? undefined : val),
      whatsapp_number: z.string().min(1),
      phone: z.string().optional(),
      telegram_id: z.string().optional(),
      viber_id: z.string().optional(),
      line_id: z.string().optional(),
      instagram_id: z.string().optional(),
      facebook_id: z.string().optional(),
    });

    const body = bodySchema.parse(req.body);

    // Check if contact with this WhatsApp number already exists for this user
    const existingContact = await ContactService.getContactByWhatsAppNumber(body.whatsapp_number, userId);
    if (existingContact) {
      return res.status(409).json({ 
        error: "Contact with this WhatsApp number already exists" 
      });
    }

    const contact = await ContactService.createContact({ ...body, user_id: userId });
    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   put:
 *     tags:
 *       - Contacts
 *     summary: Update a contact
 *     description: Update an existing contact's information
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateContactRequest'
 *     responses:
 *       200:
 *         description: Contact updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Contact not found
 *       409:
 *         description: Contact with this WhatsApp number already exists
 *       500:
 *         description: Internal server error
 */
router.put("/:id", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid contact ID" });
    }

    const bodySchema = z.object({
      name: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")).transform(val => val === "" ? undefined : val),
      whatsapp_number: z.string().min(1).optional(),
      phone: z.string().optional(),
      telegram_id: z.string().optional(),
      viber_id: z.string().optional(),
      line_id: z.string().optional(),
      instagram_id: z.string().optional(),
      facebook_id: z.string().optional(),
    });

    const body = bodySchema.parse(req.body);

    // If updating WhatsApp number, check for conflicts
    if (body.whatsapp_number) {
      const existingContact = await ContactService.getContactByWhatsAppNumber(body.whatsapp_number, userId);
      if (existingContact && existingContact.id !== id) {
        return res.status(409).json({ 
          error: "Contact with this WhatsApp number already exists" 
        });
      }
    }

    const contact = await ContactService.updateContact(id, userId, body);
    
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json(contact);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   delete:
 *     tags:
 *       - Contacts
 *     summary: Delete a contact
 *     description: Delete an existing contact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Contact deleted successfully
 *       404:
 *         description: Contact not found
 *       500:
 *         description: Internal server error
 */
router.delete("/:id", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid contact ID" });
    }

    const deleted = await ContactService.deleteContact(id, userId);
    
    if (!deleted) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json({ message: "Contact deleted successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/import:
 *   post:
 *     tags:
 *       - Contacts
 *     summary: Import multiple contacts (JSON array)
 *     description: Accepts an array of contacts to insert/update in bulk. Use upsert=true to update existing contacts that match by whatsapp_number.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contacts]
 *             properties:
 *               upsert:
 *                 type: boolean
 *                 default: true
 *               dedupe:
 *                 type: boolean
 *                 default: true
 *               contacts:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/CreateContactRequest'
 *     responses:
 *       200:
 *         description: Import summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     inserted:
 *                       type: integer
 *                     updated:
 *                       type: integer
 *                     skipped_duplicate_rows:
 *                       type: integer
 */
router.post("/import", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const bodySchema = z.object({
      upsert: z.boolean().optional().default(true),
      dedupe: z.boolean().optional().default(true),
      contacts: z.array(
        z.object({
          name: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")).transform(val => val === "" ? undefined : val),
          whatsapp_number: z.string().min(1),
          phone: z.string().optional(),
          telegram_id: z.string().optional(),
          viber_id: z.string().optional(),
          line_id: z.string().optional(),
          instagram_id: z.string().optional(),
          facebook_id: z.string().optional(),
        })
      ).min(1)
    });

    const { upsert, dedupe, contacts } = bodySchema.parse(req.body);

    // Dedupe within payload by whatsapp_number
    const seen = new Set<string>();
    const filtered = dedupe
      ? contacts.filter((c) => {
          const key = c.whatsapp_number.trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
      : contacts;

    // Preload which numbers already exist for this user for summary purposes
    const numbers = filtered.map((c) => c.whatsapp_number.trim());
    const existingRes = await pool.query(
      `SELECT whatsapp_number FROM contacts WHERE user_id = $1 AND whatsapp_number = ANY($2::text[])`,
      [userId, numbers]
    );
    const existingSet = new Set<string>(existingRes.rows.map((r) => r.whatsapp_number));

    let inserted = 0;
    let updated = 0;

    await pool.query('BEGIN');
    try {
      for (const c of filtered) {
        const params = [
          userId,
          c.name ?? null,
          c.email ?? null,
          c.whatsapp_number.trim(),
          c.phone ?? null,
          c.telegram_id ?? null,
          c.viber_id ?? null,
          c.line_id ?? null,
          c.instagram_id ?? null,
          c.facebook_id ?? null,
        ];

        if (upsert) {
          await pool.query(
            `INSERT INTO contacts (user_id, name, email, whatsapp_number, phone, telegram_id, viber_id, line_id, instagram_id, facebook_id, created_at, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
             ON CONFLICT (user_id, whatsapp_number) DO UPDATE SET
               name = COALESCE(EXCLUDED.name, contacts.name),
               email = COALESCE(EXCLUDED.email, contacts.email),
               phone = COALESCE(EXCLUDED.phone, contacts.phone),
               telegram_id = COALESCE(EXCLUDED.telegram_id, contacts.telegram_id),
               viber_id = COALESCE(EXCLUDED.viber_id, contacts.viber_id),
               line_id = COALESCE(EXCLUDED.line_id, contacts.line_id),
               instagram_id = COALESCE(EXCLUDED.instagram_id, contacts.instagram_id),
               facebook_id = COALESCE(EXCLUDED.facebook_id, contacts.facebook_id)`,
            params
          );
          if (existingSet.has(c.whatsapp_number.trim())) {
            updated++;
          } else {
            inserted++;
          }
        } else {
          // Insert only; ignore duplicates
          const result = await pool.query(
            `INSERT INTO contacts (user_id, name, email, whatsapp_number, phone, telegram_id, viber_id, line_id, instagram_id, facebook_id, created_at, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
             ON CONFLICT (user_id, whatsapp_number) DO NOTHING`,
            params
          );
          if (result.rowCount && result.rowCount > 0) {
            inserted++;
          }
        }
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    const summary = {
      total: contacts.length,
      inserted,
      updated,
      skipped_duplicate_rows: contacts.length - filtered.length,
    };

    res.json({ success: true, message: 'Import completed', summary });
  } catch (err) {
    next(err);
  }
});

export default router;
