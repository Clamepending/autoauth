import { notFound, redirect } from "next/navigation";

import {
  getFreshSdkConnectSessionById,
  parseScopesJson,
} from "@/lib/ottoauth-connect";
import { getCurrentHumanUser } from "@/lib/human-session";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    sessionId: string;
  };
};

const SCOPE_LABELS: Record<string, string> = {
  "files:write": "Upload files for orders",
  "quotes:read": "Preview prices and estimates",
  "offers:read": "Search supported offers",
  "checkout.sessions:create": "Create hosted checkout sessions",
  "orders:create": "Create direct orders",
  "orders:read": "Read order status",
};

function redirectHost(value: string) {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value;
  }
}

export default async function ConnectSessionPage({ params }: Props) {
  const session = await getFreshSdkConnectSessionById(params.sessionId);
  if (!session) notFound();

  const user = await getCurrentHumanUser();
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(`/connect/${session.id}`)}`);
  }

  const scopes = parseScopesJson(session.scopes_json);
  const canApprove = session.status === "pending";

  return (
    <main className="auth-page">
      <section className="auth-card connect-card">
        <div className="eyebrow">OttoAuth Connect</div>
        <h1>Connect {session.app_name}</h1>
        <p className="lede">
          Allow this app to upload files and open OttoAuth checkout under your account.
        </p>

        <div className="connect-summary">
          <div>
            <span>Signed in as</span>
            <strong>{user.display_name || user.email}</strong>
          </div>
          <div>
            <span>Return target</span>
            <strong>{redirectHost(session.redirect_url)}</strong>
          </div>
          <div>
            <span>Device</span>
            <strong>This browser</strong>
          </div>
        </div>

        <div className="card">
          <strong>Requested access</strong>
          <ul className="connect-scope-list">
            {scopes.map((scope) => (
              <li key={scope}>{SCOPE_LABELS[scope] || scope}</li>
            ))}
          </ul>
        </div>

        {canApprove ? (
          <div className="connect-actions">
            <form method="post" action={`/connect/${encodeURIComponent(session.id)}/approve`}>
              <button className="auth-button primary" type="submit">
                Connect
              </button>
            </form>
            <form method="post" action={`/connect/${encodeURIComponent(session.id)}/cancel`}>
              <button className="auth-button" type="submit">
                Cancel
              </button>
            </form>
          </div>
        ) : (
          <div className="auth-error">This connect session is {session.status}.</div>
        )}
      </section>
    </main>
  );
}
