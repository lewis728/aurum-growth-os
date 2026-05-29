/**
 * src/lib/services/storageService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Handles all Supabase Storage operations for client creative assets.
 * Bucket: 'creatives' (private — signed URLs only)
 * Path pattern: {tenantId}/{timestamp}_{filename}
 *
 * Requires:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Server-only service role key
 */

import { createClient } from "@supabase/supabase-js";

// ── Constants ─────────────────────────────────────────────────────────────────

const BUCKET = "creatives";

/** Signed URL TTL: 1 year in seconds */
const SIGNED_URL_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Accepted MIME types */
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

/** Size limits in bytes */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;   // 30 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB

// ── Supabase client factory ───────────────────────────────────────────────────

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "storageService: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
      "Add them to your environment variables to enable creative asset uploads."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Uploads a creative asset to Supabase Storage.
 *
 * @param file     - The File object from multipart/form-data
 * @param tenantId - Clerk org ID — used as the top-level path prefix
 * @returns        - Signed URL valid for 1 year
 */
export async function uploadCreativeAsset(
  file: File,
  tenantId: string
): Promise<string> {
  // ── Validate MIME type ────────────────────────────────────────────────────
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type}". ` +
      "Accepted formats: JPEG, PNG, WebP images and MP4, MOV videos."
    );
  }

  // ── Validate size ─────────────────────────────────────────────────────────
  const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const maxLabel = isVideo ? "100 MB" : "30 MB";

  if (file.size > maxBytes) {
    const fileSizeMb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `File "${file.name}" is ${fileSizeMb} MB — exceeds the ${maxLabel} limit for ` +
      `${isVideo ? "video" : "image"} assets. Please compress or trim the file before uploading.`
    );
  }

  // ── Build storage path ────────────────────────────────────────────────────
  const timestamp = Date.now();
  // Sanitise filename: replace spaces and special chars with underscores
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${tenantId}/${timestamp}_${safeFilename}`;

  // ── Upload ────────────────────────────────────────────────────────────────
  const supabase = getSupabaseClient();
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, uint8, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(
      `Failed to upload "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB): ` +
      uploadError.message
    );
  }

  // ── Generate signed URL ───────────────────────────────────────────────────
  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signError || !signedData?.signedUrl) {
    throw new Error(
      `File "${file.name}" uploaded successfully but failed to generate signed URL: ` +
      (signError?.message ?? "Unknown error")
    );
  }

  return signedData.signedUrl;
}

/**
 * Deletes a creative asset from Supabase Storage.
 * Never throws — logs error and continues.
 *
 * @param assetPath - The storage path (e.g. "{tenantId}/{timestamp}_{filename}")
 */
export async function deleteCreativeAsset(assetPath: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(BUCKET).remove([assetPath]);
    if (error) {
      console.warn(`[storageService] deleteCreativeAsset failed for "${assetPath}":`, error.message);
    }
  } catch (err) {
    console.warn(
      `[storageService] deleteCreativeAsset unexpected error for "${assetPath}":`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Returns a fresh signed URL for an existing creative asset.
 * Used when Meta needs the asset URL at campaign launch time.
 *
 * @param assetPath - The storage path (e.g. "{tenantId}/{timestamp}_{filename}")
 * @returns         - Fresh signed URL valid for 1 year
 */
export async function getSignedUrl(assetPath: string): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(assetPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to generate signed URL for asset "${assetPath}": ` +
      (error?.message ?? "Unknown error")
    );
  }

  return data.signedUrl;
}
