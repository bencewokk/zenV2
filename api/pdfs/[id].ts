import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GridFSBucket } from "mongodb";
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
    // Replace any prior blob for this key, then stream the request body in.
    await deleteByFilename(bucket, filename);
    await new Promise<void>((resolve, reject) => {
      const upload = bucket.openUploadStream(filename, { metadata: { userId, id } });
      req.pipe(upload);
      upload.on("finish", () => resolve());
      upload.on("error", reject);
      req.on("error", reject);
    });
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
    res.setHeader("Content-Type", "application/pdf");
    const download = bucket.openDownloadStreamByName(filename);
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
