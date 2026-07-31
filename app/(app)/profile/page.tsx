import type { Metadata } from "next";
import { Coins, Mail, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getClerkUser, getCurrentUser } from "@/lib/auth";
import { formatCredits, formatRelativeTime } from "@/utils/format";

export const metadata: Metadata = { title: "Profile" };

/**
 * Profile.
 *
 * A Server Component reading from **both** sources of truth and being explicit
 * about which is which:
 *
 *   Clerk     identity — name, email, avatar, verification state
 *   Postgres  application data — credit balance, join date
 *
 * ## The pending state
 *
 * `getCurrentUser()` can legitimately return `null` for a signed-in user. The
 * `user.created` webhook is asynchronous, and a fast sign-up can render this
 * page before it lands. That is a real race, not a hypothetical, so it gets a
 * real UI state rather than a crash or a silent zero balance — showing "0
 * credits" to someone who just signed up for 200 is worse than saying "still
 * setting up".
 *
 * Nothing here creates the row as a fallback. That would race the webhook and
 * risk two rows for one person; the webhook is the single writer.
 */
export default async function ProfilePage() {
  const [clerkUser, dbUser] = await Promise.all([
    getClerkUser(),
    getCurrentUser(),
  ]);

  const email = clerkUser?.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  );
  const displayName =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    email?.emailAddress ||
    "Your account";

  return (
    <Container size="md" className="py-8 sm:py-12">
      <PageHeader
        title="Profile"
        description="Your account at a glance."
        actions={
          <Button variant="outline" asChild>
            <Link href="/settings">Edit profile</Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="size-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
              {clerkUser?.imageUrl ? (
                <Image
                  src={clerkUser.imageUrl}
                  alt=""
                  width={80}
                  height={80}
                  className="size-full object-cover"
                  unoptimized
                />
              ) : null}
            </div>

            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{displayName}</h2>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden />
                  <span className="truncate">{email?.emailAddress}</span>
                </span>

                {email?.verification?.status === "verified" ? (
                  <Badge variant="success" size="sm" dot>
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm" dot>
                    Unverified
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {dbUser ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5">
                  <Coins className="size-3.5" aria-hidden />
                  Credit balance
                </CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {formatCredits(dbUser.creditBalance)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Credits are spent per generation and priced by modality.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Member since
                </CardDescription>
                <CardTitle className="text-3xl">
                  {new Date(dbUser.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Joined {formatRelativeTime(dbUser.createdAt)}.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finishing setup</CardTitle>
              <CardDescription>
                Your account exists and you are signed in — we are still
                creating your workspace record. This usually takes a few
                seconds. Refresh to check.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link href="/profile">Refresh</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Container>
  );
}
