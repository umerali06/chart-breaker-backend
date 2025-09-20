const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');
const Joi = require('joi');

const router = express.Router();
const prisma = new PrismaClient();

// Validation schemas
const createPhysicianSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  npi: Joi.string().min(10).max(10).required(),
  specialty: Joi.string().min(1).max(100).optional(),
  phone: Joi.string().min(10).max(20).optional(),
  email: Joi.string().email().optional(),
  address: Joi.string().max(500).optional(),
  isActive: Joi.boolean().default(true)
});

const updatePhysicianSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).optional(),
  lastName: Joi.string().min(1).max(100).optional(),
  npi: Joi.string().min(10).max(10).optional(),
  specialty: Joi.string().min(1).max(100).optional(),
  phone: Joi.string().min(10).max(20).optional(),
  email: Joi.string().email().optional(),
  address: Joi.string().max(500).optional(),
  isActive: Joi.boolean().optional()
});

// Get all physicians with search and pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const specialty = req.query.specialty;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {
      isActive: true
    };
    
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { npi: { contains: search, mode: 'insensitive' } },
        { specialty: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (specialty) {
      where.specialty = { contains: specialty, mode: 'insensitive' };
    }

    const [physicians, total] = await Promise.all([
      prisma.physician.findMany({
        where,
        orderBy: [
          { lastName: 'asc' },
          { firstName: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.physician.count({ where })
    ]);

    res.json({
      success: true,
      data: physicians,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching physicians:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physicians',
      error: error.message
    });
  }
});

// Get single physician
router.get('/:physicianId', authenticateToken, async (req, res) => {
  try {
    const { physicianId } = req.params;

    const physician = await prisma.physician.findUnique({
      where: { id: physicianId }
    });

    if (!physician) {
      return res.status(404).json({
        success: false,
        message: 'Physician not found'
      });
    }

    res.json({
      success: true,
      data: physician
    });
  } catch (error) {
    console.error('Error fetching physician:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch physician',
      error: error.message
    });
  }
});

// Create new physician
router.post('/', authenticateToken, requireRole(['ADMIN', 'INTAKE_STAFF']), async (req, res) => {
  try {
    const { error, value } = createPhysicianSchema.validate(req.body);
    
    if (error) {
      const friendlyErrors = error.details.map(detail => {
        const field = detail.path[0];
        const message = detail.message;
        
        // Convert Joi error messages to user-friendly ones
        if (message.includes('is required')) {
          return `${field.charAt(0).toUpperCase() + field.slice(1)} is required`;
        }
        if (message.includes('must be a valid email')) {
          return 'Please enter a valid email address';
        }
        if (message.includes('length must be at least 10 characters long')) {
          if (field === 'npi') {
            return 'NPI must be exactly 10 digits';
          }
          if (field === 'phone') {
            return 'Phone number must be at least 10 digits';
          }
        }
        if (message.includes('length must be at most 10 characters long')) {
          if (field === 'npi') {
            return 'NPI must be exactly 10 digits';
          }
        }
        if (message.includes('length must be at most 20 characters long')) {
          if (field === 'phone') {
            return 'Phone number is too long (maximum 20 characters)';
          }
        }
        if (message.includes('length must be at most 100 characters long')) {
          return `${field.charAt(0).toUpperCase() + field.slice(1)} is too long (maximum 100 characters)`;
        }
        if (message.includes('length must be at most 500 characters long')) {
          return 'Address is too long (maximum 500 characters)';
        }
        
        return message.replace(/"/g, '');
      });
      
      return res.status(400).json({
        success: false,
        message: 'Please fix the following errors:',
        errors: friendlyErrors
      });
    }

    // Check if NPI already exists
    const existingPhysician = await prisma.physician.findFirst({
      where: { npi: value.npi }
    });

    if (existingPhysician) {
      return res.status(409).json({
        success: false,
        message: 'Physician with this NPI already exists'
      });
    }

    const physician = await prisma.physician.create({
      data: value
    });

    res.status(201).json({
      success: true,
      message: 'Physician created successfully',
      data: physician
    });
  } catch (error) {
    console.error('Error creating physician:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create physician',
      error: error.message
    });
  }
});

// Update physician
router.put('/:physicianId', authenticateToken, requireRole(['ADMIN', 'INTAKE_STAFF']), async (req, res) => {
  try {
    const { physicianId } = req.params;
    const { error, value } = updatePhysicianSchema.validate(req.body);
    
    if (error) {
      const friendlyErrors = error.details.map(detail => {
        const field = detail.path[0];
        const message = detail.message;
        
        // Convert Joi error messages to user-friendly ones
        if (message.includes('is required')) {
          return `${field.charAt(0).toUpperCase() + field.slice(1)} is required`;
        }
        if (message.includes('must be a valid email')) {
          return 'Please enter a valid email address';
        }
        if (message.includes('length must be at least 10 characters long')) {
          if (field === 'npi') {
            return 'NPI must be exactly 10 digits';
          }
          if (field === 'phone') {
            return 'Phone number must be at least 10 digits';
          }
        }
        if (message.includes('length must be at most 10 characters long')) {
          if (field === 'npi') {
            return 'NPI must be exactly 10 digits';
          }
        }
        if (message.includes('length must be at most 20 characters long')) {
          if (field === 'phone') {
            return 'Phone number is too long (maximum 20 characters)';
          }
        }
        if (message.includes('length must be at most 100 characters long')) {
          return `${field.charAt(0).toUpperCase() + field.slice(1)} is too long (maximum 100 characters)`;
        }
        if (message.includes('length must be at most 500 characters long')) {
          return 'Address is too long (maximum 500 characters)';
        }
        
        return message.replace(/"/g, '');
      });
      
      return res.status(400).json({
        success: false,
        message: 'Please fix the following errors:',
        errors: friendlyErrors
      });
    }

    // Check if physician exists
    const existingPhysician = await prisma.physician.findUnique({
      where: { id: physicianId }
    });

    if (!existingPhysician) {
      return res.status(404).json({
        success: false,
        message: 'Physician not found'
      });
    }

    // Check if NPI is being changed and if it conflicts
    if (value.npi && value.npi !== existingPhysician.npi) {
      const npiConflict = await prisma.physician.findFirst({
        where: { 
          npi: value.npi,
          id: { not: physicianId }
        }
      });

      if (npiConflict) {
        return res.status(409).json({
          success: false,
          message: 'Another physician with this NPI already exists'
        });
      }
    }

    const physician = await prisma.physician.update({
      where: { id: physicianId },
      data: value
    });

    res.json({
      success: true,
      message: 'Physician updated successfully',
      data: physician
    });
  } catch (error) {
    console.error('Error updating physician:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update physician',
      error: error.message
    });
  }
});

// Delete physician (soft delete)
router.delete('/:physicianId', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { physicianId } = req.params;

    // Check if physician exists
    const existingPhysician = await prisma.physician.findUnique({
      where: { id: physicianId }
    });

    if (!existingPhysician) {
      return res.status(404).json({
        success: false,
        message: 'Physician not found'
      });
    }

    // Soft delete by setting isActive to false
    await prisma.physician.update({
      where: { id: physicianId },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Physician deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting physician:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete physician',
      error: error.message
    });
  }
});

// Get physician specialties
router.get('/specialties/list', authenticateToken, async (req, res) => {
  try {
    const specialties = await prisma.physician.findMany({
      where: { 
        isActive: true,
        specialty: { not: null }
      },
      select: { specialty: true },
      distinct: ['specialty']
    });

    const specialtyList = specialties
      .map(p => p.specialty)
      .filter(Boolean)
      .sort();

    res.json({
      success: true,
      data: specialtyList
    });
  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch specialties',
      error: error.message
    });
  }
});

module.exports = router;
