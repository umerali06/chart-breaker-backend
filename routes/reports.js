const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalPatients,
      activeEpisodes,
      pendingVisits,
      pendingClaims,
      pendingQaReviews,
      totalQaReviews
    ] = await Promise.all([
      prisma.patient.count(),
      prisma.episode.count({ where: { status: 'ACTIVE' } }),
      prisma.schedule.count({ where: { status: 'SCHEDULED' } }),
      prisma.claim.count({ where: { status: 'PENDING' } }),
      prisma.qaReview.count({ where: { status: 'PENDING' } }),
      prisma.qaReview.count()
    ]);

    console.log('Dashboard stats:', {
      totalPatients,
      activeEpisodes,
      pendingVisits,
      pendingClaims,
      pendingQaReviews,
      totalQaReviews
    });

    res.json({
      totalPatients,
      activeEpisodes,
      pendingVisits,
      pendingClaims,
      pendingQaReviews: totalQaReviews // Show total QA reviews instead of just pending
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent activity
router.get('/recent-activity', async (req, res) => {
  try {
    const recentActivity = [];

    // Get recent patients
    const recentPatients = await prisma.patient.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true
      }
    });

    recentPatients.forEach(patient => {
      recentActivity.push({
        id: `patient-${patient.id}`,
        type: 'patient',
        description: `New patient ${patient.firstName} ${patient.lastName} admitted`,
        timestamp: formatRelativeTime(patient.createdAt)
      });
    });

    // Get recent visits
    const recentVisits = await prisma.visitNote.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        patient: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        createdAt: true
      }
    });

    recentVisits.forEach(visit => {
      recentActivity.push({
        id: `visit-${visit.id}`,
        type: 'visit',
        description: `Visit completed for ${visit.patient.firstName} ${visit.patient.lastName}`,
        timestamp: formatRelativeTime(visit.createdAt)
      });
    });

    // Get recent assessments
    const recentAssessments = await prisma.oasisAssessment.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        isSigned: true,
        createdAt: true
      }
    });

    recentAssessments.forEach(assessment => {
      recentActivity.push({
        id: `assessment-${assessment.id}`,
        type: 'assessment',
        description: assessment.isSigned ? 'OASIS assessment signed' : 'OASIS assessment created',
        timestamp: formatRelativeTime(assessment.createdAt)
      });
    });

    // Get recent claims
    const recentClaims = await prisma.claim.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true
      }
    });

    recentClaims.forEach(claim => {
      recentActivity.push({
        id: `claim-${claim.id}`,
        type: 'claim',
        description: `Claim ${claim.status.toLowerCase()} to Medicare`,
        timestamp: formatRelativeTime(claim.createdAt)
      });
    });

    // Sort by timestamp (most recent first) and limit to 10
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    recentActivity.splice(10);

    res.json(recentActivity);

  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to format relative time
function formatRelativeTime(date) {
  const now = new Date();
  const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
  
  if (diffInHours < 1) {
    return 'Just now';
  } else if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  } else {
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  }
}

// Get productivity report
router.get('/productivity', requireRole(['ADMIN', 'QA_REVIEWER']), async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // Get visit notes with clinician details
    const visitNotes = await prisma.visitNote.findMany({
      where: {
        visitDate: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        clinician: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            staffProfile: {
              select: {
                discipline: true,
                employeeId: true
              }
            }
          }
        },
        patient: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        visitDate: 'desc'
      }
    });

    // Group by clinician and calculate statistics
    const productivity = visitNotes.reduce((acc, visit) => {
      const clinicianId = visit.clinicianId;
      if (!acc[clinicianId]) {
        acc[clinicianId] = {
          clinician: visit.clinician,
          totalVisits: 0,
          visits: [],
          averageVisitDuration: 0
        };
      }
      acc[clinicianId].totalVisits++;
      acc[clinicianId].visits.push(visit);
      return acc;
    }, {});

    // Calculate average visit duration for each clinician
    Object.values(productivity).forEach(clinician => {
      if (clinician.visits.length > 0) {
        const totalDuration = clinician.visits.reduce((sum, visit) => {
          return sum + (visit.visitDurationMinutes || 0);
        }, 0);
        clinician.averageVisitDuration = Math.round(totalDuration / clinician.visits.length);
      }
    });

    res.json({ productivity: Object.values(productivity) });

  } catch (error) {
    console.error('Get productivity report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get patient census report
router.get('/patient-census', async (req, res) => {
  try {
    const patients = await prisma.patient.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zipCode: true,
        phone: true,
        email: true,
        createdAt: true,
        episodes: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true
          }
        }
      },
      orderBy: {
        lastName: 'asc'
      }
    });

    // Transform the data to include a formatted address
    const transformedPatients = patients.map(patient => ({
      ...patient,
      address: [
        patient.addressLine1,
        patient.addressLine2,
        patient.city,
        patient.state,
        patient.zipCode
      ].filter(Boolean).join(', ')
    }));

    res.json({ patients: transformedPatients });

  } catch (error) {
    console.error('Get patient census error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get episode summary report
router.get('/episode-summary', async (req, res) => {
  try {
    const episodes = await prisma.episode.findMany({
      select: {
        id: true,
        episodeNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        disciplines: true,
        patient: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        startDate: 'desc'
      }
    });

    // Transform the data to include a primary discipline
    const transformedEpisodes = episodes.map(episode => ({
      ...episode,
      discipline: Array.isArray(episode.disciplines) && episode.disciplines.length > 0 
        ? episode.disciplines[0] 
        : 'Unknown'
    }));

    res.json({ episodes: transformedEpisodes });

  } catch (error) {
    console.error('Get episode summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get billing summary report
router.get('/billing-summary', async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      select: {
        id: true,
        claimNumber: true,
        status: true,
        claimAmount: true,
        submissionDate: true,
        createdAt: true,
        patient: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        payer: {
          select: {
            payerName: true,
            payerType: true
          }
        },
        episode: {
          select: {
            episodeNumber: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform the data to include amount as a number and correct payer fields
    const transformedClaims = claims.map(claim => ({
      ...claim,
      amount: claim.claimAmount ? parseFloat(claim.claimAmount.toString()) : 0,
      payer: {
        name: claim.payer.payerName,
        category: claim.payer.payerType
      }
    }));

    res.json({ claims: transformedClaims });

  } catch (error) {
    console.error('Get billing summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get QA compliance report
router.get('/qa-compliance', async (req, res) => {
  try {
    const qaReviews = await prisma.qaReview.findMany({
      include: {
        reviewer: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate compliance statistics
    const totalReviews = qaReviews.length;
    const approvedReviews = qaReviews.filter(review => review.status === 'APPROVED').length;
    const pendingReviews = qaReviews.filter(review => review.status === 'PENDING').length;
    const rejectedReviews = qaReviews.filter(review => review.status === 'REJECTED').length;
    
    const complianceRate = totalReviews > 0 ? Math.round((approvedReviews / totalReviews) * 100) : 0;

    // Group by deficiency type
    const deficiencyStats = qaReviews.reduce((acc, review) => {
      if (review.deficiencies && Array.isArray(review.deficiencies)) {
        review.deficiencies.forEach(deficiency => {
          const category = deficiency.category || 'Other';
          if (!acc[category]) {
            acc[category] = 0;
          }
          acc[category]++;
        });
      }
      return acc;
    }, {});

    res.json({ 
      qaReviews,
      statistics: {
        totalReviews,
        approvedReviews,
        pendingReviews,
        rejectedReviews,
        complianceRate
      },
      deficiencyStats
    });

  } catch (error) {
    console.error('Get QA compliance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get OASIS export data
router.get('/oasis-export', async (req, res) => {
  try {
    const assessments = await prisma.oasisAssessment.findMany({
      where: {
        isSigned: true
      },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            ssn: true
          }
        },
        episode: {
          select: {
            episodeNumber: true,
            startDate: true,
            endDate: true
          }
        }
      },
      orderBy: {
        signedAt: 'desc'
      }
    });

    // Transform data for OASIS export format
    const oasisData = assessments.map(assessment => ({
      assessmentId: assessment.id,
      patientName: `${assessment.patient.firstName} ${assessment.patient.lastName}`,
      patientDOB: assessment.patient.dateOfBirth,
      patientSSN: assessment.patient.ssn,
      episodeNumber: assessment.episode?.episodeNumber || 'N/A',
      assessmentType: assessment.assessmentType,
      assessmentDate: assessment.assessmentDate,
      signedDate: assessment.signedAt,
      isSigned: assessment.isSigned,
      // Include all OASIS fields for export
      ...assessment
    }));

    res.json({ assessments: oasisData });

  } catch (error) {
    console.error('Get OASIS export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
