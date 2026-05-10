import {
  ensureHumanForVibeIdUser,
  findHumanByVibeIdUserId,
  type HumanUserRecord,
} from "@/lib/human-accounts";
import { getCurrentVibeUser } from "@/lib/vibe-id-client";

/// Returns the signed-in human (or null). The vibe-id install token in the
/// `vibe_id_session` cookie is the only supported auth path.
export async function getCurrentHumanUser(): Promise<HumanUserRecord | null> {
  const vibeIdMe = await getCurrentVibeUser();
  if (!vibeIdMe) return null;

  const linkedHumanUser = await findHumanByVibeIdUserId(vibeIdMe.user.id);
  if (linkedHumanUser) return linkedHumanUser;

  // First time this vibe-id user has signed in to autoauth — create or
  // claim the local row. ensureHumanForVibeIdUser handles the "user
  // existed locally with the same email but wasn't yet linked" case too.
  return ensureHumanForVibeIdUser({
    vibeIdUserId: vibeIdMe.user.id,
    email: vibeIdMe.user.email,
    displayName: vibeIdMe.user.display_name,
    pictureUrl: vibeIdMe.user.picture_url,
  });
}

export async function requireCurrentHumanUser() {
  const user = await getCurrentHumanUser();
  if (!user) {
    throw new Error("Human authentication required.");
  }
  return user;
}

export function getHumanAuthDisplayName(user: HumanUserRecord) {
  return user.display_name?.trim() || user.email;
}
