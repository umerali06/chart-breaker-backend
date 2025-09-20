const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole, requirePatientAccess } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const patientSchema = Joi.object({
  patientId: Joi.string().required(),
  firstName: Joi.string().min(2).max(100).required(),
  lastName: Joi.string().min(2).max(100).required(),
  dateOfBirth: Joi.date().required(),
  gender: Joi.string().valid('M', 'F', 'O').required(),
  ssn: Joi.string().pattern(/^\d{3}-\d{2}-\d{4}$/).optional(),
  addressLine1: Joi.string().max(255).optional(),
  addressLine2: Joi.string().max(255).optional(),
  city: Joi.string().max(100).optional(),
  state: Joi.string().length(2).optional(),
  zipCode: Joi.string().max(10).optional(),
  phone: Joi.string().max(20).optional(),
  email: Joi.string().email().optional(),
  primaryLanguage: Joi.string().max(50).optional(),
  emergencyContactName: Joi.string().max(200).optional(),
  emergencyContactPhone: Joi.string().max(20).optional(),
  emergencyContactRelationship: Joi.string().max(100).optional()
});

const patientUpdateSchema = patientSchema.fork(['patientId'], (schema) => schema.optional());

// Get patients for selector (lightweight list)
router.get('/selector', async (req, res) => {
  try {
    const { search } = req.query;
    const where = {
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { patientId: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const patients = await prisma.patient.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        patientId: true,
      },
      orderBy: { lastName: 'asc' },
      take: 20, // Limit results for selector
    });

    res.json({ success: true, data: patients });
  } catch (error) {
    console.error('Error fetching patients for selector:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch patients for selector', error: error.message });
  }
});

// Get all patients with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const status = req.query.status;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { patientId: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get patients with related data
    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        include: {
          episodes: {
            select: { id: true, episodeNumber: true, status: true, startDate: true },
            orderBy: { createdAt: 'desc' }
          },
          _count: {
            select: {
              episodes: true,
              schedules: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.patient.count({ where })
    ]);

    res.json({
      patients,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get single patient by ID
router.get('/:patientId', requirePatientAccess, async (req, res) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.patientId },
      include: {
        referrals: {
          orderBy: { createdAt: 'desc' }
        },
        episodes: {
          include: {
            _count: {
              select: {
                visitNotes: true,
                schedules: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        carePlans: {
          orderBy: { createdAt: 'desc' }
        },
        authorizations: {
          include: {
            payer: true
          },
          orderBy: { createdAt: 'desc' }
        },
        documents: {
          orderBy: { createdAt: 'desc' }
        },
        schedules: {
          include: {
            staff: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: { visitDate: 'desc' }
        },
        oasisAssessments: {
          include: {
            clinician: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: { assessmentDate: 'desc' }
        }
      }
    });

    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }

    res.json({ patient });

  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Create new patient
router.post('/', requireRole(['INTAKE_STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = patientSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    // Check if patient ID already exists
    const existingPatient = await prisma.patient.findUnique({
      where: { patientId: value.patientId }
    });

    if (existingPatient) {
      return res.status(409).json({
        error: 'Patient ID already exists',
        code: 'PATIENT_ID_EXISTS'
      });
    }

    const patient = await prisma.patient.create({
      data: {
        ...value,
        createdBy: req.user.id
      },
      include: {
        episodes: true,
        referrals: true
      }
    });

    // Log the creation
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_PATIENT',
        tableName: 'patients',
        recordId: patient.id,
        newValues: patient,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.status(201).json({
      message: 'Patient created successfully',
      patient
    });

  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Update patient
router.put('/:patientId', requirePatientAccess, requireRole(['INTAKE_STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = patientUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    // Get current patient data for audit log
    const currentPatient = await prisma.patient.findUnique({
      where: { id: req.params.patientId }
    });

    if (!currentPatient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }

    const updatedPatient = await prisma.patient.update({
      where: { id: req.params.patientId },
      data: value,
      include: {
        episodes: true,
        referrals: true
      }
    });

    // Log the update
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_PATIENT',
        tableName: 'patients',
        recordId: updatedPatient.id,
        oldValues: currentPatient,
        newValues: updatedPatient,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.json({
      message: 'Patient updated successfully',
      patient: updatedPatient
    });

  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Delete patient (soft delete by deactivating)
router.delete('/:patientId', requirePatientAccess, requireRole(['ADMIN']), async (req, res) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.patientId }
    });

    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        code: 'PATIENT_NOT_FOUND'
      });
    }

    // Check if patient has active episodes
    const activeEpisodes = await prisma.episode.count({
      where: {
        patientId: req.params.patientId,
        status: 'ACTIVE'
      }
    });

    if (activeEpisodes > 0) {
      return res.status(400).json({
        error: 'Cannot delete patient with active episodes',
        code: 'PATIENT_HAS_ACTIVE_EPISODES'
      });
    }

    // For now, we'll just mark as inactive in a future field
    // In a real implementation, you might want to add an isActive field
    await prisma.patient.delete({
      where: { id: req.params.patientId }
    });

    // Log the deletion
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE_PATIENT',
        tableName: 'patients',
        recordId: req.params.patientId,
        oldValues: patient,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.json({
      message: 'Patient deleted successfully'
    });

  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get patient statistics
router.get('/:patientId/stats', requirePatientAccess, async (req, res) => {
  try {
    const patientId = req.params.patientId;

    const [
      episodeCount,
      visitCount,
      activeEpisodes,
      lastVisit
    ] = await Promise.all([
      prisma.episode.count({
        where: { patientId }
      }),
      prisma.visitNote.count({
        where: { patientId }
      }),
      prisma.episode.count({
        where: { 
          patientId,
          status: 'ACTIVE'
        }
      }),
      prisma.visitNote.findFirst({
        where: { patientId },
        orderBy: { visitDate: 'desc' },
        select: { visitDate: true }
      })
    ]);

    res.json({
      stats: {
        totalEpisodes: episodeCount,
        totalVisits: visitCount,
        activeEpisodes,
        lastVisit: lastVisit?.visitDate
      }
    });

  } catch (error) {
    console.error('Get patient stats error:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
