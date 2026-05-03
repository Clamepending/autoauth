import Link from "next/link";
import { notFound } from "next/navigation";
import { getBaseUrl } from "@/lib/base-url";
import { resolveHumanPaymentRecipient } from "@/lib/human-accounts";

export const dynamic = "force-dynamic";

function displayName(user: {
  display_name: string | null;
  handle_display: string;
}) {
  return user.display_name?.trim() || `@${user.handle_display}`;
}

function initialsForName(name: string, handle: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || handle.slice(0, 2).toUpperCase()
  );
}

export default async function OttoAuthProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const recipient = await resolveHumanPaymentRecipient(handle);
  if (!recipient) {
    notFound();
  }

  const user = recipient.humanUser;
  const profileHandle =
    recipient.matchedBy === "agent_username" && recipient.agentUsernameDisplay
      ? recipient.agentUsernameDisplay
      : user.handle_display;
  const profileHandleLower =
    recipient.matchedBy === "agent_username" && recipient.agentUsernameLower
      ? recipient.agentUsernameLower
      : user.handle_lower;
  const name = displayName(user);
  const profileUrl = `${getBaseUrl()}/u/${encodeURIComponent(profileHandleLower)}`;

  return (
    <main className="dashboard-page profile-page">
      <section className="dashboard-shell profile-shell">
        <article className="profile-card">
          <div className="profile-avatar">
            {user.picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture_url} alt="" />
            ) : (
              <span>{initialsForName(name, user.handle_display)}</span>
            )}
          </div>
          <div>
            <div className="eyebrow">OttoAuth Profile</div>
            <h1>{name}</h1>
            <p className="lede mono">@{profileHandle}</p>
            {recipient.matchedBy === "agent_username" && (
              <p className="dashboard-muted">
                Payments to this linked agent settle to @{user.handle_display}.
              </p>
            )}
          </div>
          <img
            className="profile-qr-image"
            src={`/api/profile/qr?handle=${encodeURIComponent(profileHandleLower)}`}
            alt={`QR code for @${profileHandle}`}
          />
          <div className="profile-link-block">{profileUrl}</div>
          <div className="dashboard-actions profile-actions">
            <Link
              className="auth-button primary"
              href={`/send?to=${encodeURIComponent(`@${profileHandleLower}`)}`}
            >
              Pay with OttoAuth
            </Link>
            <Link className="auth-button" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
