import type { NotificationKind } from "@keycade/db";
import nodemailer from "nodemailer";

export interface AccessEmail {
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
/** Templates contain context and an access link, never private evidence or risk findings. */
export function renderAccessEmail(message: AccessEmail) {
  const kind = message.notification?.kind ?? "access_requested";
  const reference = message.notification?.applicationReference;
  return {
    subject: `${subjects[kind]}${reference ? ` · Application ${reference}` : ""} — local simulation`,
    text: [
      "This is a Keycade simulation. No external email has been sent.",
      "",
      subjects[kind],
      ...(reference ? [`Application ${reference}`] : []),
      "",
      "Open this link, then choose Confirm sign-in to continue:",
      message.confirmUrl,
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

/** Local-only SMTP sink. Credentials never leave the process except in the intended email. */
export function createMailpitAdapter(port: number): AccessEmailAdapter {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid local SMTP port.");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(message) {
      try {
        const result = await transport.sendMail({
          from: "Keycade local simulation <access@keycade.example.test>",
          to: message.to,
          messageId: message.messageId,
          ...renderAccessEmail(message),
        });
        if (result.accepted.length !== 1) throw new Error("SMTP did not accept the recipient.");
      } catch {
        // SMTP errors may quote recipients or message contents. Expose a fixed safe code only.
        throw new Error("local_email_delivery_failed");
      }
    },
  };
}
