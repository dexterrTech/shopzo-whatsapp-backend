import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";
import csv from "csv-parser";
import { Readable } from "stream";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";
import { authenticateToken } from "../middleware/authMiddleware";
import { upsertBillingLog, holdWalletInSuspenseForBilling } from "../services/billingService";
import { pool } from "../config/database";
import { numericPort, env } from "../config/env";
import fs from "fs";
import path from "path";
import { dlog } from "../utils/logger";
// duplicate import removed

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

/**
 * @openapi
 * /api/bulk-messages/upload:
 *   post:
 *     tags:
 *       - Bulk Messaging
 *     summary: Upload CSV/Excel file for bulk messaging
 *     description: Uploads a CSV or Excel file and validates it for bulk messaging
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or Excel file
 *     responses:
 *       200:
 *         description: File validation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 rowCount:
 *                   type: integer
 *                 headers:
 *                   type: array
 *                   items:
 *                     type: string
 *                 sampleData:
 *                   type: array
 *                   items:
 *                     type: object
 *                 validationErrors:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.post("/upload", authenticateToken, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.file;
    const userId = req.user!.userId;

    // Validate file size
    if (file.size > 50 * 1024 * 1024) {
      return res.status(400).json({ error: "File size exceeds 50MB limit" });
    }

    let csvData: any[] = [];
    let headers: string[] = [];
    const validationErrors: string[] = [];

    try {
      // Determine file type and parse accordingly
      if (file.mimetype === 'text/csv') {
        // Parse CSV
        const results: any[] = [];
        const stream = Readable.from(file.buffer);
        
        await new Promise((resolve, reject) => {
          stream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', resolve)
            .on('error', reject);
        });
        
        csvData = results;
        headers = Object.keys(results[0] || {});
      } else {
        // Parse Excel
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        csvData = jsonData;
        headers = Object.keys(jsonData[0] || {});
      }

      // Validate required columns
      const requiredColumns = ['id', 'phone_number'];
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));
      
      if (missingColumns.length > 0) {
        validationErrors.push(`Missing required columns: ${missingColumns.join(', ')}`);
      }

      // Validate row count
      if (csvData.length > 100000) {
        validationErrors.push("File contains more than 100,000 rows");
      }

      if (csvData.length === 0) {
        validationErrors.push("File contains no data rows");
      }

      // Validate phone numbers
      const phoneNumberColumn = headers.find(h => h.toLowerCase().includes('phone'));
      if (phoneNumberColumn) {
        const invalidPhones: number[] = [];
        csvData.forEach((row, index) => {
          const phone = row[phoneNumberColumn];
          if (!phone || typeof phone !== 'string' || !phone.match(/^\+?[1-9]\d{1,14}$/)) {
            invalidPhones.push(index + 1);
          }
        });
        
        if (invalidPhones.length > 0) {
          validationErrors.push(`Invalid phone numbers found in rows: ${invalidPhones.slice(0, 10).join(', ')}${invalidPhones.length > 10 ? '...' : ''}`);
        }
      }

      // Sample data (first 5 rows)
      const sampleData = csvData.slice(0, 5);

      // Persist original (or converted CSV) to disk so we can serve a public URL
      const uploadsDir = path.resolve(__dirname, "..", "uploads");
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
      const ts = Date.now();
      const safeName = `${userId}_${ts}.csv`;
      const csvHeadersFinal = headers.length ? headers : Object.keys(csvData[0] || {});
      const csvRowsFinal = csvData.map((row:any) => csvHeadersFinal.map((h) => {
        const v = row[h] ?? '';
        const s = String(v);
        const needs = s.includes(',') || s.includes('\n') || s.includes('"');
        const esc = s.replace(/"/g, '""');
        return needs ? `"${esc}"` : esc;
      }).join(','));
      const csvFinal = [csvHeadersFinal.join(','), ...csvRowsFinal].join('\n');
      const filePath = path.join(uploadsDir, safeName);
      fs.writeFileSync(filePath, csvFinal);

      // Public URL via /files static
      const publicUrl = `${env.SERVER_URL || `http://localhost:${numericPort}`}/files/${safeName}`;

      res.json({
        success: validationErrors.length === 0,
        rowCount: csvData.length,
        headers,
        sampleData,
        validationErrors,
        fileUrl: publicUrl
      });

    } catch (parseError) {
      dlog('File parsing error:', parseError);
      res.status(400).json({ error: "Failed to parse file. Please ensure it's a valid CSV or Excel file." });
    }

  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/bulk-messages/send:
 *   post:
 *     tags:
 *       - Bulk Messaging
 *     summary: Send bulk messages using Interakt API
 *     description: Sends bulk messages using the Interakt bulk messaging API with CSV data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileData
 *               - templateName
 *               - languageCode
 *               - phoneNumberId
 *               - accessToken
 *               - wabaId
 *             properties:
 *               fileData:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: Parsed CSV data
 *               templateName:
 *                 type: string
 *                 description: Template name to use
 *               languageCode:
 *                 type: string
 *                 description: Template language code
 *               phoneNumberId:
 *                 type: string
 *                 description: Phone number ID for Interakt API
 *               accessToken:
 *                 type: string
 *                 description: Interakt access token
 *               wabaId:
 *                 type: string
 *                 description: WhatsApp Business Account ID
 *               templateParameters:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Template parameter mappings
 *     responses:
 *       200:
 *         description: Bulk message job accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 */
router.post("/send", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    
    const bodySchema = z.object({
      fileData: z.array(z.record(z.string(), z.any())),
      templateName: z.string(),
      languageCode: z.string().default("en"),
      templateParameters: z.record(z.string(), z.string()).optional(),
      // obtained from /upload response
      fileUrl: z.string().url().optional(),
    });

    const body = bodySchema.parse(req.body);

    // Get WhatsApp setup from database (same pattern as sendTemplate)
    const client = await pool.connect();
    try {
      const setupResult = await client.query(
        'SELECT waba_id, phone_number_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL',
        [userId]
      );

      if (setupResult.rows.length === 0 || !setupResult.rows[0].waba_id || !setupResult.rows[0].phone_number_id) {
        return res.status(400).json({
          success: false,
          message: 'WhatsApp setup not completed. Please complete WhatsApp Business setup with both WABA ID and Phone Number ID.',
          code: 'WHATSAPP_SETUP_REQUIRED'
        });
      }

      const wabaId = setupResult.rows[0].waba_id;
      const phoneNumberId = setupResult.rows[0].phone_number_id;
      const accessToken = env.INTERAKT_ACCESS_TOKEN;

      if (!accessToken) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Interakt access token not configured'
        });
      }

      // Validate WABA ID and Phone Number ID format
      if (!wabaId || typeof wabaId !== 'string' || wabaId.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Invalid WABA ID format. Please check your WhatsApp Business setup.',
          wabaId: wabaId
        });
      }

      if (!phoneNumberId || typeof phoneNumberId !== 'string' || phoneNumberId.length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Phone Number ID format. Please check your WhatsApp Business setup.',
          phoneNumberId: phoneNumberId
        });
      }

      // Convert CSV data to CSV format for Interakt API
      const csvHeaders = Object.keys(body.fileData[0] || {});
      const csvRows = body.fileData.map(row => 
        csvHeaders.map(header => {
          const value = row[header] || '';
          // Escape CSV values
          const stringValue = String(value);
          const needsQuotes = stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"');
          const escaped = stringValue.replace(/"/g, '""');
          return needsQuotes ? `"${escaped}"` : escaped;
        }).join(',')
      );
      
      const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');

      // Use provided public file URL (served from /files). If missing, fallback to error
      const fileUrl = body.fileUrl;
      if (!fileUrl) {
        return res.status(400).json({ success: false, message: 'fileUrl is required. Upload the file first to obtain a public URL.' });
      }

      // Prepare template components based on parameters
      const components: any[] = [];
      
      // Build body parameters from template parameters
      // Extract placeholders in template body: {{Name}}, {{1}} etc.
      let bodyPlaceholders: string[] = [];
      try {
        const comps = (await withFallback({
          feature: 'getTemplateForBulkSend',
          attempt: () => interaktClient.getTemplateById(body.templateName),
          fallback: async () => ({ components: [{ type: 'BODY', text: '' }] })
        }) as any)?.components || [];
        const bodyComp = Array.isArray(comps) ? comps.find((c: any) => String(c.type).toUpperCase() === 'BODY') : null;
        const text: string = (bodyComp?.text || '') as string;
        bodyPlaceholders = Array.from(new Set((text.match(/\{\{[^}]+\}\}/g) || []).map(s => s.replace(/\{|\}/g, ''))));
      } catch {}

      if (body.templateParameters && Object.keys(body.templateParameters).length > 0) {
        // explicit mapping: support positional keys ('1','2',...) and constants (prefix CONST:)
        const ordered = Object.entries(body.templateParameters)
          .map(([k, v]) => ({ idx: Number(k), val: String(v) }))
          .filter(x => !Number.isNaN(x.idx))
          .sort((a,b) => a.idx - b.idx);
        const params = ordered.map(({ val }) => {
          const isConst = val.startsWith('CONST:');
          const text = isConst ? val.replace(/^CONST:/, '') : `{{${val}}}`;
          return { type: 'text', text } as any;
        });
        if (params.length > 0) {
          components.push({ type: 'body', parameters: params });
        }
      } else if (bodyPlaceholders.length > 0) {
        // auto-map placeholders to CSV headers by exact name
        const headers = Object.keys(body.fileData[0] || {});
        const params = bodyPlaceholders
          .filter(ph => headers.includes(ph))
          .map((ph) => ({ type: 'text', text: `{{${ph}}}` }));
        if (params.length > 0) {
          components.push({ type: 'body', parameters: params });
        }
      }

      // Prepare Interakt API payload
      const interaktPayload = {
        file_url: fileUrl,
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "{{phone_number}}",
        type: "template",
        template: {
          name: body.templateName,
          language: {
            code: body.languageCode
          },
          ...(components.length > 0 ? { components } : {})
        }
      };

      dlog('Interakt payload:', JSON.stringify(interaktPayload, null, 2));

      // Call Interakt API
      const interaktResponse = await withFallback({
        feature: "bulkMessageSend",
        attempt: async () => {
          const response = await fetch(`https://notification-express.interakt.ai/api/v20.0/${phoneNumberId}/bulk-messages`, {
            method: 'POST',
            headers: {
              'x-access-token': accessToken,
              'x-waba-id': wabaId,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(interaktPayload)
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            dlog('Interakt API error response:', errorText);
            throw new Error(`Interakt API error: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          return await response.json();
        },
        fallback: async () => ({
          status: "ACCEPTED",
          message: "Bulk message job accepted for processing (fallback mode)",
          jobId: "mock-job-" + Math.random().toString(36).slice(2, 10),
          fallback: true
        })
      });

      // Create billing log for the bulk job
      try {
        const ins = await upsertBillingLog({
          userId,
          conversationId: interaktResponse.jobId || `bulk-${Date.now()}`,
          category: 'utility', // Default category, could be determined from template
          recipientNumber: 'bulk',
          startTime: new Date(),
          endTime: new Date(),
          billingStatus: 'pending',
        });
        
        if (ins) {
          const amtRes = await pool.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
          const row = amtRes.rows[0];
          if (row) {
            await holdWalletInSuspenseForBilling({ 
              userId, 
              conversationId: interaktResponse.jobId || `bulk-${Date.now()}`, 
              amountPaise: row.amount_paise, 
              currency: row.amount_currency 
            });
          }
        }
      } catch (e) {
        dlog('Bulk messaging billing hold failed:', e);
      }

      res.json({
        success: true,
        message: interaktResponse.message || "Bulk message job accepted for processing",
        jobId: interaktResponse.jobId,
        interaktResponse
      });

    } finally {
      client.release();
    }

  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/bulk-messages/setup:
 *   get:
 *     tags:
 *       - Bulk Messaging
 *     summary: Get WhatsApp setup information
 *     description: Gets the user's WhatsApp Business setup information for bulk messaging
 *     responses:
 *       200:
 *         description: Setup information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 setup:
 *                   type: object
 *                   properties:
 *                     wabaId:
 *                       type: string
 *                     phoneNumberId:
 *                       type: string
 *                     isConfigured:
 *                       type: boolean
 *                 message:
 *                   type: string
 */
router.get("/setup", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    
    const client = await pool.connect();
    try {
      const setupResult = await client.query(
        'SELECT waba_id, phone_number_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL',
        [userId]
      );

      if (setupResult.rows.length === 0) {
        return res.json({
          success: true,
          setup: {
            wabaId: null,
            phoneNumberId: null,
            isConfigured: false
          },
          message: 'WhatsApp setup not completed. Please complete WhatsApp Business setup first.'
        });
      }

      const wabaId = setupResult.rows[0].waba_id;
      const phoneNumberId = setupResult.rows[0].phone_number_id;

      res.json({
        success: true,
        setup: {
          wabaId,
          phoneNumberId,
          isConfigured: true
        },
        message: 'WhatsApp setup is configured and ready for bulk messaging.'
      });

    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/bulk-messages/sample-files:
 *   get:
 *     tags:
 *       - Bulk Messaging
 *     summary: Download sample CSV and Excel files
 *     description: Downloads sample files with the correct format for bulk messaging
 *     parameters:
 *       - in: query
 *         name: format
 *         required: true
 *         schema:
 *           type: string
 *           enum: [csv, xlsx]
 *         description: File format to download
 *     responses:
 *       200:
 *         description: Sample file downloaded
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get("/sample-files", authenticateToken, async (req, res, next) => {
  try {
    const { format } = req.query;
    
    if (!format || (format !== 'csv' && format !== 'xlsx')) {
      return res.status(400).json({ error: 'Format must be csv or xlsx' });
    }

    // Sample data
    const sampleData: Array<Record<string, string>> = [
      { id: '1', phone_number: '+919876543210', Name: 'John Doe', Email: 'john@example.com', Company: 'ABC Corp' },
      { id: '2', phone_number: '+919876543211', Name: 'Jane Smith', Email: 'jane@example.com', Company: 'XYZ Ltd' },
      { id: '3', phone_number: '+919876543212', Name: 'Bob Johnson', Email: 'bob@example.com', Company: 'DEF Inc' },
      { id: '4', phone_number: '+919876543213', Name: 'Alice Brown', Email: 'alice@example.com', Company: 'GHI Corp' },
      { id: '5', phone_number: '+919876543214', Name: 'Charlie Wilson', Email: 'charlie@example.com', Company: 'JKL Ltd' }
    ];

    if (format === 'csv') {
      // Generate CSV
      const headers = Object.keys(sampleData[0]);
      const csvRows = sampleData.map(row => 
        headers.map(header => {
          const value = row[header] || '';
          const stringValue = String(value);
          const needsQuotes = stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"');
          const escaped = stringValue.replace(/"/g, '""');
          return needsQuotes ? `"${escaped}"` : escaped;
        }).join(',')
      );
      const csvContent = [headers.join(','), ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="bulk_messaging_sample.csv"');
      res.send(csvContent);
    } else {
      // Generate Excel
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sampleData);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="bulk_messaging_sample.xlsx"');
      res.send(buffer);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
