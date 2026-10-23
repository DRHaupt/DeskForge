-- Onboarding: track when users finished /welcome and when MFA was confirmed.
ALTER TABLE "users" ADD COLUMN "onboarded_at" TIMESTAMP(3),
ADD COLUMN "mfa_verified_at" TIMESTAMP(3),
ADD COLUMN "mfa_verified_via" TEXT;
