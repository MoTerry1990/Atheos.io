"use client";

import {
  Archive,
  Clock,
  Folder,
  FolderPlus,
  Layers,
  MoreVertical,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputField } from "@/components/ui/field";
import type { FolderSummary, ProjectView } from "@/features/projects/lib/api";
import { cn } from "@/lib/utils";

/**
 * Views and folders.
 *
 * ## Views and folders are one list, not two controls
 *
 * "Recent", "Favourites" and a folder are all answers to "which projects am I
 * looking at", so they share one selection. Splitting them into a tab bar plus a
 * folder tree invites a state nobody wants — Favourites *and* a folder — and
 * then an argument about what it means.
 *
 * ## Unfiled is always present
 *
 * A folder can be deleted and its projects survive, unfiled. Without a
 * permanent Unfiled entry those projects would exist with nowhere to see them,
 * which is the failure this row prevents.
 */

export type RailSelection =
  | { kind: "view"; view: ProjectView }
  | { kind: "folder"; folderId: string | null };

const VIEWS: { view: ProjectView; label: string; icon: typeof Layers }[] = [
  { view: "all", label: "All projects", icon: Layers },
  { view: "recent", label: "Recent", icon: Clock },
  { view: "favorites", label: "Favourites", icon: Star },
  { view: "archived", label: "Archived", icon: Archive },
];

export function FolderRail({
  folders,
  selection,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  className,
}: {
  folders: FolderSummary[];
  selection: RailSelection;
  onSelect: (selection: RailSelection) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folder: FolderSummary) => void;
  onDeleteFolder: (folder: FolderSummary) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateFolder(trimmed);
    setName("");
    setAdding(false);
  }

  const isActive = (candidate: RailSelection) =>
    candidate.kind === selection.kind &&
    (candidate.kind === "view"
      ? candidate.view === (selection as { view: ProjectView }).view
      : candidate.folderId ===
        (selection as { folderId: string | null }).folderId);

  const rowClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
      "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
      active
        ? "bg-secondary font-medium text-secondary-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    );

  return (
    <nav
      aria-label="Project views and folders"
      className={cn("space-y-4", className)}
    >
      <ul className="space-y-0.5">
        {VIEWS.map((entry) => {
          const active = isActive({ kind: "view", view: entry.view });
          return (
            <li key={entry.view}>
              <button
                type="button"
                onClick={() => onSelect({ kind: "view", view: entry.view })}
                aria-current={active ? "page" : undefined}
                className={rowClass(active)}
              >
                <entry.icon className="size-4 shrink-0" aria-hidden />
                {entry.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 px-2.5">
          {/* A `<p>`, not a heading.

              It sat before the page `<h1>` in DOM order, so the outline opened
              `h2, h1, h3` — a screen reader's heading list led with a group
              label from a sidebar. The `<nav>` around it already carries an
              accessible name, which is what actually makes this region
              navigable; the label is styling. */}
          <p className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            Folders
          </p>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setAdding((open) => !open)}
            aria-expanded={adding}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus />
          </Button>
        </div>

        {adding ? (
          <div className="px-1.5 pb-1">
            <InputField
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") {
                  setAdding(false);
                  setName("");
                }
              }}
              onBlur={submit}
              placeholder="Folder name"
              aria-label="New folder name"
              className="h-8 text-sm"
            />
          </div>
        ) : null}

        <ul className="space-y-0.5">
          {folders.map((folder) => {
            const active = isActive({ kind: "folder", folderId: folder.id });
            return (
              <li key={folder.id} className="group/folder relative">
                <button
                  type="button"
                  onClick={() =>
                    onSelect({ kind: "folder", folderId: folder.id })
                  }
                  aria-current={active ? "page" : undefined}
                  className={cn(rowClass(active), "pr-8")}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: `oklch(0.7 0.18 ${folder.hue})`,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {folder.projectCount}
                  </span>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Actions for ${folder.name}`}
                      className="absolute top-1 right-0.5 opacity-0 group-focus-within/folder:opacity-100 group-hover/folder:opacity-100 motion-reduce:opacity-100"
                    >
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRenameFolder(folder)}>
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteFolder(folder)}
                    >
                      <Trash2 />
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}

          <li>
            {(() => {
              const active = isActive({ kind: "folder", folderId: null });
              return (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "folder", folderId: null })}
                  aria-current={active ? "page" : undefined}
                  className={rowClass(active)}
                >
                  <Folder className="size-4 shrink-0" aria-hidden />
                  Unfiled
                </button>
              );
            })()}
          </li>
        </ul>
      </div>
    </nav>
  );
}
