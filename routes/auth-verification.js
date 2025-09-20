const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();
const prisma = new PrismaClient();

// Validation schemas
const requestRegistrationSchema = Joi.object({
  email: Joi.string().email().required(),
  firstName: Joi.string().min(2).max(100).required(),
  lastName: Joi.string().min(2).max(100).required(),
  role: Joi.string().valid('INTAKE_STAFF','CLINICIAN','QA_REVIEWER','BILLER').required(),
});

const verifyEmailSchema = Joi.object({
  email: Joi.string().email().required(),
  verificationCode: Joi.string().length(6).required(),
});

const completeRegistrationSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  token: Joi.string().min(10).required(),
});

// Generate verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Request registration (Step 1: User requests to register)
router.post('/request-registration', async (req, res) => {
  try {
    const { error, value } = requestRegistrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details[0].message });
    }
    const { email, firstName, lastName, role } = value;

    // Validate required fields
    if (!email || !firstName || !lastName || !role) {
      return res.status(400).json({ 
        error: 'All fields are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate role
    const validRoles = ['INTAKE_STAFF', 'CLINICIAN', 'QA_REVIEWER', 'BILLER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role selected',
        code: 'INVALID_ROLE'
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User with this email already exists',
        code: 'USER_EXISTS'
      });
    }

    // Check if there's already a pending registration request
    const existingRequest = await prisma.userRegistrationRequest.findUnique({
      where: { email }
    });

    if (existingRequest && existingRequest.status === 'PENDING') {
      return res.status(400).json({ 
        error: 'Registration request already pending',
        code: 'REQUEST_PENDING'
      });
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create or update registration request
    const registrationRequest = await prisma.userRegistrationRequest.upsert({
      where: { email },
      update: {
        firstName,
        lastName,
        role,
        verificationCode,
        verificationExpires,
        status: 'PENDING',
        requestedAt: new Date()
      },
      create: {
        email,
        firstName,
        lastName,
        role,
        verificationCode,
        verificationExpires,
        status: 'PENDING'
      }
    });

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, verificationCode, firstName);
    
    if (!emailSent) {
      return res.status(500).json({ 
        error: 'Failed to send verification email',
        code: 'EMAIL_SEND_FAILED'
      });
    }

    res.json({ 
      message: 'Registration request submitted. Please check your email for verification code.',
      requestId: registrationRequest.id
    });

  } catch (error) {
    console.error('Request registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify email (Step 2: User verifies email with code)
router.post('/verify-email', async (req, res) => {
  try {
    const { error, value } = verifyEmailSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details[0].message });
    }
    const { email, verificationCode } = value;

    if (!email || !verificationCode) {
      return res.status(400).json({ 
        error: 'Email and verification code are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Find registration request
    const registrationRequest = await prisma.userRegistrationRequest.findUnique({
      where: { email }
    });

    if (!registrationRequest) {
      return res.status(400).json({ 
        error: 'Registration request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    if (registrationRequest.status !== 'PENDING') {
      return res.status(400).json({ 
        error: 'Registration request is not pending',
        code: 'REQUEST_NOT_PENDING'
      });
    }

    // Check if verification code is correct and not expired
    if (registrationRequest.verificationCode !== verificationCode) {
      return res.status(400).json({ 
        error: 'Invalid verification code',
        code: 'INVALID_CODE'
      });
    }

    if (new Date() > registrationRequest.verificationExpires) {
      return res.status(400).json({ 
        error: 'Verification code has expired',
        code: 'CODE_EXPIRED'
      });
    }

    // Update registration request status to verified (waiting for admin approval)
    await prisma.userRegistrationRequest.update({
      where: { email },
      data: {
        verificationCode: null, // Clear the code
        verificationExpires: null
      }
    });

    res.json({ 
      message: 'Email verified successfully. Your registration is now pending admin approval.',
      status: 'VERIFIED_PENDING_APPROVAL'
    });

  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete registration (Step 3: User completes registration after admin approval)
router.post('/complete-registration', async (req, res) => {
  try {
    const { error, value } = completeRegistrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details[0].message });
    }
    const { email, password, token: completionToken } = value;

    if (!email || !password || !completionToken) {
      return res.status(400).json({ 
        error: 'Email, password and token are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Find approved registration request
    const registrationRequest = await prisma.userRegistrationRequest.findUnique({
      where: { email }
    });

    if (!registrationRequest) {
      return res.status(400).json({ 
        error: 'Registration request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    if (registrationRequest.status !== 'APPROVED') {
      return res.status(400).json({ 
        error: 'Registration request is not approved',
        code: 'REQUEST_NOT_APPROVED'
      });
    }

    // Validate completion token
    if (!registrationRequest.completionToken || registrationRequest.completionToken !== completionToken) {
      return res.status(400).json({
        error: 'Invalid or missing completion token',
        code: 'INVALID_COMPLETION_TOKEN'
      });
    }
    if (registrationRequest.completionTokenExpires && new Date() > registrationRequest.completionTokenExpires) {
      return res.status(400).json({
        error: 'Completion token has expired',
        code: 'COMPLETION_TOKEN_EXPIRED'
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: registrationRequest.firstName,
        lastName: registrationRequest.lastName,
        role: registrationRequest.role,
        isActive: true
      }
    });

    // Update registration request status and invalidate token
    await prisma.userRegistrationRequest.update({
      where: { email },
      data: { status: 'APPROVED', completionToken: null, completionTokenExpires: null }
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      message: 'Registration completed successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Complete registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get registration status
router.get('/registration-status/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const registrationRequest = await prisma.userRegistrationRequest.findUnique({
      where: { email }
    });

    if (!registrationRequest) {
      return res.status(404).json({ 
        error: 'Registration request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    res.json({ 
      status: registrationRequest.status,
      requestedAt: registrationRequest.requestedAt,
      approvedAt: registrationRequest.approvedAt,
      adminNotes: registrationRequest.adminNotes
    });

  } catch (error) {
    console.error('Get registration status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes for managing registration requests
router.get('/admin/registration-requests', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const where = status ? { status } : {};
    
    const requests = await prisma.userRegistrationRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit),
      include: {
        approvedByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const total = await prisma.userRegistrationRequest.count({ where });

    res.json({
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get registration requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve registration request
router.post('/admin/approve-registration/:requestId', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { requestId } = req.params;
    const { adminNotes } = req.body;

    const registrationRequest = await prisma.userRegistrationRequest.findUnique({
      where: { id: requestId }
    });

    if (!registrationRequest) {
      return res.status(404).json({ 
        error: 'Registration request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    if (registrationRequest.status !== 'PENDING') {
      return res.status(400).json({ 
        error: 'Registration request is not pending',
        code: 'REQUEST_NOT_PENDING'
      });
    }

    // Generate completion token (12h expiry)
    const completionToken = require('crypto').randomBytes(24).toString('hex');
    const completionTokenExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

    // Update registration request
    await prisma.userRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: req.user.userId,
        adminNotes,
        completionToken,
        completionTokenExpires
      }
    });

    // Send approval email
    await emailService.sendRegistrationApprovalEmail(
      registrationRequest.email,
      registrationRequest.firstName,
      req.user.firstName + ' ' + req.user.lastName,
      completionToken
    );

    res.json({ 
      message: 'Registration request approved successfully'
    });

  } catch (error) {
    console.error('Approve registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject registration request
router.post('/admin/reject-registration/:requestId', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason, adminNotes } = req.body;

    if (!reason) {
      return res.status(400).json({ 
        error: 'Rejection reason is required',
        code: 'MISSING_REASON'
      });
    }

    const registrationRequest = await prisma.userRegistrationRequest.findUnique({
      where: { id: requestId }
    });

    if (!registrationRequest) {
      return res.status(404).json({ 
        error: 'Registration request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }

    if (registrationRequest.status !== 'PENDING') {
      return res.status(400).json({ 
        error: 'Registration request is not pending',
        code: 'REQUEST_NOT_PENDING'
      });
    }

    // Update registration request
    await prisma.userRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        approvedAt: new Date(),
        approvedBy: req.user.userId,
        adminNotes: adminNotes || reason
      }
    });

    // Send rejection email
    await emailService.sendRegistrationRejectionEmail(
      registrationRequest.email,
      registrationRequest.firstName,
      req.user.firstName + ' ' + req.user.lastName,
      reason
    );

    res.json({ 
      message: 'Registration request rejected successfully'
    });

  } catch (error) {
    console.error('Reject registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

