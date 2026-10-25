# Go Hard Backend

Wedding escrow fintech app protecting couples from losing deposits to vendors.

## Stack
- Node.js + Express
- Prisma ORM + PostgreSQL
- Stripe Connect for payments
- JWT authentication
- Deployed on Railway

## File Structure
- `server.js` - All API routes
- `prisma/schema.prisma` - Database schema
- `middleware/auth.js` - JWT token verification

## Key Patterns
- All money amounts stored in cents (amountCents, not dollars)
- JWT tokens expire in 7 days
- User types: CUSTOMER, VENDOR, BOTH
- RFP visibility: PUBLIC or PRIVATE (with invitedVendorIds)

## API Route Order Matters
Static routes MUST come before dynamic routes:
- `/rfps/my` and `/rfps/browse` BEFORE `/rfps/:rfpId`
- `/bids/my` BEFORE `/bids/:bidId`

## Main Flows
1. **Escrow**: Customer creates project → adds vendor → creates escrow with milestones → funds via Stripe → releases milestones
2. **RFP**: Customer posts RFP → vendors browse and bid → customer accepts bid → vendor added to project

## Environment Variables
- DATABASE_URL
- JWT_SECRET
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET

## Deployment
Merge to `main` → Railway auto-deploys to production
Migrations: `prisma migrate deploy` runs on startup (in package.json start script).
Schema changes need a migration file in `prisma/migrations/` — don't use `db push` against production.

## Git Workflow
- `main` = production. Never push to it directly (it isn't branch-protected, so this is by convention)
- Branch off `main` for each change: `feat/...`, `fix/...`, `chore/...`
- Open a PR into `main`, review the diff, merge to deploy; delete the branch after
- Keep API changes backward compatible with the iOS app version already in users' hands
- No Claude/AI attribution lines in commits or PRs