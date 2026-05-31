-- Schema drift fix: AgencyBranding email/sender/onboarding fields (all nullable).
ALTER TABLE "AgencyBranding" ADD COLUMN IF NOT EXISTS "supportEmail"             TEXT;
ALTER TABLE "AgencyBranding" ADD COLUMN IF NOT EXISTS "fromName"                 TEXT;
ALTER TABLE "AgencyBranding" ADD COLUMN IF NOT EXISTS "onboardingWelcomeMessage" TEXT;
