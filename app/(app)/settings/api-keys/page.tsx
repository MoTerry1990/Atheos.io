import type { Metadata } from "next";
import Link from "next/link";

import { ApiKeysPanel } from "@/features/account/components/api-keys-panel";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";

/**
 * API keys.
 *
 * A page of its own rather than a fourth tab under Settings: a key is a
 * credential somebody links to from a config file at three in the morning, and
 * `/settings#tab=keys` is not a link. It also wants room for the MCP address,
 * which is the other half of what a person needs to paste somewhere.
 */

export const metadata: Metadata = {
  title: "API keys",
  description: "Credentials for using Atheos from other tools.",
};

export default async function ApiKeysPage() {
  // Not for the value — for the gate. This page must not render for a signed-out
  // visitor, and authorisation lives with the resource.
  await requireUser();

  return (
    <Container>
      <PageHeader
        title="API keys"
        description="Let Claude, ChatGPT, your editor or your own code generate on your account."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Your keys</CardTitle>
            <CardDescription>
              A key spends your credits exactly as the studio does. Revoke one
              and only that one stops working.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeysPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connecting a tool</CardTitle>
            <CardDescription>
              Most clients need two things: this address, and a key from above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                MCP server
              </p>
              <p className="mt-1.5 font-mono text-sm break-all select-all">
                {env.NEXT_PUBLIC_APP_URL}/api/mcp
              </p>
            </div>

            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Header
              </p>
              <p className="mt-1.5 font-mono text-sm break-all select-all">
                Authorization: Bearer &lt;your key&gt;
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Step-by-step instructions per tool are on the{" "}
              <Link
                href="/connect"
                className="text-primary underline-offset-4 hover:underline"
              >
                connect page
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
