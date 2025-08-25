import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService';
import { authenticateToken, requireAdmin, requireSuperAdmin, requireAggregator } from '../middleware/authMiddleware';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
});

const updateRoleSchema = z.object({
  role: z.enum(['user', 'aggregator', 'super_admin'])
});

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6)
});

const setPasswordSchema = z.object({
  password: z.string().min(6)
});

const adminCreateBusinessSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  aggregator_user_id: z.number().int().positive()
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 minimum: 2
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minimum: 6
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/register', async (req, res) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    
    const user = await AuthService.registerUser(validatedData);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please wait for admin approval.',
      data: user
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials or account not approved
 */
router.post('/login', async (req, res) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    
    const result = await AuthService.loginUser(validatedData);
    
    res.json({
      success: true,
      message: 'Login successful',
      data: result
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    if (error instanceof Error) {
      return res.status(401).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await AuthService.getUserById(req.user!.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/users:
 *   get:
 *     summary: Get all users (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await AuthService.getAllUsers();
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/pending:
 *   get:
 *     summary: Get pending users for approval (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending users retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/pending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await AuthService.getPendingUsers();
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/approve/{userId}:
 *   post:
 *     summary: Approve a user (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User approved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.post('/approve/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const user = await AuthService.approveUser(userId, req.user!.userId);
    
    res.json({
      success: true,
      message: 'User approved successfully',
      data: user
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/role/{userId}:
 *   put:
 *     summary: Update user role (super admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, aggregator, super_admin]
 *     responses:
 *       200:
 *         description: User role updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 *       404:
 *         description: User not found
 */
router.put('/role/:userId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const validatedData = updateRoleSchema.parse(req.body);
    const user = await AuthService.updateUserRole(userId, validatedData.role);
    
    res.json({
      success: true,
      message: 'User role updated successfully',
      data: user
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    if (error instanceof Error) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Create Aggregator (Super Admin)
 */
router.post('/create-aggregator', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const validated = createUserSchema.parse(req.body);
    const user = await AuthService.createAggregator(validated);
    res.status(201).json({ success: true, message: 'Aggregator created', data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Aggregator: Create Business under self
 */
router.post('/aggregator/business', authenticateToken, requireAggregator, async (req, res) => {
  try {
    const validated = createUserSchema.parse(req.body);
    const user = await AuthService.createBusinessUnderAggregator(req.user!.userId, validated);
    res.status(201).json({ success: true, message: 'Business created', data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Aggregator: List businesses
 */
router.get('/aggregator/businesses', authenticateToken, requireAggregator, async (req, res) => {
  try {
    const users = await AuthService.listBusinessesForAggregator(req.user!.userId);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Super Admin: Move business to another aggregator
 */
router.post('/move-business', authenticateToken, requireSuperAdmin, async (req, res) => {
  const schema = z.object({ 
    child_user_id: z.number().int().positive(), 
    new_aggregator_user_id: z.number().int().min(0) // Allow 0 for unassigning
  });
  try {
    const { child_user_id, new_aggregator_user_id } = schema.parse(req.body);
    await AuthService.moveBusinessToAggregator(child_user_id, new_aggregator_user_id === 0 ? null : new_aggregator_user_id);
    res.json({ success: true, message: 'Business moved successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Super Admin: Create business under specified aggregator
 */
router.post('/admin/create-business', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const validated = adminCreateBusinessSchema.parse(req.body);
    const user = await AuthService.createBusinessUnderAggregator(validated.aggregator_user_id, {
      name: validated.name,
      email: validated.email,
      password: validated.password
    });
    res.status(201).json({ success: true, message: 'Business created', data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Super Admin: Set/Update user password
 */
router.post('/set-password/:userId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    const { password } = setPasswordSchema.parse(req.body);
    await AuthService.setUserPassword(userId, password);
    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    if (error instanceof Error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/deactivate/{userId}:
 *   post:
 *     summary: Deactivate a user (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deactivated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.post('/deactivate/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const user = await AuthService.deactivateUser(userId);
    
    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: user
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/auth/activate/{userId}:
 *   post:
 *     summary: Activate a user (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User activated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.post('/activate/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const user = await AuthService.activateUser(userId);
    
    res.json({
      success: true,
      message: 'User activated successfully',
      data: user
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
