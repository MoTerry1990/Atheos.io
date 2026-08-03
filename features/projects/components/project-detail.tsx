"use client";

import {
  ArrowLeft,
  Download,
  ImageIcon,
  Images,
  Star,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { Textarea } from "@/components/ui/textarea";
import { SaveIndicator } from "@/features/projects/components/save-indicator";
import {
  ApiError,
  type ProjectAsset,
  type ProjectDetail as ProjectDetailData,
  type ProjectPatch,
} from "@/features/projects/lib/api";
import { useProjectsApi } from "@/features/projects/lib/api-context";
import { useAutosave } from "@/features/projects/lib/use-autosave";
import { assetUrl } from "@/features/studio/lib/job-mapper";
import { formatBytes } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * One project: its contents and its metadata.
 *
 * ## Metadata autosaves; contents do not
 *
 * Typing a name or a note saves itself after a pause — see `use-autosave`.
 * Removing a result from the project does not, and asks first. The rule is that
 * autosave is for changes that are cheap to reverse by typing again, and
 * anything that removes something gets a deliberate action.
 *
 * ## The local copy is authoritative while editing
 *
 * The fields are uncontrolled by the server response: a refetch landing
 * mid-sentence and replacing the text under the cursor is the classic
 * autosaving-form bug. The server's copy is read once on load and after that
 * the browser owns it until the user leaves.
 */
export function ProjectDetail({ projectId }: { projectId: string }) {
  const { loadProject, patchProject, removeFromProject } = useProjectsApi();

  const [project, setProject] = useState<ProjectDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local editing copies. Seeded once from the server, then owned here.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);

  const save = useCallback(
    async (patch: ProjectPatch) => {
      const { project: updated } = await patchProject(projectId, patch);
      // Merged rather than replaced: the response is a summary and this view
      // holds the assets, which it does not carry.
      setProject((current) => (current ? { ...current, ...updated } : current));
    },
    [projectId, patchProject],
  );

  const autosave = useAutosave<ProjectPatch>(save);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { project: data } = await loadProject(projectId, {
        markOpened: true,
      });
      setProject(data);
      setName(data.name);
      setDescription(data.description ?? "");
      setNotes(data.notes ?? "");
      setTags(data.tags);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load that project.",
      );
    }
  }, [projectId, loadProject]);

  useEffect(() => {
    void load();
  }, [load]);

  function commitTag() {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || tags.includes(tag) || tags.length >= 20) {
      setTagDraft("");
      return;
    }
    const next = [...tags, tag];
    setTags(next);
    setTagDraft("");
    autosave.schedule({ tags: next });
  }

  function removeTag(tag: string) {
    const next = tags.filter((entry) => entry !== tag);
    setTags(next);
    autosave.schedule({ tags: next });
  }

  async function removeSelected() {
    if (selected.length === 0 || !project) return;
    setRemoving(true);
    try {
      await removeFromProject(projectId, selected);
      toast.success(
        `Removed ${selected.length} from ${project.name}`,
        // Said explicitly, because "remove" beside a picture reads as "delete".
        "The files are still in your library.",
      );
      setSelected([]);
      await load();
    } catch (cause) {
      toast.error("Could not remove those", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setRemoving(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load that project"
        description={error}
        onRetry={() => void load()}
        action={
          <Button variant="ghost" asChild>
            <Link href="/projects">Back to projects</Link>
          </Button>
        }
      />
    );
  }

  if (!project) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <SkeletonGrid count={6} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/projects">
              <ArrowLeft />
              Projects
            </Link>
          </Button>

          {project.isArchived ? (
            <Badge variant="outline" size="sm">
              Archived
            </Badge>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            {selected.length > 0 ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    selected.forEach((id) => {
                      const anchor = document.createElement("a");
                      anchor.href = `/api/assets/${id}/download`;
                      anchor.download = "";
                      anchor.click();
                    })
                  }
                >
                  <Download />
                  Download {selected.length}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={removing}
                  onClick={() => void removeSelected()}
                >
                  <Trash2 />
                  Remove from project
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected([])}
                >
                  Clear
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {project.assets.length === 0 ? (
          <EmptyState
            icon={Images}
            title="Nothing in this project yet"
            description="Generate something in the studio and use “Save to project”, and it will appear here."
            action={
              <Button variant="gradient" asChild>
                <Link href="/studio">Open the studio</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {project.assets.map((asset) => (
              <li key={asset.id} className="min-w-0">
                <AssetTile
                  asset={asset}
                  selected={selected.includes(asset.id)}
                  isCover={project.coverAssetId === asset.id}
                  onToggle={() =>
                    setSelected((current) =>
                      current.includes(asset.id)
                        ? current.filter((id) => id !== asset.id)
                        : [...current, asset.id],
                    )
                  }
                  onSetCover={() => {
                    setProject((current) =>
                      current
                        ? {
                            ...current,
                            coverKey: asset.storageKey,
                            coverAssetId: asset.id,
                          }
                        : current,
                    );
                    autosave.schedule({ coverAssetId: asset.id });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Metadata. A panel rather than a dialog: it is reference material as
          much as an editor, and the notes are read while looking at the work. */}
      <aside className="space-y-5 lg:w-72 lg:shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            Project
          </h2>
          <SaveIndicator state={autosave.state} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-name" className="text-sm font-medium">
            Name
          </label>
          <InputField
            id="project-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) {
                autosave.schedule({ name: event.target.value.trim() });
              }
            }}
            onBlur={() => void autosave.flush()}
            maxLength={120}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-description" className="text-sm font-medium">
            Description
          </label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              autosave.schedule({ description: event.target.value });
            }}
            onBlur={() => void autosave.flush()}
            maxLength={400}
            rows={2}
            placeholder="One line, shown on the card"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Tags</span>
          {tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    // `min-h-6` is 24px — WCAG 2.5.8's minimum target size.
                    // A tag chip sized to its text lands at about 20, which is
                    // the same miss this codebase made on the marketing footer.
                    className="flex min-h-6 items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                    aria-label={`Remove tag ${tag}`}
                  >
                    {tag}
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <InputField
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commitTag();
              }
            }}
            onBlur={commitTag}
            placeholder="Add a tag"
            aria-label="Add a tag"
            maxLength={40}
          />
          <p className="text-2xs text-muted-foreground">
            Lower-cased and de-duplicated, so search finds them reliably.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="project-notes" className="text-sm font-medium">
            Notes
          </label>
          <Textarea
            id="project-notes"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              autosave.schedule({ notes: event.target.value });
            }}
            onBlur={() => void autosave.flush()}
            rows={6}
            placeholder="Brief, references, anything worth keeping with the work"
          />
        </div>

        <Button
          variant={project.isFavorite ? "glow" : "outline"}
          size="sm"
          block
          onClick={() => {
            const next = !project.isFavorite;
            setProject((current) =>
              current ? { ...current, isFavorite: next } : current,
            );
            autosave.schedule({ isFavorite: next });
          }}
          aria-pressed={project.isFavorite}
        >
          <Star className={project.isFavorite ? "fill-current" : undefined} />
          {project.isFavorite ? "Favourited" : "Add to favourites"}
        </Button>

        <dl className="space-y-1 border-t pt-3 text-2xs text-muted-foreground tabular-nums">
          <div className="flex justify-between gap-2">
            <dt>Items</dt>
            <dd>{project.assets.length}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Size</dt>
            <dd>{formatBytes(project.totalBytes)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Created</dt>
            <dd>{new Date(project.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

/**
 * One item in the project.
 *
 * Selection is a checkbox drawn as the tile itself — a separate checkbox beside
 * every thumbnail would double the number of targets and halve the size of the
 * picture, which is the thing being chosen.
 */
function AssetTile({
  asset,
  selected,
  isCover,
  onToggle,
  onSetCover,
}: {
  asset: ProjectAsset;
  selected: boolean;
  isCover: boolean;
  onToggle: () => void;
  onSetCover: () => void;
}) {
  const url = assetUrl(asset.storageKey);
  const isVideo = asset.mimeType.startsWith("video/");

  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-lg border transition-colors",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
      )}
      style={{
        aspectRatio: `${asset.width ?? 1} / ${asset.height ?? 1}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? "Deselect" : "Select"}
        className="absolute inset-0 z-10 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      />

      {url ? (
        isVideo ? (
          // Muted, no controls, `preload="metadata"`: this is a thumbnail in a
          // grid. Loading and decoding a dozen clips in full to show a wall of
          // stills would be a lot of somebody's bandwidth.
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <Image
            src={url}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, 240px"
            className="absolute inset-0 size-full object-cover"
          />
        )
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground">
          <ImageIcon className="size-5" aria-hidden />
        </div>
      )}

      {isVideo ? (
        <Badge
          variant="outline"
          size="sm"
          className="absolute top-1.5 left-1.5 bg-background/80 backdrop-blur-sm"
        >
          {asset.durationMs
            ? `${Math.round(asset.durationMs / 1000)}s`
            : "Video"}
        </Badge>
      ) : null}

      <figcaption className="absolute inset-x-0 bottom-0 z-20 flex justify-end p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:opacity-100">
        <Button
          size="icon-xs"
          variant={isCover ? "glow" : "secondary"}
          onClick={onSetCover}
          aria-pressed={isCover}
          aria-label={isCover ? "Current cover" : "Use as cover"}
          title={isCover ? "Current cover" : "Use as cover"}
        >
          <ImageIcon />
        </Button>
      </figcaption>
    </figure>
  );
}
