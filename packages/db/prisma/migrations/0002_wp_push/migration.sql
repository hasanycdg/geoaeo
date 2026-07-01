-- WordPress push model + public-file onboarding verification.
-- Additive, nullable columns only. Shopify tenants leave them null.
ALTER TABLE "Tenant" ADD COLUMN "storeProfile" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "catalog" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "verifyToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "verifiedAt" TIMESTAMP(3);
