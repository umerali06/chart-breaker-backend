const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');
const Joi = require('joi');

const router = express.Router();
const prisma = new PrismaClient();

// Validation schemas
const createReferralSchema = Joi.object({
  patientId: Joi.string().uuid().required(),
  referralSource: Joi.string().min(1).max(255).required(),
  referralDate: Joi.date().required(),
  referralReason: Joi.string().min(1).max(1000).optional(),
  physicianName: Joi.string().min(1).max(255).required(),
  physicianNpi: Joi.string().min(10).max(10).optional()
});

const updateReferralSchema = Joi.object({
  referralSource: Joi.string().min(1).max(255).optional(),
  referralDate: Joi.date().optional(),
  referralReason: Joi.string().min(1).max(1000).optional(),
  physicianName: Joi.string().min(1).max(255).optional(),
  physicianNpi: Joi.string().min(10).max(10).optional()
});

// Get all referrals for a patient
router.get('/patient/:patientId', authenticateToken, async (req, res) => {
  try {
    const { patientId } = req.params;

    // Verify patient exists and user has access
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true }
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    const referrals = await prisma.referral.findMany({
      where: { patientId },
      orderBy: { referralDate: 'desc' }
    });

    res.json({
      success: true,
      data: referrals
    });
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referrals',
      error: error.message
    });
  }
});

// Get single referral
router.get('/:referralId', authenticateToken, async (req, res) => {
  try {
    const { referralId } = req.params;

    const referral = await prisma.referral.findUnique({
      where: { id: referralId },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found'
      });
    }

    res.json({
      success: true,
      data: referral
    });
  } catch (error) {
    console.error('Error fetching referral:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral',
      error: error.message
    });
  }
});

// Create new referral
router.post('/', authenticateToken, requireRole(['INTAKE_STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { error, value } = createReferralSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Verify patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: value.patientId },
      select: { id: true, firstName: true, lastName: true }
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    const referral = await prisma.referral.create({
      data: {
        ...value,
        referralDate: new Date(value.referralDate)
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Referral created successfully',
      data: referral
    });
  } catch (error) {
    console.error('Error creating referral:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create referral',
      error: error.message
    });
  }
});

// Update referral
router.put('/:referralId', authenticateToken, requireRole(['INTAKE_STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { referralId } = req.params;
    const { error, value } = updateReferralSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Check if referral exists
    const existingReferral = await prisma.referral.findUnique({
      where: { id: referralId }
    });

    if (!existingReferral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found'
      });
    }

    const updateData = { ...value };
    if (value.referralDate) {
      updateData.referralDate = new Date(value.referralDate);
    }

    const referral = await prisma.referral.update({
      where: { id: referralId },
      data: updateData,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Referral updated successfully',
      data: referral
    });
  } catch (error) {
    console.error('Error updating referral:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update referral',
      error: error.message
    });
  }
});

// Delete referral
router.delete('/:referralId', authenticateToken, requireRole(['INTAKE_STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { referralId } = req.params;

    // Check if referral exists
    const existingReferral = await prisma.referral.findUnique({
      where: { id: referralId }
    });

    if (!existingReferral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found'
      });
    }

    await prisma.referral.delete({
      where: { id: referralId }
    });

    res.json({
      success: true,
      message: 'Referral deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting referral:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete referral',
      error: error.message
    });
  }
});

module.exports = router;
