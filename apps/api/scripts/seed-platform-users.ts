// Run with: node --env-file=../../.env node_modules/tsx/dist/cli.mjs scripts/seed-platform-users.ts
// (from apps/api). Requires DATABASE_URL in environment.
//
// Seeds the two platform-level accounts (ADMIN, DEVELOPER). Upserts by
// email so it's safe to re-run. Passwords are hashed with the same
// PasswordService (argon2id) used for tenant user passwords -- never
// stored in plaintext. mustChangePassword is forced true: the seed
// passwords were shared in plaintext and should be rotated on first
// login.

import { prisma } from "@ibirdos/db";
import { PasswordService } from "../src/common/services/password.service";

const SEED_ACCOUNTS = [
  { email: "ans@ibirdos.com", password: "admin123456789", role: "ADMIN" as const },
  { email: "roshan@ibirdos.com", password: "roshan123456789", role: "DEVELOPER" as const },
];

async function main() {
  const passwords = new PasswordService();

  for (const acct of SEED_ACCOUNTS) {
    const passwordHash = await passwords.hash(acct.password);
    const user = await prisma.platformUser.upsert({
      where: { email: acct.email },
      update: {}, // do not touch an existing account's hash/role on re-run
      create: {
        email: acct.email,
        passwordHash,
        role: acct.role,
        mustChangePassword: true,
      },
    });
    console.log(`seeded ${user.email} (${user.role}), mustChangePassword=${user.mustChangePassword}`);
  }
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
