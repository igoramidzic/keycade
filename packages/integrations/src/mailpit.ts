import nodemailer from "nodemailer";
import { type AccessEmailAdapter, renderAccessEmail } from "./access-email.js";

export { type AccessEmail, type AccessEmailAdapter, renderAccessEmail } from "./access-email.js";

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
