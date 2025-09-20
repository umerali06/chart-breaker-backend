const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const scheduleSchema = Joi.object({
  patientId: Joi.string().required(),
  episodeId: Joi.string().optional(),
  staffId: Joi.string().required(),
  visitDate: Joi.date().required(),
  startTime: Joi.date().required(),
  endTime: Joi.date().required(),
  discipline: Joi.string().valid('SN', 'PT', 'OT', 'ST', 'MSW', 'HHA').required(),
  visitType: Joi.string().valid('ROUTINE', 'EVALUATION', 'RE_EVALUATION', 'DISCHARGE').required(),
  notes: Joi.string().optional()
});

// Get schedules
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const patientId = req.query.patientId;
    const staffId = req.query.staffId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const skip = (page - 1) * limit;

    const where = {};
    if (patientId) where.patientId = patientId;
    if (staffId) where.staffId = staffId;
    if (startDate && endDate) {
      where.visitDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const [schedules, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          episode: { select: { id: true, episodeNumber: true } },
          staff: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { visitDate: 'asc' },
        skip,
        take: limit
      }),
      prisma.schedule.count({ where })
    ]);

    res.json({
      schedules,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    console.error('Get schedules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create schedule
router.post('/', requireRole(['INTAKE_STAFF', 'CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = scheduleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const schedule = await prisma.schedule.create({
      data: value,
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        episode: { select: { id: true, episodeNumber: true } },
        staff: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.status(201).json({
      message: 'Schedule created successfully',
      schedule
    });

  } catch (error) {
    console.error('Create schedule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update schedule status
router.patch('/:scheduleId/status', requireRole(['CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { status } = req.body;

    const schedule = await prisma.schedule.findUnique({
      where: { id: req.params.scheduleId }
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: req.params.scheduleId },
      data: { status }
    });

    res.json({
      message: 'Schedule status updated successfully',
      schedule: updatedSchedule
    });

  } catch (error) {
    console.error('Update schedule status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
