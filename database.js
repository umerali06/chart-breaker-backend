const { PrismaClient } = require('@prisma/client');

// Create a single Prisma client instance
const prisma = new PrismaClient();

module.exports = prisma;
