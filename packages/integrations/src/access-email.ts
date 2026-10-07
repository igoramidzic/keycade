import type { NotificationKind } from "@keycade/db";

export interface AccessEmail {
  deliveryRequestId: string;
  claimToken: string;
  attempt: number;
  to: string;
  confirmUrl: string;
  messageId: string;
  notification?: { kind: NotificationKind; applicationReference: string | null };
}
export interface AccessEmailAdapter {
  send(message: AccessEmail): Promise<void>;
}

const subjects: Record<NotificationKind, string> = {
  access_requested: "Your Keycade sign-in link",
  application_started: "Your application is started",
  application_resume: "Continue your application",
  invitation: "Your application invitation",
  task_assigned: "You have a task to complete",
  task_returned: "A task needs your attention",
  status_changed: "Your application has an update",
  reminder: "Continue when you are ready",
  signature_requested: "Review your simulated signature request",
};

/** Pure templates contain context, never private evidence or risk findings. */
export function renderAccessEmail(message: AccessEmail, options: { includeLink?: boolean } = {}) {
  const kind = message.notification?.kind ?? "access_requested";
  const reference = message.notification?.applicationReference;
  return {
    subject: `${subjects[kind]}${reference ? ` · Application ${reference}` : ""} — simulation`,
    text: [
      "This is a Keycade simulation. No external email has been sent.",
      "",
      subjects[kind],
      ...(reference ? [`Application ${reference}`] : []),
      "",
      options.includeLink === false
        ? "Use the confirmation button below to continue."
        : "Open the sign-in link, then choose Confirm sign-in to continue:",
      ...(options.includeLink === false ? [] : [message.confirmUrl]),
      "",
      "This link expires in 15 minutes and can be used once. Your current access and saved application progress determine where you continue.",
      ...(kind === "reminder"
        ? [
            "You can turn off application reminders in your notification preferences without disabling sign-in.",
          ]
        : []),
      "All application data, checks, signatures and funding in this demo are synthetic.",
    ].join("\n"),
  };
}
