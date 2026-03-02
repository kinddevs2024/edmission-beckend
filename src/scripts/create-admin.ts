/**
 * One-time script: create or update the default admin user (same as ensureDefaultAdmin at startup).
 * Run from backend directory: npm run create-admin
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { ensureDefaultAdmin } from '../services/auth.service';

async function main() {
  await connectDatabase();
  await ensureDefaultAdmin();
  console.log('Default admin ensured.');
  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
