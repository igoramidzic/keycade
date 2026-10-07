import type { Database } from "@keycade/db";
import { type DemoInboxCipher, storeDemoInboxMessage } from "@keycade/domain";
import { type AccessEmailAdapter, renderAccessEmail } from "./access-email.js";
import { type Clock, systemClock } from "./provider.js";

/** Hosted synthetic delivery writes only to the private database inbox; no network sender. */
export function createDemoInboxAdapter(
  db: Database,
  options: { cipher: DemoInboxCipher; clock?: Clock },
): AccessEmailAdapter {
  const clock = options.clock ?? systemClock;
  return {
    async send(message) {
      const rendered = renderAccessEmail(message, { includeLink: false });
      await storeDemoInboxMessage(
        db,
        { ...message, ...rendered },
        { cipher: options.cipher, clock: () => clock.now() },
      );
    },
  };
}
