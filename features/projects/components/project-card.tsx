"use client";

import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderInput,
  Images,
  MoreVertical,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { assetUrl } from "@/features/studio/lib/job-mapper";
import type {
  FolderSummary,
  ProjectSummary,
} from "@/features/projects/lib/api";
import { formatRelativeTime } from "@/utils/format";
import { cn } from "@/lib/utils";

/**
 * One project.
 *
 * ## The card is a link; the controls are not inside it
 *
 * A `<button>` nested in an `<a>` is invalid HTML and behaves unpredictably —
 * the menu trigger would navigate on some browsers. So the link covers the card
 * as a positioned overlay, and the star and the menu sit above it in the stacking
 * order. Everything stays reachable by keyboard in a sensible order.
 *
 * ## The tint is the fallback, not decoration
 *
 * A project with no cover gets its accent hue rather than a grey box, so a wall
 * of new projects is still scannable. Once a cover is set the image replaces it
 * and the hue survives as the border accent.
 */
export function ProjectCard({
  project,
  folders,
  onRename,
  onToggleFavorite,
  onDuplicate,
  onArchive,
  onMove,
  onDelete,
  busy,
}: {
  project: ProjectSummary;
  folders: FolderSummary[];
  onRename: (project: ProjectSummary) => void;
  onToggleFavorite: (project: ProjectSummary) => void;
  onDuplicate: (project: ProjectSummary) => void;
  onArchive: (project: ProjectSummary) => void;
  onMove: (project: ProjectSummary, folderId: string | null) => void;
  onDelete: (project: ProjectSummary) => void;
  busy?: boolean;
}) {
  const cover = project.coverKey ? assetUrl(project.coverKey) : "";

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors",
        "focus-within:border-primary/40 hover:border-border/70",
        busy && "opacity-60",
      )}
      style={{ borderTopColor: `oklch(0.65 0.18 ${project.hue} / 0.55)` }}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundColor: "oklch(0.16 0.02 300)",
            backgroundImage: `radial-gradient(120% 120% at 25% 20%, oklch(0.7 0.19 ${project.hue} / 0.8), transparent 65%), radial-gradient(100% 100% at 80% 80%, oklch(0.55 0.2 ${(project.hue + 60) % 360} / 0.6), transparent 60%)`,
          }}
        />

        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}

        {project.isArchived ? (
          <Badge
            variant="outline"
            size="sm"
            className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm"
          >
            Archived
          </Badge>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        {/* `h2`, not `h3`. These are the page's primary content, directly
            under its `h1` — an `h3` here skipped a level and broke sequential
            heading navigation for the sake of looking smaller, which is what
            the `size`/`as` split on `Heading` exists to avoid. */}
        <h2 className="truncate text-sm font-medium">
          {/* The whole card is the hit area. `after:absolute inset-0` is the
              standard way to do that without wrapping interactive controls in
              an anchor. */}
          <Link
            href={`/projects/${project.id}`}
            className="rounded after:absolute after:inset-0 focus-visible:outline-none"
          >
            {project.name}
          </Link>
        </h2>

        {project.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {project.description}
          </p>
        ) : null}

        {project.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map((tag) => (
              <li
                key={tag}
                className="rounded-full bg-secondary px-1.5 py-0.5 text-2xs text-secondary-foreground"
              >
                {tag}
              </li>
            ))}
            {project.tags.length > 3 ? (
              <li className="text-2xs text-muted-foreground">
                +{project.tags.length - 3}
              </li>
            ) : null}
          </ul>
        ) : null}

        <p className="mt-auto flex items-center gap-2 pt-1 text-2xs text-muted-foreground tabular-nums">
          <Images className="size-3" aria-hidden />
          {project.assetCount}
          <span aria-hidden>·</span>
          <time dateTime={new Date(project.updatedAt).toISOString()}>
            {formatRelativeTime(project.updatedAt)}
          </time>
        </p>
      </div>

      {/* Above the link overlay, so these stay clickable. */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <Button
          size="icon-xs"
          variant={project.isFavorite ? "glow" : "secondary"}
          onClick={() => onToggleFavorite(project)}
          aria-pressed={project.isFavorite}
          aria-label={
            project.isFavorite
              ? `Remove ${project.name} from favourites`
              : `Add ${project.name} to favourites`
          }
          title={project.isFavorite ? "Remove from favourites" : "Favourite"}
          className={cn(
            !project.isFavorite &&
              "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:opacity-100",
          )}
        >
          <Star
            className={project.isFavorite ? "fill-current" : undefined}
            aria-hidden
          />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="secondary"
              aria-label={`Actions for ${project.name}`}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => onRename(project)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(project)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onArchive(project)}>
              {project.isArchived ? <ArchiveRestore /> : <Archive />}
              {project.isArchived ? "Restore" : "Archive"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-2xs tracking-wider uppercase">
              Move to
            </DropdownMenuLabel>

            <DropdownMenuItem
              onSelect={() => onMove(project, null)}
              disabled={project.folderId === null}
            >
              <FolderInput />
              Unfiled
            </DropdownMenuItem>
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onSelect={() => onMove(project, folder.id)}
                disabled={project.folderId === folder.id}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `oklch(0.7 0.18 ${folder.hue})` }}
                />
                {folder.name}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(project)}
            >
              <Trash2 />
              Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
