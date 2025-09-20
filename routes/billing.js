const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Generate unique claim number
const generateClaimNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `CLM${year}`;
  
  // Find the highest claim number for this year
  const lastClaim = await prisma.claim.findFirst({
    where: {
      claimNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      claimNumber: 'desc'
    }
  });
  
  let nextNumber = 1;
  if (lastClaim && lastClaim.claimNumber) {
    const lastNumber = parseInt(lastClaim.claimNumber.replace(prefix, ''));
    nextNumber = lastNumber + 1;
  }
  
  return `${prefix}${nextNumber.toString().padStart(6, '0')}`;
};

// Apply authentication to all routes
router.use(authenticateToken);

// Get payers
router.get('/payers', async (req, res) => {
  try {
    const payers = await prisma.payer.findMany({
      orderBy: { payerName: 'asc' }
    });

    res.json({ payers });

  } catch (error) {
    console.error('Get payers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get claims
router.get('/claims', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;

    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          episode: { select: { id: true, episodeNumber: true } },
          payer: { select: { id: true, payerName: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.claim.count({ where })
    ]);

    res.json({
      claims,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    console.error('Get claims error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create claim
router.post('/claims', requireRole(['BILLER', 'ADMIN']), async (req, res) => {
  try {
    const { patientId, episodeId, payerId, claimType, claimAmount } = req.body;

    // Generate claim number
    const claimNumber = await generateClaimNumber();

    const claim = await prisma.claim.create({
      data: {
        patientId,
        episodeId,
        payerId,
        claimType,
        claimAmount: parseFloat(claimAmount),
        claimNumber
      },
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        payer: { select: { id: true, payerName: true } }
      }
    });

    res.status(201).json({
      message: 'Claim created successfully',
      claim
    });

  } catch (error) {
    console.error('Create claim error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single claim
router.get('/claims/:claimId', async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.claimId },
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        episode: { select: { id: true, episodeNumber: true, status: true } },
        payer: { select: { id: true, payerName: true, payerType: true } }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    res.json({ claim });

  } catch (error) {
    console.error('Get claim error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update claim
router.put('/claims/:claimId', requireRole(['BILLER', 'ADMIN']), async (req, res) => {
  try {
    const { patientId, episodeId, payerId, claimType, claimAmount, status } = req.body;

    // Get current claim to check if status is changing to SUBMITTED
    const currentClaim = await prisma.claim.findUnique({
      where: { id: req.params.claimId }
    });

    const updateData = {
      patientId,
      episodeId: episodeId || null,
      payerId,
      claimType,
      claimAmount: claimAmount ? parseFloat(claimAmount) : undefined,
      status
    };

    // If status is changing to SUBMITTED
    if (status === 'SUBMITTED') {
      // Set submission date if not already set
      if (!currentClaim.submissionDate) {
        updateData.submissionDate = new Date();
      }
      
      // Generate claim number if not already set
      if (!currentClaim.claimNumber) {
        updateData.claimNumber = await generateClaimNumber();
      }
    }

    const claim = await prisma.claim.update({
      where: { id: req.params.claimId },
      data: updateData,
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        payer: { select: { id: true, payerName: true } }
      }
    });

    res.json({
      message: 'Claim updated successfully',
      claim
    });

  } catch (error) {
    console.error('Update claim error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update claim status only
router.patch('/claims/:claimId/status', requireRole(['BILLER', 'ADMIN']), async (req, res) => {
  try {
    const { status } = req.body;

    // Get current claim to check if status is changing to SUBMITTED
    const currentClaim = await prisma.claim.findUnique({
      where: { id: req.params.claimId }
    });

    const updateData = { status };

    // If status is changing to SUBMITTED
    if (status === 'SUBMITTED') {
      // Set submission date if not already set
      if (!currentClaim.submissionDate) {
        updateData.submissionDate = new Date();
      }
      
      // Generate claim number if not already set
      if (!currentClaim.claimNumber) {
        updateData.claimNumber = await generateClaimNumber();
      }
    }

    const claim = await prisma.claim.update({
      where: { id: req.params.claimId },
      data: updateData,
      include: {
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
        payer: { select: { id: true, payerName: true } }
      }
    });

    res.json({
      message: 'Claim status updated successfully',
      claim
    });

  } catch (error) {
    console.error('Update claim status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete claim
router.delete('/claims/:claimId', requireRole(['BILLER', 'ADMIN']), async (req, res) => {
  try {
    await prisma.claim.delete({
      where: { id: req.params.claimId }
    });

    res.json({ message: 'Claim deleted successfully' });

  } catch (error) {
    console.error('Delete claim error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
