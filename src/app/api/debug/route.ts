import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const errors: string[] = [];
  
  // Test 1: Prisma connection
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    errors.push("Prisma: OK");
  } catch (e) {
    errors.push(`Prisma: FAILED - ${String(e).slice(0, 200)}`);
  }
  
  // Test 2: Clerk
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    errors.push(`Clerk: OK (userId=${userId ?? "null"})`);
  } catch (e) {
    errors.push(`Clerk: FAILED - ${String(e).slice(0, 200)}`);
  }
  
  // Test 3: OpenAI key
  errors.push(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "SET" : "MISSING"}`);
  errors.push(`DATABASE_URL: ${process.env.DATABASE_URL ? "SET" : "MISSING"}`);
  errors.push(`CLERK_SECRET_KEY: ${process.env.CLERK_SECRET_KEY ? "SET" : "MISSING"}`);
  
  return NextResponse.json({ status: "debug", checks: errors });
}
