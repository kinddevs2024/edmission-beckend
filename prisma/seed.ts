import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@edmission.local' },
    create: {
      email: 'admin@edmission.local',
      passwordHash: hash,
      role: 'admin',
      emailVerified: true,
    },
    update: {},
  });
  console.log('Seed: admin user', admin.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
