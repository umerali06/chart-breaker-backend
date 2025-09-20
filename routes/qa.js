const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get QA reviews
router.get('/reviews', requireRole(['QA_REVIEWER', 'ADMIN']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;

    const [reviews, total] = await Promise.all([
      prisma.qaReview.findMany({
        where,
        include: {
          reviewer: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.qaReview.count({ where })
    ]);

    res.json({
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    console.error('Get QA reviews error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create QA review
router.post('/reviews', requireRole(['QA_REVIEWER', 'ADMIN']), async (req, res) => {
  try {
    const { documentId, documentType, status, deficiencies, comments } = req.body;

    const review = await prisma.qaReview.create({
      data: {
        documentId,
        documentType,
        reviewerId: req.user.id,
        reviewDate: new Date(),
        status: status || 'PENDING',
        deficiencies,
        comments
      },
      include: {
        reviewer: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.status(201).json({
      message: 'QA review created successfully',
      review
    });

  } catch (error) {
    console.error('Create QA review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single QA review
router.get('/reviews/:reviewId', requireRole(['QA_REVIEWER', 'ADMIN']), async (req, res) => {
  try {
    const review = await prisma.qaReview.findUnique({
      where: { id: req.params.reviewId },
      include: {
        reviewer: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    if (!review) {
      return res.status(404).json({ error: 'QA review not found' });
    }

    res.json({ review });

  } catch (error) {
    console.error('Get QA review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update QA review
router.put('/reviews/:reviewId', requireRole(['QA_REVIEWER', 'ADMIN']), async (req, res) => {
  try {
    const { documentId, documentType, status, deficiencies, comments } = req.body;

    const review = await prisma.qaReview.update({
      where: { id: req.params.reviewId },
      data: {
        documentId,
        documentType,
        status,
        deficiencies,
        comments
      },
      include: {
        reviewer: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.json({
      message: 'QA review updated successfully',
      review
    });

  } catch (error) {
    console.error('Update QA review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete QA review
router.delete('/reviews/:reviewId', requireRole(['QA_REVIEWER', 'ADMIN']), async (req, res) => {
  try {
    await prisma.qaReview.delete({
      where: { id: req.params.reviewId }
    });

    res.json({ message: 'QA review deleted successfully' });

  } catch (error) {
    console.error('Delete QA review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
