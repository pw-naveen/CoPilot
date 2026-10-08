import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema, pg } from "./index";
import { hashPassword } from "../server/crypto";

/**
 * Test data: the four Mediwira directors, one admin, and one sub-admin scoped to two
 * of them. Safe to re-run; existing rows are left alone.
 */
const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").toLowerCase();
/** Development sign-in password for every seeded account. Override before seeding anywhere real. */
const seedPassword = process.env.SEED_PASSWORD || "copilot-dev-password";

const directors = [
  { name: "Dr Nanda", email: "nanda@example.com", phone: "+60120000001", title: "Director", specialty: "Cardiology" },
  { name: "Dr Ratna", email: "ratna@example.com", phone: "+60120000002", title: "Director", specialty: "Paediatrics" },
  { name: "Dr Mok", email: "mok@example.com", phone: "+60120000003", title: "Director", specialty: "Orthopaedics" },
  { name: "Dr Lavan", email: "lavan@example.com", phone: "+60120000004", title: "Director", specialty: "Public health" },
];

async function upsertStaff(email: string, name: string, role: "admin" | "subadmin", canInvite = false) {
  const found = await db.query.staff.findFirst({ where: eq(schema.staff.email, email) });
  if (found) {
    // Re-seeding an older database that predates password sign-in.
    if (!found.passwordHash)
      await db.update(schema.staff).set({ passwordHash: hashPassword(seedPassword) }).where(eq(schema.staff.id, found.id));
    return found;
  }
  const [s] = await db
    .insert(schema.staff)
    .values({ email, name, role, canInvite, passwordHash: hashPassword(seedPassword) })
    .returning();
  return s;
}

const admin = await upsertStaff(adminEmail, "Admin", "admin");
const sub = await upsertStaff("subadmin@example.com", "Sam (sub-admin)", "subadmin", true);

const users = [];
for (const d of directors) {
  let u = await db.query.users.findFirst({ where: eq(schema.users.email, d.email) });
  if (u && !u.passwordHash) {
    [u] = await db.update(schema.users).set({ passwordHash: hashPassword(seedPassword) }).where(eq(schema.users.id, u.id)).returning();
  }
  if (!u) {
    [u] = await db
      .insert(schema.users)
      .values({
        name: d.name,
        displayName: d.name,
        email: d.email,
        passwordHash: hashPassword(seedPassword),
        phoneE164: d.phone,
        title: d.title,
        org: "Mediwira",
        specialty: d.specialty,
        timezone: "Asia/Kuala_Lumpur",
        invitedBy: admin.id,
      })
      .returning();
  }
  users.push(u);
}

for (const u of users.slice(0, 2)) {
  await db.insert(schema.subadminAccounts).values({ staffId: sub.id, userId: u.id }).onConflictDoNothing();
}

console.log(`Seeded admin ${admin.email}, sub-admin ${sub.email} (scoped to ${users[0].displayName}, ${users[1].displayName}), ${users.length} directors.`);
console.log(`Sign-in password for all seeded accounts: ${seedPassword}`);
await pg.end();
