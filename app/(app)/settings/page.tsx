import type { Metadata } from "next";

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
import { DangerZone } from "@/features/account/components/danger-zone";
import { NotificationSettings } from "@/features/account/components/notification-settings";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ThemeSettings } from "@/features/account/components/theme-settings";

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
