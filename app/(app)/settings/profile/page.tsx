import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileSettings } from "@/features/community/components/profile-settings";

export const metadata: Metadata = { title: "Public profile" };

/**
 * The public profile settings.
 *
 * Separate from `/profile`, which is the account page — name, email, avatar,
 * the things Clerk owns. This is the *public* identity, and keeping them apart
 * is what makes "nothing about you is public until you claim a handle" a
 * statement the interface can actually keep.
 */
export default function ProfileSettingsPage() {
  return (
    <Container size="md" className="py-8 sm:py-12">
      <PageHeader
        title="Public profile"
        description="Your handle and the page your published work appears on."
      />
      <div className="mt-2 max-w-lg">
        <ProfileSettings />
      </div>
    </Container>
  );
}
