import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser, UserRole } from "@moken-store/shared";
import { db } from "./db.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type UserRow = {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  role: UserRole;
};

const sessionDays = 14;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    role: row.role
  };
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    insert into auth_sessions (id, user_id, token_hash, expires_at)
    values (?, ?, ?, ?)
  `).run(randomBytes(16).toString("hex"), userId, hashToken(token), expiresAt);

  return token;
}

export function destroySession(token: string) {
  db.prepare("delete from auth_sessions where token_hash = ?").run(hashToken(token));
}

export function getUserByEmail(email: string) {
  return db.prepare(`
    select
      id,
      tenant_id as tenantId,
      name,
      email,
      password_hash as passwordHash,
      role,
      status
    from users
    where email = ?
  `).get(email.toLowerCase()) as (UserRow & { passwordHash: string; status: string }) | undefined;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    next();
    return;
  }

  const row = db.prepare(`
    select
      u.id,
      u.tenant_id as tenantId,
      u.name,
      u.email,
      u.role
    from auth_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ?
      and s.expires_at > ?
      and u.status = 'active'
  `).get(hashToken(token), new Date().toISOString()) as UserRow | undefined;

  if (row) {
    req.user = mapUser(row);
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized", message: "Login is required." });
    return;
  }

  next();
}

export function requirePlatform(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "platform_owner") {
    res.status(403).json({ error: "forbidden", message: "Platform access is required." });
    return;
  }

  next();
}

export function requireStoreRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized", message: "Login is required." });
      return;
    }

    if (!roles.includes(req.user.role) || req.user.tenantId !== req.tenant?.id) {
      res.status(403).json({ error: "forbidden", message: "You do not have access to this store action." });
      return;
    }

    next();
  };
}
