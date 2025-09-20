const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const oasisSchema = Joi.object({
  patientId: Joi.string().required(),
  episodeId: Joi.string().optional().allow(null, ''),
  assessmentType: Joi.string().valid('SOC', 'ROC', 'RECERT', 'TRANSFER', 'DISCHARGE').required(),
  assessmentDate: Joi.alternatives().try(
    Joi.date(),
    Joi.string().isoDate()
  ).required(),
  formData: Joi.object().required()
});

// Get OASIS assessments
router.get('/oasis', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const patientId = req.query.patientId;
    const assessmentType = req.query.assessmentType;
    const skip = (page - 1) * limit;

    const where = {};
    if (patientId) where.patientId = patientId;
    if (assessmentType) where.assessmentType = assessmentType;

    const [assessments, total] = await Promise.all([
      prisma.oasisAssessment.findMany({
        where,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          episode: { select: { id: true, episodeNumber: true } },
          clinician: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { assessmentDate: 'desc' },
        skip,
        take: limit
      }),
      prisma.oasisAssessment.count({ where })
    ]);

    res.json({
      assessments,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    console.error('Get OASIS assessments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create OASIS assessment
router.post('/oasis', async (req, res) => {
  try {
    console.log('Received assessment data:', JSON.stringify(req.body, null, 2));
    console.log('FormData type:', typeof req.body.formData);
    console.log('FormData content:', JSON.stringify(req.body.formData, null, 2));
    console.log('FormData keys:', Object.keys(req.body.formData || {}));
    
    const { error, value } = oasisSchema.validate(req.body);
    if (error) {
      console.log('Validation error details:', error.details);
      console.log('Validation error message:', error.message);
      return res.status(400).json({
        error: 'Validation error',
        message: error.message,
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }

    console.log('User from token:', req.user);
    if (!req.user || !req.user.id) {
      console.log('Authentication failed - no user or user.id');
      return res.status(500).json({ error: 'User authentication error' });
    }

    console.log('Creating assessment with data:', {
      ...value,
      assessmentDate: new Date(value.assessmentDate),
      clinicianId: req.user.id
    });

    const assessment = await prisma.oasisAssessment.create({
      data: {
        ...value,
        assessmentDate: new Date(value.assessmentDate),
        clinicianId: req.user.id
      },
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        episode: { select: { id: true, episodeNumber: true } }
      }
    });

    console.log('Assessment created successfully:', assessment.id);

    res.status(201).json({
      message: 'OASIS assessment created successfully',
      assessment
    });

  } catch (error) {
    console.error('Create OASIS assessment error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Sign OASIS assessment
router.patch('/oasis/:assessmentId/sign', requireRole(['CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const assessment = await prisma.oasisAssessment.findUnique({
      where: { id: req.params.assessmentId }
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.isSigned) {
      return res.status(400).json({ error: 'Assessment already signed' });
    }

    const updatedAssessment = await prisma.oasisAssessment.update({
      where: { id: req.params.assessmentId },
      data: {
        isSigned: true,
        signedBy: req.user.id,
        signedAt: new Date()
      }
    });

    res.json({
      message: 'Assessment signed successfully',
      assessment: updatedAssessment
    });

  } catch (error) {
    console.error('Sign assessment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
