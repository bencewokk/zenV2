import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GridFSBucket } from "mongodb";
import { once } from "node:events";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { getDb } from "../_lib/db.js";
import { enforceRequestRateLimit, positiveEnvInt } from "../_lib/limits.js";

/**
 * PDF binaries live in a GridFS bucket, keyed by `<userId>/<id>` so a user can only
 * ever reach their own blobs. Metadata syncs through the normal /api/sync/pdfs route;
 * this endpoint moves only the bytes.
 *
 * Note: serverless body-size limits apply. Large PDFs may need chunked upload or a
 * higher-limit host — see the plan's Part 1 caveat.
 */
export const config = { api: { bodyParser: false } };

function key(userId: string, id: string): string {
  return `${userId}/${id}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  let userId: string;
  try {
    userId = await userIdFromRequest(req.headers.authorization);
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try { await enforceRequestRateLimit(userId, "pdf", 90); }
  catch (error) { const typed = error as Error & { status?: number; code?: string }; res.status(typed.status ?? 429).json({ error: typed.message, code: typed.code }); return; }

  const id = String(req.query.id || "");
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }

  const db = await getDb();
  const bucket = new GridFSBucket(db, { bucketName: "pdfs" });
  const filename = key(userId, id);

  if (req.method === "PUT") {
    const uploadId = queryString(req.query.uploadId);
    const part = queryInt(req.query.part);
    const parts = queryInt(req.query.parts);
    const maxParts = positiveEnvInt("PDF_MAX_UPLOAD_PARTS", 40);
    if (!uploadId || !/^[\w-]{8,80}$/.test(uploadId) || part < 0 || parts < 1 || parts > maxParts || part >= parts) {
      res.status(400).json({ error: "invalid upload part" });
      return;
    }

    const partName = uploadPartName(filename, uploadId, part);
    await deleteByFilename(bucket, partName);
    try {
      await storeRequest(bucket, partName, req, { userId, id, uploadId, part }, positiveEnvInt("PDF_MAX_PART_BYTES", 3_500_000));
    } catch (error) {
      await deleteByFilename(bucket, partName);
      res.status(413).json({ error: (error as Error).message || "upload part is too large" });
      return;
    }

    // The client sends parts sequentially, so the final request can atomically
    // assemble a complete replacement while the previous PDF remains readable.
    if (part === parts - 1) {
      try {
        await assembleParts(db, bucket, filename, uploadId, parts, { userId, id });
      } catch (error) {
        res.status(409).json({ error: (error as Error).message || "incomplete upload" });
        return;
      }
    }
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const file = await db
      .collection("pdfs.files")
      .findOne({ filename, "metadata.userId": userId });
    if (!file) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (req.query.meta === "1") {
      res.status(200).json({ size: Number(file.length) });
      return;
    }

    const start = req.query.start === undefined ? 0 : queryInt(req.query.start);
    const end = req.query.end === undefined ? Number(file.length) : queryInt(req.query.end);
    if (start < 0 || end <= start || end > Number(file.length)) {
      res.status(416).json({ error: "invalid byte range" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(end - start));
    const download = bucket.openDownloadStream(file._id, { start, end });
    download.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    download.pipe(res);
    return;
  }

  if (req.method === "DELETE") {
    await deleteByFilename(bucket, filename);
    res.status(204).end();
    return;
  }

  res.setHeader("Allow", "GET,PUT,DELETE,OPTIONS");
  res.status(405).json({ error: "method not allowed" });
}

async function deleteByFilename(bucket: GridFSBucket, filename: string): Promise<void> {
  const files = await bucket.find({ filename }).toArray();
  await Promise.all(files.map((f) => bucket.delete(f._id).catch(() => {})));
}

function queryString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function queryInt(value: string | string[] | undefined): number {
  const raw = queryString(value);
  if (!/^\d+$/.test(raw)) return -1;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : -1;
}

function uploadPartName(filename: string, uploadId: string, part: number): string {
  return `${filename}.upload.${uploadId}.${part}`;
}

async function storeRequest(
  bucket: GridFSBucket,
  filename: string,
  req: VercelRequest,
  metadata: Record<string, unknown>,
  maxBytes: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { metadata: { ...metadata, temporary: true } });
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) upload.destroy(new Error("upload part exceeds the size limit"));
    });
    req.pipe(upload);
    upload.on("finish", () => resolve());
    upload.on("error", reject);
    req.on("error", reject);
  });
}

async function readFile(bucket: GridFSBucket, filename: string): Promise<Buffer> {
  const files = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).toArray();
  if (!files[0]) throw new Error("upload is missing one or more parts");
  const chunks: Buffer[] = [];
  for await (const chunk of bucket.openDownloadStream(files[0]._id)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function assembleParts(
  db: Awaited<ReturnType<typeof getDb>>,
  bucket: GridFSBucket,
  filename: string,
  uploadId: string,
  parts: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const assembledName = `${filename}.assembled.${uploadId}`;
  await deleteByFilename(bucket, assembledName);
  const upload = bucket.openUploadStream(assembledName, { metadata: { ...metadata, temporary: true } });
  try {
    let assembledBytes = 0;
    const maxPdfBytes = positiveEnvInt("PDF_MAX_FILE_BYTES", 100 * 1024 * 1024);
    for (let part = 0; part < parts; part++) {
      const bytes = await readFile(bucket, uploadPartName(filename, uploadId, part));
      assembledBytes += bytes.length;
      if (assembledBytes > maxPdfBytes) throw new Error("PDF exceeds the file size limit");
      if (!upload.write(bytes)) await once(upload, "drain");
    }
    upload.end();
    await once(upload, "finish");

    const existing = await db.collection("pdfs.files").findOne({ filename, "metadata.userId": metadata.userId });
    const totals = await db.collection("pdfs.files").aggregate<{ bytes: number }>([
      { $match: { "metadata.userId": metadata.userId, "metadata.temporary": { $ne: true } } },
      { $group: { _id: null, bytes: { $sum: "$length" } } },
    ]).toArray();
    const usedBytes = Number(totals[0]?.bytes ?? 0) - Number(existing?.length ?? 0);
    const quotaBytes = positiveEnvInt("PDF_USER_QUOTA_BYTES", 1024 * 1024 * 1024);
    if (usedBytes + assembledBytes > quotaBytes) throw new Error("PDF storage quota reached");

    await deleteByFilename(bucket, filename);
    await db.collection("pdfs.files").updateOne(
      { _id: upload.id },
      { $set: { filename, metadata } },
    );
    await Promise.all(
      Array.from({ length: parts }, (_, part) =>
        deleteByFilename(bucket, uploadPartName(filename, uploadId, part)),
      ),
    );
  } catch (error) {
    upload.destroy();
    await deleteByFilename(bucket, assembledName);
    throw error;
  }
}

/** Remove abandoned multipart uploads without leaving GridFS chunks orphaned. */
export async function cleanupTemporaryPdfUploads(olderThanMs = 24 * 60 * 60_000, limit = 200): Promise<number> {
  const db = await getDb();
  const bucket = new GridFSBucket(db, { bucketName: "pdfs" });
  const stale = await db.collection("pdfs.files").find({
    "metadata.temporary": true,
    uploadDate: { $lt: new Date(Date.now() - olderThanMs) },
  }).sort({ uploadDate: 1 }).limit(limit).toArray();
  await Promise.all(stale.map((file) => bucket.delete(file._id).catch(() => {})));
  return stale.length;
}
