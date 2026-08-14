import type { Metadata } from "next";
import { Check, Clock, Plug } from "lucide-react";

import {
  CONNECTORS,
  CONNECTOR_KIND_LABEL,
  type ConnectorKind,
} from "@/features/marketing/connectors";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { SITE } from "@/features/marketing/content";
import { env } from "@/lib/env";

/**
 * How to use Atheos from somewhere else.
 *
 * The page exists because "does it work with the tools I already use" is the
 * question that decides whether a developer signs up, and the honest answer has
 * three different shapes depending on the tool. Flattening those into a logo
 * wall would be the easy version and the dishonest one — see
 * `features/marketing/connectors.ts`.
 */

export const metadata: Metadata = {
  title: "Connect Atheos to your tools",
  description:
    "Use Atheos from Claude, ChatGPT, your editor or your own code. One MCP server, one API key, the same credits.",
  alternates: { canonical: `${SITE.domain}/connect` },
};

const ICON: Record<ConnectorKind, typeof Check> = {
  mcp: Plug,
  http: Check,
  soon: Clock,
};

export default function ConnectPage() {
  const mcpUrl = `${env.NEXT_PUBLIC_APP_URL}/api/mcp`;

  const groups: ConnectorKind[] = ["mcp", "http", "soon"];

  return (
    <>
      <Section id="connect">
        <SectionHeading
          eyebrow="Connect"
          title="Use Atheos from the tools you already have"
          description="One server address and one key. Generations run on your credits and land in your library, wherever you started them."
        />

        <Reveal delay={0.05} className="mt-10">
          <div className="mx-auto max-w-2xl rounded-xl border border-border bg-surface-sunken p-5">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              MCP server address
            </p>
            {/* Selectable, not a copy button: a click-to-copy that silently
                fails leaves somebody pasting nothing into a config file. */}
            <p className="mt-2 font-mono text-sm break-all select-all">
              {mcpUrl}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Authenticate with{" "}
              <span className="font-mono text-xs">
                Authorization: Bearer &lt;your key&gt;
              </span>
              . Create one under Settings → API keys once you have signed in.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 space-y-10">
          {groups.map((kind) => {
            const items = CONNECTORS.filter(
              (connector) => connector.kind === kind,
            );
            if (items.length === 0) return null;
            const Icon = ICON[kind];

            return (
              <Reveal key={kind} delay={0.05}>
                <h3 className="text-sm font-medium text-muted-foreground">
                  {CONNECTOR_KIND_LABEL[kind]}
                </h3>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((connector) => (
                    <div
                      key={connector.name}
                      className={
                        // The unbuilt ones are visibly quieter. Same weight as
                        // a working integration would read as a claim.
                        kind === "soon"
                          ? "rounded-xl border border-dashed border-border p-5 opacity-70"
                          : "rounded-xl border border-border bg-card p-5"
                      }
                    >
                      <p className="flex items-center gap-2 font-medium">
                        <Icon
                          className="size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                        {connector.name}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {connector.summary}
                      </p>
                      {connector.how ? (
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                          {connector.how}
                        </p>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground italic">
                          Not available yet — this one is on the roadmap, not in
                          the product.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-balance text-muted-foreground">
            A connected tool spends your credits exactly as the studio does, and
            you can revoke any key at any time without touching the others.
            Atheos is in beta — if something here does not work, that is a bug
            worth telling us about rather than expected.
          </p>
        </Reveal>
      </Section>
    </>
  );
}
