const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const samplePhysicians = [
  {
    firstName: 'John',
    lastName: 'Smith',
    npi: '1234567890',
    specialty: 'Internal Medicine',
    phone: '(555) 123-4567',
    email: 'john.smith@hospital.com',
    address: '123 Medical Center Dr, City, State 12345'
  },
  {
    firstName: 'Sarah',
    lastName: 'Johnson',
    npi: '2345678901',
    specialty: 'Cardiology',
    phone: '(555) 234-5678',
    email: 'sarah.johnson@cardio.com',
    address: '456 Heart St, City, State 12345'
  },
  {
    firstName: 'Michael',
    lastName: 'Brown',
    npi: '3456789012',
    specialty: 'Orthopedics',
    phone: '(555) 345-6789',
    email: 'michael.brown@ortho.com',
    address: '789 Bone Ave, City, State 12345'
  },
  {
    firstName: 'Emily',
    lastName: 'Davis',
    npi: '4567890123',
    specialty: 'Neurology',
    phone: '(555) 456-7890',
    email: 'emily.davis@neuro.com',
    address: '321 Brain Blvd, City, State 12345'
  },
  {
    firstName: 'David',
    lastName: 'Wilson',
    npi: '5678901234',
    specialty: 'Dermatology',
    phone: '(555) 567-8901',
    email: 'david.wilson@derm.com',
    address: '654 Skin St, City, State 12345'
  },
  {
    firstName: 'Lisa',
    lastName: 'Anderson',
    npi: '6789012345',
    specialty: 'Pediatrics',
    phone: '(555) 678-9012',
    email: 'lisa.anderson@pediatrics.com',
    address: '987 Child Way, City, State 12345'
  },
  {
    firstName: 'Robert',
    lastName: 'Taylor',
    npi: '7890123456',
    specialty: 'Gastroenterology',
    phone: '(555) 789-0123',
    email: 'robert.taylor@gastro.com',
    address: '147 Digest Dr, City, State 12345'
  },
  {
    firstName: 'Jennifer',
    lastName: 'Thomas',
    npi: '8901234567',
    specialty: 'Pulmonology',
    phone: '(555) 890-1234',
    email: 'jennifer.thomas@pulmo.com',
    address: '258 Lung Ln, City, State 12345'
  },
  {
    firstName: 'Christopher',
    lastName: 'Jackson',
    npi: '9012345678',
    specialty: 'Urology',
    phone: '(555) 901-2345',
    email: 'christopher.jackson@uro.com',
    address: '369 Kidney Ct, City, State 12345'
  },
  {
    firstName: 'Amanda',
    lastName: 'White',
    npi: '0123456789',
    specialty: 'Endocrinology',
    phone: '(555) 012-3456',
    email: 'amanda.white@endo.com',
    address: '741 Hormone Hwy, City, State 12345'
  }
];

async function seedPhysicians() {
  try {
    console.log('Starting physician seeding...');

    // Clear existing physicians
    await prisma.physician.deleteMany({});
    console.log('Cleared existing physicians');

    // Create sample physicians
    for (const physician of samplePhysicians) {
      await prisma.physician.create({
        data: physician
      });
      console.log(`Created physician: ${physician.firstName} ${physician.lastName}`);
    }

    console.log('Physician seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding physicians:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedPhysicians();
