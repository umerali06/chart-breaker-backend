const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);


// Get all users (for staff selection)
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          in: ['CLINICIAN', 'INTAKE_STAFF', 'ADMIN']
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        staffProfile: {
          select: {
            discipline: true,
            employeeId: true
          }
        }
      },
      orderBy: {
        firstName: 'asc'
      }
    });

    res.json({
      users
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users for admin management
router.get('/admin', requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
        staffProfile: {
          select: {
            discipline: true,
            employeeId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      users
    });

  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user status (activate/deactivate)
router.patch('/:userId/status', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true
      }
    });

    res.json({
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role
router.patch('/:userId/role', requireRole(['ADMIN']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true
      }
    });

    res.json({
      message: 'User role updated successfully',
      user
    });

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

