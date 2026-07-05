-- CreateTable
CREATE TABLE "DeepReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visibilityScore" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeepReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeepReport_tenantId_createdAt_idx" ON "DeepReport"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeepReport" ADD CONSTRAINT "DeepReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
