import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "./db";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dockaro-dev-secret-change-in-production-32chars"
);
const COOKIE = "dk_session";
const EXPIRES = 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
}

// ─── Password ────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── JWT session ─────────────────────────────────────────────────────────────

async function signToken(payload: SessionUser): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(SECRET);
}

async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export async function createSession(user: SessionUser): Promise<string> {
  const token = await signToken(user);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRES,
    path: "/",
  });
  return token;
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// ─── User DB helpers ──────────────────────────────────────────────────────────

export function findUserByEmail(email: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | { id: string; email: string; name: string; password: string; plan: string }
    | undefined;
}

export function createUser(email: string, name: string, passwordHash: string) {
  const db = getDb();
  const id = `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  db.prepare(
    "INSERT INTO users (id, email, name, password, plan, created_at) VALUES (?, ?, ?, ?, 'free', ?)"
  ).run(id, email.toLowerCase(), name, passwordHash, new Date().toISOString());
  return { id, email, name, plan: "free" };
}
