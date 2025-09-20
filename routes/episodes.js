const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const episodeSchema = Joi.object({
  patientId: Joi.string().required(),
  episodeNumber: Joi.string().required(),
  startDate: Joi.date().required(),
  endDate: Joi.date().optional(),
  status: Joi.string().valid('ACTIVE', 'DISCHARGED', 'SUSPENDED', 'CANCELLED').default('ACTIVE'),
  disciplines: Joi.array().items(Joi.string().valid('SN', 'PT', 'OT', 'ST', 'MSW', 'HHA')).required(),
  frequencyPerWeek: Joi.number().integer().min(1).max(7).optional(),
  visitDurationMinutes: Joi.number().integer().min(15).max(480).optional(),
  careGoals: Joi.string().optional()
});

// Get all episodes with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const status = req.query.status;
    const patientId = req.query.patientId;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    
    if (search) {
      where.OR = [
        { episodeNumber: { contains: search, mode: 'insensitive' } },
        { patient: { 
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } }
          ]
        }}
      ];
    }

    if (status) {
      where.status = status;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    // Get episodes with related data
    const [episodes, total] = await Promise.all([
      prisma.episode.findMany({
        where,
        include: {
          patient: {
            select: { id: true, patientId: true, firstName: true, lastName: true }
          },
          _count: {
            select: {
              visitNotes: true,
              schedules: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.episode.count({ where })
    ]);

    res.json({
      episodes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get episodes error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get single episode by ID
router.get('/:episodeId', async (req, res) => {
  try {
    const episode = await prisma.episode.findUnique({
      where: { id: req.params.episodeId },
      include: {
        patient: true,
        oasisAssessments: {
          orderBy: { assessmentDate: 'desc' }
        },
        visitNotes: {
          orderBy: { visitDate: 'desc' }
        },
        carePlans: {
          orderBy: { createdAt: 'desc' }
        },
        schedules: {
          orderBy: { visitDate: 'desc' }
        },
        authorizations: {
          include: {
            payer: true
          }
        },
        claims: {
          include: {
            payer: true
          }
        }
      }
    });

    if (!episode) {
      return res.status(404).json({
        error: 'Episode not found',
        code: 'EPISODE_NOT_FOUND'
      });
    }

    res.json({ episode });

  } catch (error) {
    console.error('Get episode error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Create new episode
router.post('/', requireRole(['INTAKE_STAFF', 'CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = episodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    // Check if episode number already exists
    const existingEpisode = await prisma.episode.findUnique({
      where: { episodeNumber: value.episodeNumber }
    });

    if (existingEpisode) {
      return res.status(409).json({
        error: 'Episode number already exists',
        code: 'EPISODE_NUMBER_EXISTS'
      });
    }

    // Verify patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: value.patientId }
    });

    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }

    const episode = await prisma.episode.create({
      data: {
        ...value,
        createdBy: req.user.id
      },
      include: {
        patient: {
          select: { id: true, patientId: true, firstName: true, lastName: true }
        }
      }
    });

    // Log the creation
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_EPISODE',
        tableName: 'episodes',
        recordId: episode.id,
        newValues: episode,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.status(201).json({
      message: 'Episode created successfully',
      episode
    });

  } catch (error) {
    console.error('Create episode error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Update episode
router.put('/:episodeId', requireRole(['INTAKE_STAFF', 'CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = episodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    // Get current episode data for audit log
    const currentEpisode = await prisma.episode.findUnique({
      where: { id: req.params.episodeId }
    });

    if (!currentEpisode) {
      return res.status(404).json({
        error: 'Episode not found',
        code: 'EPISODE_NOT_FOUND'
      });
    }

    const updatedEpisode = await prisma.episode.update({
      where: { id: req.params.episodeId },
      data: value,
      include: {
        patient: {
          select: { id: true, patientId: true, firstName: true, lastName: true }
        }
      }
    });

    // Log the update
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_EPISODE',
        tableName: 'episodes',
        recordId: updatedEpisode.id,
        oldValues: currentEpisode,
        newValues: updatedEpisode,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.json({
      message: 'Episode updated successfully',
      episode: updatedEpisode
    });

  } catch (error) {
    console.error('Update episode error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Discharge episode
router.patch('/:episodeId/discharge', requireRole(['CLINICIAN', 'ADMIN']), async (req, res) => {
  try {
    const { endDate, dischargeReason } = req.body;

    const episode = await prisma.episode.findUnique({
      where: { id: req.params.episodeId }
    });

    if (!episode) {
      return res.status(404).json({
        error: 'Episode not found',
        code: 'EPISODE_NOT_FOUND'
      });
    }

    if (episode.status === 'DISCHARGED') {
      return res.status(400).json({
        error: 'Episode already discharged',
        code: 'EPISODE_ALREADY_DISCHARGED'
      });
    }

    const updatedEpisode = await prisma.episode.update({
      where: { id: req.params.episodeId },
      data: {
        status: 'DISCHARGED',
        endDate: endDate || new Date()
      }
    });

    // Log the discharge
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DISCHARGE_EPISODE',
        tableName: 'episodes',
        recordId: updatedEpisode.id,
        oldValues: episode,
        newValues: updatedEpisode,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.json({
      message: 'Episode discharged successfully',
      episode: updatedEpisode
    });

  } catch (error) {
    console.error('Discharge episode error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
