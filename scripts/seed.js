const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@chartbreaker.com' },
    update: {},
    create: {
      email: 'admin@chartbreaker.com',
      passwordHash: adminPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'ADMIN',
      isActive: true
    }
  });

  // Create sample users for each role
  const intakePassword = await bcrypt.hash('intake123', 12);
  const intakeUser = await prisma.user.upsert({
    where: { email: 'intake@chartbreaker.com' },
    update: {},
    create: {
      email: 'intake@chartbreaker.com',
      passwordHash: intakePassword,
      firstName: 'Jane',
      lastName: 'Smith',
      role: 'INTAKE_STAFF',
      isActive: true
    }
  });

  const clinicianPassword = await bcrypt.hash('clinician123', 12);
  const clinician = await prisma.user.upsert({
    where: { email: 'nurse@chartbreaker.com' },
    update: {},
    create: {
      email: 'nurse@chartbreaker.com',
      passwordHash: clinicianPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: 'CLINICIAN',
      isActive: true
    }
  });

  const qaPassword = await bcrypt.hash('qa123456', 12);
  const qaUser = await prisma.user.upsert({
    where: { email: 'qa@chartbreaker.com' },
    update: {},
    create: {
      email: 'qa@chartbreaker.com',
      passwordHash: qaPassword,
      firstName: 'Michael',
      lastName: 'Brown',
      role: 'QA_REVIEWER',
      isActive: true
    }
  });

  const billerPassword = await bcrypt.hash('biller123', 12);
  const biller = await prisma.user.upsert({
    where: { email: 'biller@chartbreaker.com' },
    update: {},
    create: {
      email: 'biller@chartbreaker.com',
      passwordHash: billerPassword,
      firstName: 'Lisa',
      lastName: 'Davis',
      role: 'BILLER',
      isActive: true
    }
  });

  // Create staff profiles
  await prisma.staffProfile.upsert({
    where: { userId: clinician.id },
    update: {},
    create: {
      userId: clinician.id,
      employeeId: 'EMP001',
      discipline: 'SN',
      licenseNumber: 'RN123456',
      licenseExpiry: new Date('2025-12-31'),
      credentials: {
        certifications: ['RN', 'BSN'],
        specialties: ['Home Health', 'Wound Care']
      },
      competencies: {
        skills: ['OASIS Assessment', 'Wound Care', 'Medication Management']
      }
    }
  });

  // Create sample payers
  const medicare = await prisma.payer.create({
    data: {
      payerName: 'Medicare',
      payerType: 'MEDICARE',
      payerId: 'MED001',
      contactInfo: {
        phone: '1-800-MEDICARE',
        address: '7500 Security Boulevard, Baltimore, MD 21244'
      },
      feeSchedule: {
        'SN': 150.00,
        'PT': 120.00,
        'OT': 120.00,
        'ST': 120.00,
        'MSW': 100.00,
        'HHA': 80.00
      }
    }
  });

  const medicaid = await prisma.payer.create({
    data: {
      payerName: 'Colorado Medicaid',
      payerType: 'MEDICAID',
      payerId: 'CO_MED001',
      contactInfo: {
        phone: '1-800-221-3943',
        address: '1570 Grant Street, Denver, CO 80203'
      },
      feeSchedule: {
        'SN': 140.00,
        'PT': 110.00,
        'OT': 110.00,
        'ST': 110.00,
        'MSW': 90.00,
        'HHA': 70.00
      }
    }
  });

  // Create sample patient
  const patient = await prisma.patient.upsert({
    where: { patientId: 'P001' },
    update: {},
    create: {
      patientId: 'P001',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: new Date('1950-05-15'),
      gender: 'M',
      ssn: '123-45-6789',
      addressLine1: '123 Main Street',
      city: 'Denver',
      state: 'CO',
      zipCode: '80202',
      phone: '303-555-0123',
      email: 'john.doe@email.com',
      primaryLanguage: 'English',
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '303-555-0124',
      emergencyContactRelationship: 'Spouse',
      createdBy: intakeUser.id
    }
  });

  // Create sample episode
  const episode = await prisma.episode.upsert({
    where: { episodeNumber: 'E001' },
    update: {},
    create: {
      patientId: patient.id,
      episodeNumber: 'E001',
      startDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      disciplines: ['SN', 'PT'],
      frequencyPerWeek: 3,
      visitDurationMinutes: 60,
      careGoals: 'Improve mobility and manage diabetes',
      createdBy: intakeUser.id
    }
  });

  // Create sample authorization
  await prisma.authorization.create({
    data: {
      patientId: patient.id,
      episodeId: episode.id,
      payerId: medicare.id,
      authNumber: 'AUTH001',
      authStartDate: new Date('2024-01-01'),
      authEndDate: new Date('2024-03-31'),
      visitsAuthorized: 36,
      visitsUsed: 0
    }
  });

  console.log('Database seeding completed successfully!');
  console.log('\nSample login credentials:');
  console.log('Admin: admin@chartbreaker.com / admin123');
  console.log('Intake: intake@chartbreaker.com / intake123');
  console.log('Clinician: nurse@chartbreaker.com / clinician123');
  console.log('QA: qa@chartbreaker.com / qa123456');
  console.log('Biller: biller@chartbreaker.com / biller123');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
