-- Add systemPromptBase column to VerticalProfile
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "systemPromptBase" TEXT NOT NULL DEFAULT '';
