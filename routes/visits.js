const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const visitSchema = Joi.object({
  patientId: Joi.string().required(),
  episodeId: Joi.string().optional(),
  visitDate: Joi.date().required(),
  discipline: Joi.string().valid('SN', 'PT', 'OT', 'ST', 'MSW', 'HHA').required(),
  visitType: Joi.string().valid('ROUTINE', 'EVALUATION', 'RE_EVALUATION', 'DISCHARGE').required(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  notesData: Joi.object().required()
});

// Get visit notes
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const patientId = req.query.patientId;
    const discipline = req.query.discipline;
    const skip = (page - 1) * limit;

    const where = {};
    if (patientId) where.patientId = patientId;
    if (discipline) where.discipline = discipline;

    const [visits, total] = await Promise.all([
      prisma.visitNote.findMany({
        where,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          episode: { select: { id: true, episodeNumber: true } },
          clinician: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { visitDate: 'desc' },
        skip,
        take: limit
      }),
      prisma.visitNote.count({ where })
    ]);

    res.json({
      visits,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    console.error('Get visits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create visit note
router.post('/', requireRole(['CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = visitSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const visit = await prisma.visitNote.create({
      data: {
        ...value,
        clinicianId: req.user.id
      },
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        episode: { select: { id: true, episodeNumber: true } }
      }
    });

    res.status(201).json({
      message: 'Visit note created successfully',
      visit
    });

  } catch (error) {
    console.error('Create visit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign visit note
router.patch('/:visitId/sign', requireRole(['CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const visit = await prisma.visitNote.findUnique({
      where: { id: req.params.visitId }
    });

    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    if (visit.isSigned) {
      return res.status(400).json({ error: 'Visit already signed' });
    }

    const updatedVisit = await prisma.visitNote.update({
      where: { id: req.params.visitId },
      data: {
        isSigned: true,
        signedBy: req.user.id,
        signedAt: new Date()
      }
    });

    res.json({
      message: 'Visit signed successfully',
      visit: updatedVisit
    });

  } catch (error) {
    console.error('Sign visit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
