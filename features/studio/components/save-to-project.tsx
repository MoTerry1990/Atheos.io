"use client";

import { Check, FolderPlus, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputField } from "@/components/ui/field";
import {
  ApiError,
  createCollection,
  listCollections,
  saveToCollection,
  type CollectionSummary,
} from "@/features/studio/lib/api";
import type { StudioJob } from "@/features/studio/types";
import { toast } from "@/lib/toast";

/**
 * Save a result into a project.
 *
 * ## Why it lives beside the result, not in the composer
 *
 * Submitting a generation can already name a collection, and that is the right
 * shape when someone is deliberately working *into* a project. It is the wrong
 * shape for how the studio is actually used: you generate four things, and one
 * of them turns out to be worth keeping. That decision happens here, looking at
 * the output — and it has to work for a result from last week too.
 *
 * ## The list loads when the menu opens
 *
 * Not on mount. Most sessions never open this, and fetching a user's projects
 * to render a button nobody presses is a query per studio load for nothing.
 *
 * ## Creating is inline
 *
 * The first save any new user makes is into a project that does not exist yet.
 * Sending them to a projects page to create one, then back here to select it,
 * is three navigations to express one intention.
 */
export function SaveToProject({ job }: { job: StudioJob }) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const assetIds = job.outputs.map((output) => output.id);

  // Nothing to file. A running or failed job has no stored assets, and offering
  // to save one would be offering to save nothing.
  if (job.status !== "succeeded" || assetIds.length === 0) return null;

  async function load() {
    if (collections !== null || loading) return;
    setLoading(true);
    try {
      const { collections: list } = await listCollections();
      setCollections(list);
    } catch (cause) {
      toast.error("Could not load your projects", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
      // Left null so opening the menu again retries rather than showing an
      // empty list that looks like "you have no projects".
    } finally {
      setLoading(false);
    }
  }

  async function save(collection: CollectionSummary) {
    setPendingId(collection.id);
    try {
      const { added } = await saveToCollection(collection.id, assetIds);
      setSavedIds((ids) => [...ids, collection.id]);

      toast.success(
        added > 0 ? `Saved to ${collection.name}` : "Already in that project",
        added > 0
          ? `${added} ${added === 1 ? "result" : "results"}`
          : undefined,
      );
    } catch (cause) {
      toast.error("Could not save", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setPendingId(null);
    }
  }

  async function createAndSave() {
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const { collection } = await createCollection(name);
      setCollections((list) => [collection, ...(list ?? [])]);
      setNewName("");
      await save(collection);
    } catch (cause) {
      toast.error("Could not create that project", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs">
          <FolderPlus />
          Save to project
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[min(20rem,90vw)]">
        <DropdownMenuLabel className="text-2xs tracking-wider uppercase">
          {assetIds.length === 1
            ? "Save this result"
            : `Save ${assetIds.length} results`}
        </DropdownMenuLabel>

        {loading ? (
          <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading projects…
          </p>
        ) : collections && collections.length > 0 ? (
          collections.map((collection) => (
            <DropdownMenuItem
              key={collection.id}
              // Kept open so several projects can be picked in one go, which is
              // the point of a multi-membership model.
              onSelect={(event) => {
                event.preventDefault();
                void save(collection);
              }}
              className="justify-between gap-2"
            >
              <span className="min-w-0 truncate text-sm">
                {collection.name}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                {pendingId === collection.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : savedIds.includes(collection.id) ? (
                  <Check className="size-3.5 text-success" aria-hidden />
                ) : (
                  collection.assetCount
                )}
              </span>
            </DropdownMenuItem>
          ))
        ) : collections ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No projects yet. Name one below.
          </p>
        ) : null}

        <DropdownMenuSeparator />

        {/* Inside the menu, so the keystroke that names a project does not also
            close it. Radix routes typing to its own typeahead otherwise. */}
        <div
          className="flex gap-1.5 p-1.5"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <InputField
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createAndSave();
              }
            }}
            placeholder="New project"
            aria-label="New project name"
            className="h-8 text-sm"
          />
          <Button
            size="icon-sm"
            variant="secondary"
            onClick={() => void createAndSave()}
            loading={creating}
            disabled={!newName.trim()}
            aria-label="Create project and save"
            title="Create project and save"
          >
            <Plus />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
