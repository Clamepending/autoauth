import type { CSSProperties } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | OttoAuth",
  description: "Privacy policy for OttoAuth and the OttoAuth Browser Agent Chrome extension.",
};

const updatedAt = "February 26, 2026";

export default function PrivacyPage() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.muted}>Last updated: {updatedAt}</p>

        <section style={styles.section}>
          <h2 style={styles.h2}>Overview</h2>
          <p style={styles.p}>
            OttoAuth provides agent authentication, paired browser device routing, and browser
            automation tools. The OttoAuth Browser Agent Chrome extension lets users pair a
            browser with OttoAuth and run local AI-assisted browser tasks.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Data We Process</h2>
          <ul style={styles.ul}>
            <li>
              OttoAuth account and agent data (for example usernames, public/private key-derived
              authentication requests, and service usage metadata).
            </li>
            <li>
              Extension pairing data (for example browser token, device identifier, pairing state,
              and task routing metadata).
            </li>
            <li>
              Computer-use task data (for example task prompts, run status, run events, and
              completion summaries).
            </li>
            <li>
              Local extension settings stored in the browser (for example selected model,
              provider/API keys entered by the user, approval mode, and UI preferences).
            </li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>How Website Content Is Used</h2>
          <p style={styles.p}>
            When the user runs the local browser agent, the extension reads page state (such as URL,
            visible text, interactive elements, and form controls) to plan and execute actions.
          </p>
          <p style={styles.p}>
            Depending on the selected mode and provider configuration, portions of that page state
            may be sent to a model provider (for example OpenAI, Anthropic, or Google) to generate
            plans or next actions. Users control when runs start and which provider/API key is used.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>BYOK (Bring Your Own Key) Providers</h2>
          <p style={styles.p}>
            The extension supports BYOK model providers. API keys entered in the extension are
            stored locally in the user&apos;s browser using Chrome extension storage and are used to
            make requests directly to the selected provider from the extension.
          </p>
          <p style={styles.p}>
            OttoAuth does not need the user&apos;s model provider API keys to route paired-device
            computer-use jobs.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Cloud Pairing and Task Routing</h2>
          <p style={styles.p}>
            The extension can pair with OttoAuth using a browser token/device token flow. OttoAuth
            uses this pairing to route authorized tasks to the user&apos;s browser. OttoAuth may store
            task metadata, run status, and event logs to support retries, debugging, and audit
            history.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Data Sharing</h2>
          <ul style={styles.ul}>
            <li>
              Model providers selected by the user may receive prompts and page-state excerpts
              needed to perform browser-agent planning/execution.
            </li>
            <li>
              Infrastructure providers (for example hosting/database providers) may process data as
              part of operating OttoAuth.
            </li>
            <li>We do not sell personal information.</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>User Controls</h2>
          <ul style={styles.ul}>
            <li>Users can clear extension chat history and local session logs from the extension UI.</li>
            <li>Users can regenerate browser pairing tokens.</li>
            <li>Users can choose plan approval mode (ask before acting vs. act without asking).</li>
            <li>Users can remove/uninstall the extension to stop local storage and execution.</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Security</h2>
          <p style={styles.p}>
            We use authentication and device pairing controls to limit who can route tasks to a
            paired browser. No system is perfectly secure, and users should avoid running browser
            automation on highly sensitive pages unless they understand the risks and provider data
            handling.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Contact</h2>
          <p style={styles.p}>
            For questions about this policy, use the support/contact method listed on the OttoAuth
            site or Chrome Web Store listing.
          </p>
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at 20% 10%, rgba(247,148,29,0.10), transparent 45%), #0f1115",
    color: "#f2f3f5",
    padding: "48px 20px",
  },
  container: {
    maxWidth: 860,
    margin: "0 auto",
    padding: 24,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    boxShadow: "0 16px 50px rgba(0,0,0,0.28)",
  },
  h1: {
    margin: "0 0 8px 0",
    fontSize: 34,
    lineHeight: 1.1,
    fontWeight: 700,
  },
  h2: {
    margin: "0 0 10px 0",
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 600,
  },
  muted: {
    margin: "0 0 22px 0",
    color: "rgba(242,243,245,0.72)",
    fontSize: 14,
  },
  section: {
    marginTop: 18,
    paddingTop: 18,
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  p: {
    margin: "0 0 10px 0",
    lineHeight: 1.55,
    color: "rgba(242,243,245,0.92)",
  },
  ul: {
    margin: "0",
    paddingLeft: 20,
    lineHeight: 1.55,
    color: "rgba(242,243,245,0.92)",
  },
};
