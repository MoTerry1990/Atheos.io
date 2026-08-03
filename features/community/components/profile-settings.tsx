"use client";

import { Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, type PublicProfile } from "@/features/community/lib/api";
import { useCommunityApi } from "@/features/community/lib/api-context";
import {
  HANDLE_MAX,
  HANDLE_MESSAGES,
  HANDLE_MIN,
  normaliseHandle,
  validateHandle,
} from "@/services/community/handles";
import { toast } from "@/lib/toast";

/**
 * Claim a handle, and edit the public profile.
 *
 * ## Having no profile is a normal state
 *
 * Signing up does not create one. A product that publishes a page about
 * somebody because they registered has decided something on their behalf, and
 * a handle derived from an email address would do exactly that.
 *
 * So this screen has two modes and the first one explains what claiming a
 * handle means before asking for it.
 *
 * ## Validation runs client-side using the server's own rules
 *
 * `services/community/handles.ts` is pure and imported by both. Two
 * implementations would eventually disagree, and the disagreement shows up as a
 * form that accepts something the API then rejects — the most annoying possible
 * place to find out.
 */
export function ProfileSettings() {
  const api = useCommunityApi();

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(
    undefined,
  );
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { profile: loaded } = await api.loadMyProfile();
      setProfile(loaded);
      if (loaded) {
        setHandle(loaded.handle);
        setDisplayName(loaded.displayName);
        setBio(loaded.bio ?? "");
        setWebsite(loaded.website ?? "");
      }
    } catch {
      setProfile(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = handle ? validateHandle(handle) : null;
  const handleError = problem ? HANDLE_MESSAGES[problem] : null;

  async function save() {
    if (handleError) return;

    setSaving(true);
    try {
      const { profile: saved } = await api.saveMyProfile({
        handle: normaliseHandle(handle),
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        website: website.trim() || null,
      });
      setProfile(saved);
      toast.success(
        "Profile saved",
        `Your work publishes to /u/${saved.handle}`,
      );
    } catch (cause) {
      toast.error("Could not save your profile", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (profile === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!profile ? (
        <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          You do not have a public profile yet, and nothing about you is public.
          Claiming a handle creates a page at{" "}
          <code className="font-mono">/u/your-handle</code> showing only the
          work you choose to publish.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="handle" className="text-sm font-medium">
          Handle
        </label>
        <InputField
          id="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="your-handle"
          minLength={HANDLE_MIN}
          maxLength={HANDLE_MAX}
          aria-invalid={handleError ? true : undefined}
          aria-describedby="handle-help"
          className="font-mono"
        />
        <p
          id="handle-help"
          className={
            handleError
              ? "text-2xs text-destructive"
              : "text-2xs text-muted-foreground"
          }
        >
          {handleError ??
            `Letters, numbers, hyphens and underscores. Your page will be at /u/${normaliseHandle(handle) || "your-handle"}`}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="display-name" className="text-sm font-medium">
          Display name
        </label>
        <InputField
          id="display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={60}
          placeholder="What people see"
        />
        {/* Said explicitly, because the alternative is somebody discovering
            their legal name on a public page. */}
        <p className="text-2xs text-muted-foreground">
          Shown instead of the name on your account, which came from your
          sign-in and may be your legal name.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="bio" className="text-sm font-medium">
          Bio
        </label>
        <Textarea
          id="bio"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={400}
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="website" className="text-sm font-medium">
          Link
        </label>
        <InputField
          id="website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          maxLength={200}
          placeholder="yoursite.com"
          inputMode="url"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void save()}
          loading={saving}
          disabled={!handle || Boolean(handleError)}
        >
          <Check />
          {profile ? "Save" : "Claim handle"}
        </Button>

        {profile ? (
          <Button variant="ghost" asChild>
            <Link href={`/u/${profile.handle}`}>
              View public profile
              <ExternalLink />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
