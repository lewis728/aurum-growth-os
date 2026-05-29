"use client";

/**
 * src/components/onboarding/CreativeUploader.tsx
 *
 * Shown when mode === 'upload'.
 * Drag-and-drop zone for the agency owner to upload their client's creative assets.
 *
 * Rules:
 *  - Accepted: JPEG, PNG, WebP images and MP4, MOV videos
 *  - Max 30 MB per image, 100 MB per video (enforced client-side before upload)
 *  - Max MAX_UPLOADED_ASSETS (3) assets per campaign — flat limit, no tiers
 *  - Upload progress bar per file
 *  - Image preview via <img>; video preview via <video> thumbnail
 *  - Remove button per asset
 */

import { useCallback, useRef, useState } from "react";
import { Upload, X, Film, ImageIcon, AlertCircle } from "lucide-react";
import { MAX_UPLOADED_ASSETS, type UploadedCreativeAsset } from "@/types/creativeLayer";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UploadingFile {
  id: string;
  fileName: string;
  progress: number;  // 0–100
  error?: string;
}

interface CreativeUploaderProps {
  /** Current uploaded assets (controlled) */
  assets: UploadedCreativeAsset[];
  /** Called when a new asset is successfully uploaded */
  onAssetAdded: (asset: UploadedCreativeAsset) => void;
  /** Called when an asset is removed */
  onAssetRemoved: (assetUrl: string) => void;
  /** Whether the uploader is disabled (e.g. campaign already launched) */
  disabled?: boolean;
}

// ── Accepted types ────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
];
const ACCEPTED_ACCEPT = ACCEPTED_TYPES.join(",");

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function isVideo(mimeType: string) {
  return mimeType === "video/mp4" || mimeType === "video/quicktime";
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreativeUploader({
  assets,
  onAssetAdded,
  onAssetRemoved,
  disabled = false,
}: CreativeUploaderProps) {
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const atLimit = assets.length >= MAX_UPLOADED_ASSETS;
  const canUpload = !disabled && !atLimit;

  // ── Upload a single file ──────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (file: File) => {
      // Client-side validation
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return;
      }
      const maxBytes = isVideo(file.type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      const maxLabel = isVideo(file.type) ? "100 MB" : "30 MB";

      const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (file.size > maxBytes) {
        setUploading((prev) => [
          ...prev,
          {
            id: uploadId,
            fileName: file.name,
            progress: 0,
            error: `File is ${humanSize(file.size)} — exceeds the ${maxLabel} limit. Please compress before uploading.`,
          },
        ]);
        // Auto-clear error after 6s
        setTimeout(() => {
          setUploading((prev) => prev.filter((u) => u.id !== uploadId));
        }, 6000);
        return;
      }

      // Add to uploading list at 0%
      setUploading((prev) => [
        ...prev,
        { id: uploadId, fileName: file.name, progress: 0 },
      ]);

      // Simulate progress ticks while awaiting fetch
      const progressInterval = setInterval(() => {
        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId && u.progress < 85
              ? { ...u, progress: u.progress + Math.random() * 15 }
              : u
          )
        );
      }, 300);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/creative/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(progressInterval);

        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
        }

        const data = (await res.json()) as {
          assetUrl: string;
          assetType: "image" | "video";
          fileName: string;
          fileSizeBytes: number;
        };

        // Mark 100%
        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, progress: 100 } : u
          )
        );

        // Short pause so user sees 100%
        await new Promise((r) => setTimeout(r, 400));

        // Remove from uploading list and add to assets
        setUploading((prev) => prev.filter((u) => u.id !== uploadId));
        onAssetAdded({
          assetUrl: data.assetUrl,
          assetType: data.assetType,
          fileName: data.fileName,
          uploadedAt: new Date().toISOString(),
        });
      } catch (err) {
        clearInterval(progressInterval);
        const msg = err instanceof Error ? err.message : "Upload failed";
        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, progress: 0, error: msg } : u
          )
        );
        setTimeout(() => {
          setUploading((prev) => prev.filter((u) => u.id !== uploadId));
        }, 6000);
      }
    },
    [onAssetAdded]
  );

  // ── Handle file input change ──────────────────────────────────────────────

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !canUpload) return;
      const remaining = MAX_UPLOADED_ASSETS - assets.length;
      Array.from(files)
        .slice(0, remaining)
        .forEach((f) => void uploadFile(f));
    },
    [assets.length, canUpload, uploadFile]
  );

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Heading */}
      <div>
        <h3 className="text-base font-semibold text-gray-900">
          Upload your client&apos;s creative assets
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          JPEG, PNG, WebP (max 30 MB) · MP4, MOV (max 100 MB) ·{" "}
          {MAX_UPLOADED_ASSETS - assets.length} slot
          {MAX_UPLOADED_ASSETS - assets.length !== 1 ? "s" : ""} remaining
        </p>
      </div>

      {/* Drop zone */}
      {canUpload && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload your client&apos;s creative assets — click or drag files here"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={[
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed",
            "cursor-pointer py-10 px-6 transition-all duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]",
            dragOver
              ? "border-[#C9A84C] bg-amber-50"
              : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white",
          ].join(" ")}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
            <Upload className="w-6 h-6" />
          </span>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">
              Drag and drop, or{" "}
              <span className="text-[#C9A84C] underline underline-offset-2">
                browse files
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Images and videos accepted
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
            tabIndex={-1}
          />
        </div>
      )}

      {/* Limit reached message */}
      {atLimit && !disabled && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Maximum {MAX_UPLOADED_ASSETS} assets per campaign reached. Remove an
            asset to upload a new one.
          </span>
        </div>
      )}

      {/* Uploading progress rows */}
      {uploading.map((u) => (
        <div
          key={u.id}
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 space-y-2"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700 truncate max-w-[70%]">
              {u.fileName}
            </span>
            {u.error ? (
              <span className="text-red-500 text-xs">{u.error}</span>
            ) : (
              <span className="text-gray-400 text-xs">
                {Math.round(u.progress)}%
              </span>
            )}
          </div>
          {!u.error && (
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#C9A84C] transition-all duration-300"
                style={{ width: `${u.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}

      {/* Uploaded asset cards */}
      {assets.length > 0 && (
        <div className="space-y-3">
          {assets.map((asset) => (
            <div
              key={asset.assetUrl}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3"
            >
              {/* Preview */}
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">
                {asset.assetType === "video" ? (
                  <video
                    src={asset.assetUrl}
                    className="h-full w-full object-cover"
                    muted
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={asset.assetUrl}
                    alt={asset.fileName}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {asset.fileName}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  {asset.assetType === "video" ? (
                    <Film className="w-3 h-3" />
                  ) : (
                    <ImageIcon className="w-3 h-3" />
                  )}
                  <span className="capitalize">{asset.assetType}</span>
                  <span>·</span>
                  <span>
                    Uploaded{" "}
                    {new Date(asset.uploadedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              </div>

              {/* Remove */}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onAssetRemoved(asset.assetUrl)}
                  aria-label={`Remove ${asset.fileName}`}
                  className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
