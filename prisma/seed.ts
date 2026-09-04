import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedSamplePractice } from '../lib/sample-practice'

const prisma = new PrismaClient()

/**
 * A workspace you can sign into.
 *
 * This used to build a whole clinic — providers, patients, appointments,
 * encounters, diagnoses, procedures, claims — for the EHR pages. Those pages
 * are gone and so are their tables. What a developer needs now is an account
 * that lands somewhere real, which means an organization (orgProcedure refuses
 * every query without one) and something in it to look at.
 *
 * The data itself comes from lib/sample-practice.ts — the same seeding a new
 * customer's workspace gets on signup, arriving as an ImportBatch flagged
 * isSample and read through the identical queries as a real upload. There is no
 * separate demo dataset to keep in step, which is the point.
 *
 * Idempotent: safe to re-run, and it repairs the orgId on accounts created
 * before workspaces existed.
 */

const ORG_NAME = 'Yeam Demo Clinic'
const PASSWORD = 'demo1234'

const USERS = [
  { email: 'admin@yeam.demo', name: 'Admin User', role: 'ADMIN' },
  { email: 'billing@yeam.demo', name: 'James Okafor', role: 'BILLING' },
  { email: 'frontdesk@yeam.demo', name: 'Maria Lopez', role: 'FRONT_DESK' },
  { email: 'provider@yeam.demo', name: 'Dr. Sarah Chen', role: 'PROVIDER' },
] as const

async function main() {
  console.log('Seeding the demo workspace...')

  const passwordHash = await bcrypt.hash(PASSWORD, 12)

  const org =
    (await prisma.organization.findFirst({ where: { name: ORG_NAME } })) ??
    (await prisma.organization.create({ data: { name: ORG_NAME } }))

  for (const user of USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      // Repairs accounts seeded before organizations existed. Without an orgId
      // every section is a dead end, and it reads as a product decision rather
      // than the one-column auth bug it is.
      update: { orgId: org.id },
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
        orgId: org.id,
        role: user.role,
      },
    })
  }

  const rows = await seedSamplePractice(prisma, org.id)
  console.log(
    rows > 0
      ? `Seeded the sample practice (${rows} rows).`
      : 'Sample practice already present, left alone.',
  )

  console.log(`\n${USERS.length} logins, all with the password "${PASSWORD}":`)
  for (const user of USERS) console.log(`  ${user.email}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
