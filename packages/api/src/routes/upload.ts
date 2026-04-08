import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { verifyToken } from "../middleware/auth.js";
import { resolveUserPermissions } from "../middleware/requirePermission.js";
import { getDb } from "../db/index.js";
import { users, sessions, repos, sessionAttachments, ideas, ideaAttachments } from "../db/schema.js";
import { getStorageAdapter } from "../services/storage/index.js";
import { getLogger } from "../lib/logger.js";
import { eq, and } from "drizzle-orm";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB default
const ALLOWED_MIME_PREFIXES = [
  "image/",
  "text/",
  "application/pdf",
  "application/json",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

/** Normalize Unicode whitespace (e.g. macOS narrow no-break space U+202F) to regular spaces */
function normalizeFilename(name: string): string {
  return name.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
}

export const uploadRouter = Router();

uploadRouter.post("/upload", upload.single("file"), async (req, res) => {
  try {
    // 1. Auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const jwtPayload = await verifyToken(authHeader.slice(7));
    if (!jwtPayload?.sub) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // 2. Resolve DB user
    const db = getDb();
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.sub, jwtPayload.sub))
      .limit(1);
    if (!dbUser) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // 2b. Permission check
    if (dbUser.role !== "admin") {
      const perms = await resolveUserPermissions(db, dbUser.id, dbUser.roleId);
      if (!perms.has("file:upload")) {
        res.status(403).json({ error: "Missing permission: file:upload" });
        return;
      }
    }

    // 3. Validate request
    const sessionId = req.body?.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    // Validate MIME type
    const isAllowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
      file.mimetype.startsWith(prefix),
    );
    if (!isAllowed) {
      res
        .status(415)
        .json({ error: `Unsupported file type: ${file.mimetype}` });
      return;
    }

    // 4. Verify session ownership (session -> repo -> userId)
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const [repo] = await db
      .select()
      .from(repos)
      .where(and(eq(repos.id, session.repoId), eq(repos.userId, dbUser.id)))
      .limit(1);
    if (!repo) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 5. Upload to storage
    const safeFilename = file.originalname
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/\s+/g, "-");
    const storageKey = `${sessionId}/${randomUUID()}/${safeFilename}`;
    const storage = getStorageAdapter();
    const result = await storage.upload({
      key: storageKey,
      data: file.buffer,
      mimeType: file.mimetype,
      filename: safeFilename,
    });

    // 6. Insert attachment row
    const displayFilename = normalizeFilename(file.originalname);
    const [attachment] = await db
      .insert(sessionAttachments)
      .values({
        sessionId,
        userId: dbUser.id,
        filename: displayFilename,
        mimeType: file.mimetype,
        sizeBytes: result.sizeBytes,
        storageKey: result.storageKey,
      })
      .returning();

    getLogger().info(
      { attachmentId: attachment.id, sessionId, filename: displayFilename },
      "File uploaded",
    );

    res.status(201).json({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageKey: attachment.storageKey,
      createdAt: attachment.createdAt,
    });
  } catch (err) {
    getLogger().error({ err }, "File upload failed");
    if ((err as any)?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

uploadRouter.post("/upload/idea", upload.single("file"), async (req, res) => {
  try {
    // 1. Auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const jwtPayload = await verifyToken(authHeader.slice(7));
    if (!jwtPayload?.sub) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // 2. Resolve DB user
    const db = getDb();
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.sub, jwtPayload.sub))
      .limit(1);
    if (!dbUser) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // 2b. Permission check
    if (dbUser.role !== "admin") {
      const perms = await resolveUserPermissions(db, dbUser.id, dbUser.roleId);
      if (!perms.has("file:upload")) {
        res.status(403).json({ error: "Missing permission: file:upload" });
        return;
      }
    }

    // 3. Validate request
    const ideaId = req.body?.ideaId;
    if (!ideaId) {
      res.status(400).json({ error: "ideaId is required" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    // Validate MIME type
    const isAllowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
      file.mimetype.startsWith(prefix),
    );
    if (!isAllowed) {
      res
        .status(415)
        .json({ error: `Unsupported file type: ${file.mimetype}` });
      return;
    }

    // 4. Verify idea exists, is owned by user, and is in 'new' status
    const [idea] = await db
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.userId, dbUser.id)))
      .limit(1);

    if (!idea) {
      res.status(404).json({ error: "Idea not found" });
      return;
    }

    if (idea.status !== "new") {
      res.status(400).json({ error: "Files can only be attached to ideas in 'new' status" });
      return;
    }

    // 5. Upload to storage
    const safeFilename = file.originalname
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/\s+/g, "-");
    const storageKey = `ideas/${ideaId}/${randomUUID()}/${safeFilename}`;
    const storage = getStorageAdapter();
    const result = await storage.upload({
      key: storageKey,
      data: file.buffer,
      mimeType: file.mimetype,
      filename: safeFilename,
    });

    // 6. Insert attachment row
    const displayFilename = normalizeFilename(file.originalname);
    const [attachment] = await db
      .insert(ideaAttachments)
      .values({
        ideaId,
        userId: dbUser.id,
        filename: displayFilename,
        mimeType: file.mimetype,
        sizeBytes: result.sizeBytes,
        storageKey: result.storageKey,
      })
      .returning();

    getLogger().info(
      { attachmentId: attachment.id, ideaId, filename: displayFilename },
      "Idea file uploaded",
    );

    res.status(201).json({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageKey: attachment.storageKey,
      createdAt: attachment.createdAt,
    });
  } catch (err) {
    getLogger().error({ err }, "Idea file upload failed");
    if ((err as any)?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});
