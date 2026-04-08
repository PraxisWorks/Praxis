import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { orgInvitations } from "../../db/schema.js";
import { getAuth0MgmtAdapter } from "../../services/auth0-mgmt/index.js";

export const PROCESS_ORG_INVITATION = "process-org-invitation";

type Payload = {
  invitationId: string;
};

export async function registerProcessOrgInvitationHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(PROCESS_ORG_INVITATION, async ([job]) => {
    const { invitationId } = job.data as Payload;
    const logger = getLogger();
    const db = getDb();

    logger.info({ jobId: job.id, invitationId }, "Processing org invitation");

    // 1. Load invitation
    const [invitation] = await db
      .select()
      .from(orgInvitations)
      .where(eq(orgInvitations.id, invitationId))
      .limit(1);

    if (!invitation) {
      logger.warn({ invitationId }, "Invitation not found, skipping");
      return;
    }

    // 2. Create Auth0 user (idempotent)
    const adapter = getAuth0MgmtAdapter();
    const { auth0UserId, created } = await adapter.createUser(invitation.email);
    logger.info({ invitationId, auth0UserId, created }, "Auth0 user ensured");

    // 3. Send password reset email via Auth0
    await adapter.changePasswordTicket(auth0UserId, invitation.email);
    logger.info({ invitationId, email: invitation.email }, "Password reset email sent");
  });

  getLogger().info(`Registered handler for ${PROCESS_ORG_INVITATION}`);
}
