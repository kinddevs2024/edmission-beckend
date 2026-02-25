import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from '../src/models';

const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/edmission';

async function main() {
  await mongoose.connect(MONGODB_URI);
  const hash = await bcrypt.hash('admin123', 12);
  const admin = await User.findOneAndUpdate(
    { email: 'admin@edmission.local' },
    {
      email: 'admin@edmission.local',
      passwordHash: hash,
      role: 'admin',
      emailVerified: true,
    },
    { upsert: true, new: true }
  );
  console.log('Seed: admin user', admin._id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
