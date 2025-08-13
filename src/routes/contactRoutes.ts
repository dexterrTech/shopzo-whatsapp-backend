import { Router } from "express";
import { z } from "zod";
import { ContactService, CreateContactData, UpdateContactData } from "../services/contactService";

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
 *         name:
 *           type: string
 *           description: Contact's full name
 *         email:
 *           type: string
 *           format: email
 *           description: Contact's email address
 *         whatsapp_number:
 *           type: string
 *           description: WhatsApp number (required, unique)
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
 *     summary: Get all contacts
 *     description: Retrieve a list of all contacts with optional pagination
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
router.get("/", async (req, res, next) => {
  try {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      search: z.string().optional(),
    });

    const query = querySchema.parse(req.query);

    let contacts;
    if (query.search) {
      contacts = await ContactService.searchContacts(query.search, query.limit);
    } else {
      contacts = await ContactService.getAllContacts(query.limit);
    }

    res.json({ data: contacts });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   get:
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
router.get("/:id", async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.coerce.number().int().positive(),
    });

    const params = paramsSchema.parse(req.params);
    const contact = await ContactService.getContactById(params.id);

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
router.post("/", async (req, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      whatsapp_number: z.string().min(1),
      phone: z.string().optional(),
      telegram_id: z.string().optional(),
      viber_id: z.string().optional(),
      line_id: z.string().optional(),
      instagram_id: z.string().optional(),
      facebook_id: z.string().optional(),
    });

    const body = bodySchema.parse(req.body);

    // Check if contact with this WhatsApp number already exists
    const existingContact = await ContactService.getContactByWhatsAppNumber(body.whatsapp_number);
    if (existingContact) {
      return res.status(409).json({ 
        error: "Contact with this WhatsApp number already exists" 
      });
    }

    const contact = await ContactService.createContact(body);
    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   put:
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
router.put("/:id", async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.coerce.number().int().positive(),
    });

    const bodySchema = z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      whatsapp_number: z.string().min(1).optional(),
      phone: z.string().optional(),
      telegram_id: z.string().optional(),
      viber_id: z.string().optional(),
      line_id: z.string().optional(),
      instagram_id: z.string().optional(),
      facebook_id: z.string().optional(),
    });

    const params = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body);

    // Check if contact exists
    const existingContact = await ContactService.getContactById(params.id);
    if (!existingContact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // If updating WhatsApp number, check if it's already taken by another contact
    if (body.whatsapp_number && body.whatsapp_number !== existingContact.whatsapp_number) {
      const contactWithNumber = await ContactService.getContactByWhatsAppNumber(body.whatsapp_number);
      if (contactWithNumber && contactWithNumber.id !== params.id) {
        return res.status(409).json({ 
          error: "Contact with this WhatsApp number already exists" 
        });
      }
    }

    const contact = await ContactService.updateContact({ id: params.id, ...body });
    res.json(contact);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/contacts/{id}:
 *   delete:
 *     summary: Delete a contact
 *     description: Delete a contact by their ID
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Contact deleted successfully"
 *       404:
 *         description: Contact not found
 *       500:
 *         description: Internal server error
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.coerce.number().int().positive(),
    });

    const params = paramsSchema.parse(req.params);
    const deleted = await ContactService.deleteContact(params.id);

    if (!deleted) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json({ message: "Contact deleted successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
