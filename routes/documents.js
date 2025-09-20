const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const Joi = require('joi');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only documents, images, and PDFs are allowed'));
    }
  }
});

// Validation schemas
const createDocumentSchema = Joi.object({
  patientId: Joi.string().required(),
  documentType: Joi.string().valid(
    'OASIS', 'VISIT_NOTE', 'CARE_PLAN', 'ORDER', 'MEDICAL_RECORD',
    'INSURANCE_CARD', 'IDENTIFICATION', 'CONSENT_FORM', 'ASSESSMENT',
    'PHYSICIAN_ORDER', 'LAB_RESULT', 'IMAGING', 'OTHER'
  ).required(),
  description: Joi.string().max(500).optional()
});

const updateDocumentSchema = Joi.object({
  documentType: Joi.string().valid(
    'OASIS', 'VISIT_NOTE', 'CARE_PLAN', 'ORDER', 'MEDICAL_RECORD',
    'INSURANCE_CARD', 'IDENTIFICATION', 'CONSENT_FORM', 'ASSESSMENT',
    'PHYSICIAN_ORDER', 'LAB_RESULT', 'IMAGING', 'OTHER'
  ).optional(),
  description: Joi.string().max(500).optional(),
  isActive: Joi.boolean().optional()
});

// Get all documents for a patient
router.get('/patient/:patientId', authenticateToken, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 10, documentType, search } = req.query;

    const where = {
      patientId,
      isActive: true
    };

    if (documentType) {
      where.documentType = documentType;
    }

    if (search) {
      where.OR = [
        { originalName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const documents = await prisma.document.findMany({
      where,
      include: {
        uploadedByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: (page - 1) * limit,
      take: parseInt(limit)
    });

    const total = await prisma.document.count({ where });

    res.json({
      success: true,
      data: documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message
    });
  }
});

// Get all documents (global view)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, documentType, search, patientId } = req.query;

    const where = {
      isActive: true
    };

    if (documentType) {
      where.documentType = documentType;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    if (search) {
      where.OR = [
        { originalName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { patient: { 
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { patientId: { contains: search, mode: 'insensitive' } }
          ]
        }}
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              patientId: true
            }
          },
          uploadedByUser: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.document.count({ where })
    ]);


    res.json({
      success: true,
      data: documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message
    });
  }
});

// Get single document
router.get('/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            patientId: true
          }
        },
        uploadedByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });


    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document',
      error: error.message
    });
  }
});

// Upload new document
router.post('/upload', authenticateToken, requireRole(['ADMIN', 'INTAKE_STAFF', 'CLINICIAN']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { error, value } = createDocumentSchema.validate(req.body);
    
    if (error) {
      // Clean up uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      
      const friendlyErrors = error.details.map(detail => {
        const field = detail.path[0];
        const message = detail.message;
        
        if (message.includes('is required')) {
          return `${field.charAt(0).toUpperCase() + field.slice(1)} is required`;
        }
        if (message.includes('must be one of')) {
          return 'Please select a valid document type';
        }
        if (message.includes('length must be at most 500 characters long')) {
          return 'Description is too long (maximum 500 characters)';
        }
        
        return message.replace(/"/g, '');
      });
      
      return res.status(400).json({
        success: false,
        message: 'Please fix the following errors:',
        errors: friendlyErrors
      });
    }

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: value.patientId }
    });

    if (!patient) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Debug logging
    console.log('Document upload data:', {
      patientId: value.patientId,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      filePath: req.file.path,
      documentType: value.documentType,
      description: value.description,
      uploadedBy: req.user?.userId || req.user?.id
    });

    const document = await prisma.document.create({
      data: {
        patientId: value.patientId,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        filePath: req.file.path,
        documentType: value.documentType,
        description: value.description,
        uploadedBy: req.user?.userId || req.user?.id
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            patientId: true
          }
        },
        uploadedByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: document
    });
  } catch (error) {
    // Clean up uploaded file if database operation fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('Error uploading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
});

// Update document
router.put('/:documentId', authenticateToken, requireRole(['ADMIN', 'INTAKE_STAFF', 'CLINICIAN']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const { error, value } = updateDocumentSchema.validate(req.body);
    
    if (error) {
      const friendlyErrors = error.details.map(detail => {
        const field = detail.path[0];
        const message = detail.message;
        
        if (message.includes('must be one of')) {
          return 'Please select a valid document type';
        }
        if (message.includes('length must be at most 500 characters long')) {
          return 'Description is too long (maximum 500 characters)';
        }
        
        return message.replace(/"/g, '');
      });
      
      return res.status(400).json({
        success: false,
        message: 'Please fix the following errors:',
        errors: friendlyErrors
      });
    }

    // Check if document exists
    const existingDocument = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    const document = await prisma.document.update({
      where: { id: documentId },
      data: value,
      include: {
        uploadedByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: document
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message
    });
  }
});

// Download document
router.get('/:documentId/download', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (!fs.existsSync(document.filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    res.download(document.filePath, document.originalName);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message
    });
  }
});

// Delete document (soft delete)
router.delete('/:documentId', authenticateToken, requireRole(['ADMIN', 'INTAKE_STAFF', 'CLINICIAN']), async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Soft delete
    await prisma.document.update({
      where: { id: documentId },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message
    });
  }
});

// Get document types
router.get('/types/list', authenticateToken, async (req, res) => {
  try {
    const documentTypes = [
      { value: 'OASIS', label: 'OASIS Assessment' },
      { value: 'VISIT_NOTE', label: 'Visit Note' },
      { value: 'CARE_PLAN', label: 'Care Plan' },
      { value: 'ORDER', label: 'Order' },
      { value: 'MEDICAL_RECORD', label: 'Medical Record' },
      { value: 'INSURANCE_CARD', label: 'Insurance Card' },
      { value: 'IDENTIFICATION', label: 'Identification' },
      { value: 'CONSENT_FORM', label: 'Consent Form' },
      { value: 'ASSESSMENT', label: 'Assessment' },
      { value: 'PHYSICIAN_ORDER', label: 'Physician Order' },
      { value: 'LAB_RESULT', label: 'Lab Result' },
      { value: 'IMAGING', label: 'Imaging' },
      { value: 'OTHER', label: 'Other' }
    ];

    res.json({
      success: true,
      data: documentTypes
    });
  } catch (error) {
    console.error('Error fetching document types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document types',
      error: error.message
    });
  }
});

module.exports = router;
