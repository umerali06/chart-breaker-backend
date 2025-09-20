const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const envPath = path.join(__dirname,  '.env');
console.log('Looking for .env at:', envPath);

require('dotenv').config({ path: envPath });
console.log('Loaded ENV:', process.env.DATABASE_URL, process.env.CLIENT_URL);


const nodemailer = require('nodemailer');

async function verifySMTP() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.verify();
    console.log("✅ SMTP configuration is valid, ready to send emails");
  } catch (err) {
    console.error("❌ SMTP verification failed:", err.message);
  }
}

verifySMTP();


// Initialize database connection after environment variables are loaded
const prisma = require('./database');

const authRoutes = require('./routes/auth');
const authVerificationRoutes = require('./routes/auth-verification');
const patientRoutes = require('./routes/patients');
const episodeRoutes = require('./routes/episodes');
const assessmentRoutes = require('./routes/assessments');
const visitRoutes = require('./routes/visits');
const scheduleRoutes = require('./routes/schedules');
const billingRoutes = require('./routes/billing');
const qaRoutes = require('./routes/qa');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const referralRoutes = require('./routes/referrals');
const physicianRoutes = require('./routes/physicians');
const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Basic rate limiting on auth and verification routes
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', authLimiter);
app.use('/api/auth-verification', authLimiter);

// CORS configuration for port 5000
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth-verification', authVerificationRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/episodes', episodeRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/physicians', physicianRoutes);
app.use('/api/documents', documentRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500,
      timestamp: new Date().toISOString()
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      status: 404,
      timestamp: new Date().toISOString()
    }
  });
});

app.listen(PORT, () => {
  console.log(`Chart Breaker EHR Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
