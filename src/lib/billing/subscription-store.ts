import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Currency, Period } from "@/lib/plans";

/**
 * What each customer has paid for.
 *
 * Same shape and same reasoning as the document repository: one JSON file per
 * record, atomic writes, and functions a SQL table would expose one-for-one.
 * Subscriptions belong in Postgres the moment there is one — this exists so
 * the payment flow is complete and testable end to end rather than stopping
 * at "Razorpay said yes".
 *
 * Orders are recorded *before* the customer is sent to checkout, so a webhook
 * arriving for an order we never created is rejected rather than trusted.
 */

export type OrderStatus = "created" | "paid" | "failed";

export interface OrderRecord {
  orderId: string;
  userId: string;
  planId: string;
  currency: Currency;
  period: Period;
  seats: number;
  /** Smallest currency unit, as sent to Razorpay. */
  amountMinor: number;
  status: OrderStatus;
  paymentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  userId: string;
  planId: string;
  currency: Currency;
  period: Period;
  seats: number;
  startedAt: string;
  /** When access lapses if nothing else is paid. */
  expiresAt: string;
  lastOrderId: string;
}

const ordersDir = () =>
  process.env.DOCKARO_BILLING_DIR ?? join(process.cwd(), ".data", "billing");

const orderPath = (id: string) => join(ordersDir(), "orders", `${sanitise(id)}.json`);
const subscriptionPath = (userId: string) =>
  join(ordersDir(), "subscriptions", `${sanitise(userId)}.json`);

/**
 * Razorpay order ids and Supabase user ids are both opaque strings from
 * elsewhere, and both become file names here.
 */
function sanitise(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Refusing to build a path for unsafe identifier: ${value}`);
  }
  return value;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(data), "utf8");
  await rename(temp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export async function recordOrder(
  order: Omit<OrderRecord, "status" | "createdAt" | "updatedAt">,
): Promise<OrderRecord> {
  const now = new Date().toISOString();
  const record: OrderRecord = { ...order, status: "created", createdAt: now, updatedAt: now };
  await writeJson(orderPath(order.orderId), record);
  return record;
}

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  try {
    return await readJson<OrderRecord>(orderPath(orderId));
  } catch {
    // An unsafe id cannot correspond to an order we created.
    return null;
  }
}

export async function markOrder(
  orderId: string,
  status: OrderStatus,
  paymentId?: string,
): Promise<OrderRecord | null> {
  const existing = await getOrder(orderId);
  if (!existing) return null;

  // Terminal state: a duplicate webhook must not reopen a paid order, and a
  // late failure must not undo a capture that already succeeded.
  if (existing.status === "paid" && status !== "paid") return existing;

  const updated: OrderRecord = {
    ...existing,
    status,
    ...(paymentId ? { paymentId } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeJson(orderPath(orderId), updated);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

/** Adds one billing period to `from`, which is what a payment buys. */
export function periodEnd(from: Date, period: Period): Date {
  const end = new Date(from);
  if (period === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

/**
 * Grants (or extends) access after a payment is confirmed.
 *
 * Renewing before expiry stacks onto the remaining time rather than throwing
 * it away — a customer who pays early should not lose the days they already
 * bought.
 */
export async function activateSubscription(
  order: OrderRecord,
  now = new Date(),
): Promise<Subscription> {
  const existing = await getSubscription(order.userId);
  const base =
    existing && new Date(existing.expiresAt) > now
      ? new Date(existing.expiresAt)
      : now;

  const subscription: Subscription = {
    userId: order.userId,
    planId: order.planId,
    currency: order.currency,
    period: order.period,
    seats: order.seats,
    startedAt: existing?.startedAt ?? now.toISOString(),
    expiresAt: periodEnd(base, order.period).toISOString(),
    lastOrderId: order.orderId,
  };

  await writeJson(subscriptionPath(order.userId), subscription);
  return subscription;
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  try {
    return await readJson<Subscription>(subscriptionPath(userId));
  } catch {
    return null;
  }
}

/** Whether a user's paid access is currently valid. */
export async function hasActiveSubscription(
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const subscription = await getSubscription(userId);
  return subscription !== null && new Date(subscription.expiresAt) > now;
}

/** Every order for a user, newest first — the billing history page. */
export async function listOrders(userId: string): Promise<OrderRecord[]> {
  const dir = join(ordersDir(), "orders");
  await mkdir(dir, { recursive: true });

  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const records = await Promise.all(
    names.map((name) => readJson<OrderRecord>(join(dir, name))),
  );

  return records
    .filter((record): record is OrderRecord => record?.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Test seam. */
export async function __removeOrder(orderId: string): Promise<void> {
  await unlink(orderPath(orderId)).catch(() => undefined);
}
