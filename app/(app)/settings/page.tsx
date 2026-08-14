import { CreditCard, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AvatarUpload } from "@/features/account/components/avatar-upload";
import { ProfileForm } from "@/features/account/components/profile-form";

/**
 * The three tabs behind a click are code-split.
 *
 * Profile is `defaultValue`, so its two components are needed for first paint
 * and stay static. Appearance, Notifications and Account are not: Radix `Tabs`
 * unmounts inactive content, so eagerly bundling them shipped three panels —
 * including the delete-account flow and its confirmation dialog — to every
 * visitor who came to change their display name.
 *
 * No `ssr: false`: this is a Server Component, and the panels still render on
 * the server when their tab is the active one. The split is about which chunk
 * the browser downloads, not about where it renders.
 */
const ThemeSettings = dynamic(() =>
  import("@/features/account/components/theme-settings").then(
    (m) => m.ThemeSettings,
  ),
);

const NotificationSettings = dynamic(() =>
  import("@/features/account/components/notification-settings").then(
    (m) => m.NotificationSettings,
  ),
);

const DangerZone = dynamic(() =>
  import("@/features/account/components/danger-zone").then((m) => m.DangerZone),
);

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings.
 *
 * Tabs rather than one long scroll: four unrelated concerns on a single page
 * means the thing you came for is never where you left it. Radix `Tabs` handles
 * arrow-key navigation and the `aria-controls` wiring.
 *
 * The tab list scrolls horizontally on narrow screens instead of wrapping —
 * four wrapped tabs push the actual content below the fold on a phone.
 *
 * A Server Component: the interactive parts are client islands, and the page
 * itself is composition.
 */
export default function SettingsPage() {
  return (
    <Container size="md" className="py-8 sm:py-12">
      <PageHeader
        title="Settings"
        description="Manage your profile, appearance and notifications."
      />

      {/* Billing is a link, not a fifth tab. Stripe redirects back to it after
          checkout, and a destination that only exists as tab state cannot be
          linked to — the user would land on Profile after paying. */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Plan and billing</p>
          <p className="text-xs text-muted-foreground">
            Your subscription, credits, invoices and usage.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/billing">
            <CreditCard />
            Open billing
          </Link>
        </Button>
      </div>

      {/* Same reasoning as billing: a key is something people link to from a
          config file, and tab state is not linkable. */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">API keys</p>
          <p className="text-xs text-muted-foreground">
            Use Atheos from Claude, ChatGPT, your editor or your own code.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/api-keys">
            <KeyRound />
            Manage keys
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="profile" className="mt-2">
        <TabsList className="mb-6 w-full [scrollbar-width:none] justify-start overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile photo</CardTitle>
              <CardDescription>
                Shown on your account and anywhere your work appears.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AvatarUpload />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your details</CardTitle>
              <CardDescription>
                How we address you in the product and in email.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
              <CardDescription>
                Dark is the default — generated imagery reads better against a
                dark surround.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Email notifications</CardTitle>
              <CardDescription>
                Changes save immediately. You can turn any of these off at any
                time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Session and account management.</CardDescription>
            </CardHeader>
            <CardContent>
              <DangerZone />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Container>
  );
}
