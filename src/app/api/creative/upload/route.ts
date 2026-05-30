/**
 * src/app/api/creative/upload/route.ts
 * POST /api/creative/upload
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Accepts multipart/form-data with a single 'file' field.
 * Validates, uploads to Supabase Storage, and returns a signed URL.
 *
 * Response shapes:
 *   200 { assetUrl, assetType: 'image' | 'video', fileName, fileSizeBytes }
 *   400 { error: string }
 *   401 { error: string }
 *   413 { error: string }
 *   415 { error: string }
 *   502 { error: string }
 */
import { auth } from "@clerk/nextjs/server";

import { NextRequest, NextResponse } from "next/server";
import { uploadCreativeAsset } from "@/lib/services/storageService";

export const dynamic = "force-dynamic";

// ── Accepted MIME types (mirrored from storageService for early rejection) ────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ACCEPTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
]);
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // ── 2. Parse multipart/form-data ───────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Failed to parse form data. Ensure Content-Type is multipart/form-data." },
      { status: 400 }
    );
  }

  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided. Send a 'file' field in multipart/form-data." },
      { status: 400 }
    );
  }

  // ── 3. Early MIME type check ───────────────────────────────────────────────
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          `Unsupported file type "${file.type}". ` +
          "Accepted formats: JPEG, PNG, WebP images and MP4, MOV videos.",
      },
      { status: 415 }
    );
  }

  // ── 4. Early size check ────────────────────────────────────────────────────
  const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type);
  const maxBytes = isVideo ? 100 * 1024 * 1024 : 30 * 1024 * 1024;
  const maxLabel = isVideo ? "100 MB" : "30 MB";

  if (file.size > maxBytes) {
    const fileSizeMb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      {
        error:
          `File "${file.name}" is ${fileSizeMb} MB — exceeds the ${maxLabel} limit for ` +
          `${isVideo ? "video" : "image"} assets. Please compress or trim the file before uploading.`,
      },
      { status: 413 }
    );
  }

  // ── 5. Upload to Supabase Storage ──────────────────────────────────────────
  let assetUrl: string;
  try {
    assetUrl = await uploadCreativeAsset(file, tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    console.error("[creative/upload] storageService.uploadCreativeAsset failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── 6. Return typed response ───────────────────────────────────────────────
  const assetType: "image" | "video" = isVideo ? "video" : "image";

  return NextResponse.json(
    {
      assetUrl,
      assetType,
      fileName: file.name,
      fileSizeBytes: file.size,
    },
    { status: 200 }
  );
}
