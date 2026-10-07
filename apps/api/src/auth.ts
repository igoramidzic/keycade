import type { AuthPortal } from "@keycade/contracts";
import type { Database } from "@keycade/db";
import { type Actor, createIdentityService, deny, requireBankStaff } from "@keycade/domain";
import { readSessionCookie } from "./security.js";

export type IdentityService = ReturnType<typeof createIdentityService>;
export type Session = NonNullable<Awaited<ReturnType<IdentityService["resolveSession"]>>>;
export interface Authentication {
  actor: Actor;
  csrfToken?: string;
  session?: Session;
}
export interface IdentityTransportOptions {
  /** An explicit set per portal; link destinations never come from Host or forwarding headers. */
  portalOrigins?: Partial<Record<AuthPortal, readonly string[]>>;
  authDeliveryEnabled?: boolean;
  /** Explicit demo entry point; disabled unless a trusted runtime enables it. */
  demoSignInEnabled?: boolean;
  nodeEnv?: "development" | "test" | "production";
}

export async function authenticateSession(
  identity: IdentityService,
  cookieHeader: string | undefined,
  origin: string | undefined,
  demoSignInEnabled = false,
): Promise<Authentication> {
  const token = origin ? readSessionCookie(cookieHeader, origin) : undefined;
  const session = token && origin ? await identity.resolveSession(token, origin) : null;
  return session && (session.authenticationMethod !== "demo" || demoSignInEnabled)
    ? { actor: session.actor, csrfToken: session.csrfToken, session }
    : { actor: { kind: "anonymous" } };
}

export function publicSession(authentication: Authentication, demoSignInEnabled = false) {
  const session = authentication.session;
  return session
    ? {
        authenticated: true as const,
        demoSignInEnabled,
        authenticationMethod: session.authenticationMethod,
        user: { email: session.user.email, displayName: session.user.displayName },
        bank: session.bank,
        csrfToken: session.csrfToken,
        staff: session.staffRole !== null,
      }
    : { authenticated: false as const, demoSignInEnabled };
}

export async function readStaffSession(db: Database, authentication: Authentication) {
  const session = authentication.session;
  if (!session) return deny();
  const membership = await requireBankStaff(db, authentication.actor, session.bank.id);
  return { bank: session.bank, role: membership.role };
}

/** A session established for one bank cannot select another bank through a route parameter. */
export function assertSessionBank(authentication: Authentication, bankId: string): void {
  if (authentication.session && authentication.session.bank.id !== bankId) deny();
}

export const accessLinkMessage =
  "If this address can access this portal, an email link is on its way.";
