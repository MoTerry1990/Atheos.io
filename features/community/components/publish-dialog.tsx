"use client";

import { Globe, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/features/community/lib/api";
import { useCommunityApi } from "@/features/community/lib/api-context";
import { toast } from "@/lib/toast";

/**
 * Publish one result.
 *
 * ## Three separate decisions, not one switch
 *
 * Publishing the image, showing the prompt, and writing a caption. The prompt
 * is the one that matters: it is what people most want to see and what a
 * professional is most likely to consider their method. Bundling it into
 * "publish" would take that choice away from them silently.
 *
 * ## It says what publishing means before doing it
 *
 * "Anyone with the link, and it appears in Explore." Not a euphemism —
 * somebody about to make their work public should be told what that includes,
 * once, at the moment they can still stop.
 *
 * ## No handle means a different dialog
 *
 * Publishing needs a public profile, so a post has somewhere to point. Asking
 * at this moment is the only time the reason is obvious.
 */
export function PublishDialog({
  open,
  onOpenChange,
  assetId,
  hasHandle,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  hasHandle: boolean;
  onPublished?: (slug: string) => void;
}) {
  const api = useCommunityApi();

  const [caption, setCaption] = useState("");
  const [showPrompt, setShowPrompt] = useState(true);
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    setPublishing(true);
    try {
      const { slug } = await api.publishAsset({
        assetId,
        caption: caption.trim() || undefined,
        showPrompt,
      });
      toast.success("Published", "It is now visible in Explore.");
      onOpenChange(false);
      setCaption("");
      onPublished?.(slug);
    } catch (cause) {
      toast.error("Could not publish", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish this result</DialogTitle>
          <DialogDescription>
            It becomes visible to anyone with the link and appears in Explore.
            You can take it down at any time.
          </DialogDescription>
        </DialogHeader>

        {!hasHandle ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              Publishing needs a public handle, so your work has a profile to
              belong to. Nothing about you is public until you claim one.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button asChild>
                <Link href="/settings/profile">Choose a handle</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="publish-caption" className="text-sm font-medium">
                Caption{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Textarea
                id="publish-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={600}
                rows={3}
                placeholder="What is worth knowing about this?"
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {showPrompt ? (
                    <Globe className="size-3.5" aria-hidden />
                  ) : (
                    <Lock className="size-3.5" aria-hidden />
                  )}
                  Show the prompt
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {showPrompt
                    ? "Anyone viewing the post can read the prompt that produced it."
                    : "The prompt stays private. The image is still public."}
                </p>
              </div>
              <Switch
                checked={showPrompt}
                onCheckedChange={setShowPrompt}
                aria-label="Show the prompt publicly"
              />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="gradient"
                loading={publishing}
                onClick={() => void publish()}
              >
                <Globe />
                Publish
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
