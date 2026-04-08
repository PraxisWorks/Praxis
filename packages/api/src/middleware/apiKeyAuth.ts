import type { Request, Response, NextFunction } from "express";
import { compare } from "bcrypt";
import { isNotNull } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";

// Extend Express Request to include userId from API key auth
declare global {
  namespace Express {
    interface Request {
      apiKeyUserId?: string;
    }
  }
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const apiKey = authHeader.slice(7);
  const db = getDb();

  // Get all users with API keys
  const usersWithKeys = await db
    .select({ id: users.id, apiKeyHash: users.apiKeyHash })
    .from(users)
    .where(isNotNull(users.apiKeyHash));

  // Compare against each hash (bcrypt compare is slow by design)
  for (const user of usersWithKeys) {
    if (user.apiKeyHash && (await compare(apiKey, user.apiKeyHash))) {
      req.apiKeyUserId = user.id;
      next();
      return;
    }
  }

  res.status(401).json({ error: "Invalid API key" });
}
