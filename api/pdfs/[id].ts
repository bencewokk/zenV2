import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GridFSBucket } from "mongodb";
import { once } from "node:events";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { getDb } from "../_lib/db.js";

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
    if (!uploadId || !/^[\w-]{8,80}$/.test(uploadId) || part < 0 || parts < 1 || part >= parts) {
      res.status(400).json({ error: "invalid upload part" });
      return;
    }

    const partName = uploadPartName(filename, uploadId, part);
    await deleteByFilename(bucket, partName);
    await storeRequest(bucket, partName, req, { userId, id, uploadId, part });

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
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { metadata: { ...metadata, temporary: true } });
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
    for (let part = 0; part < parts; part++) {
      const bytes = await readFile(bucket, uploadPartName(filename, uploadId, part));
      if (!upload.write(bytes)) await once(upload, "drain");
    }
    upload.end();
    await once(upload, "finish");

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
