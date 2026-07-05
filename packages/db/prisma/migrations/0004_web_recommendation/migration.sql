-- AlterEnum: add WEB recommendation type (site-level technical checks)
ALTER TYPE "RecommendationType" ADD VALUE IF NOT EXISTS 'WEB';
