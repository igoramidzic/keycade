type SessionSnapshot =
  | { authenticated: false }
  | {
      authenticated: true;
      csrfToken: string;
      bank: { id: string };
      user: { email: string };
    };

// Browser memory only. The server still resolves the cookie and checks every grant.
let snapshot: SessionSnapshot | undefined;
export function rememberSession(session: SessionSnapshot) {
  snapshot = session;
}
export function currentSession() {
  return snapshot;
}
