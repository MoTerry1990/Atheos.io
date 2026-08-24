"use client";

import { FolderOpen, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/field";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import {
  FolderRail,
  type RailSelection,
} from "@/features/projects/components/folder-rail";
import { NameDialog } from "@/features/projects/components/name-dialog";
import { ProjectCard } from "@/features/projects/components/project-card";
import {
  ApiError,
  type FolderSummary,
  type ProjectSummary,
  type ProjectView,
} from "@/features/projects/lib/api";
import { useProjectsApi } from "@/features/projects/lib/api-context";
import { toast } from "@/lib/toast";

/**
 * The projects page.
 *
 * ## Every mutation refetches
 *
 * Rename, archive, move, duplicate and delete all end in a reload of the
 * current view. That is one extra request and it buys correctness: archiving
 * inside "All" removes the card, moving into a folder changes two folder
 * counts, and duplicating produces a name the client did not choose. Patching
 * local state to match would be reimplementing the server's filtering and
 * ordering in the browser — and getting it subtly wrong.
 *
 * The exception is the favourite star, which is optimistic. It is the one
 * action people repeat quickly, and a round trip before the star fills makes it
 * feel broken.
 *
 * ## Search is debounced and abortable
 *
 * Typing "landscape" is nine keystrokes. Without debouncing that is nine
 * queries; without an abort signal the fourth can land after the ninth and show
 * results for "land".
 */
export function ProjectsBrowser() {
  const {
    loadProjects,
    createProject,
    patchProject,
    duplicateProject,
    deleteProject,
    createFolder,
    patchFolder,
    deleteFolder,
  } = useProjectsApi();

  const [selection, setSelection] = useState<RailSelection>({
    kind: "view",
    view: "all",
  });
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderSummary | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] =
    useState<ProjectSummary | null>(null);
  const [confirmingFolderDelete, setConfirmingFolderDelete] =
    useState<FolderSummary | null>(null);
  const [pending, setPending] = useState(false);

  const controller = useRef<AbortController | null>(null);

  const view: ProjectView = selection.kind === "view" ? selection.view : "all";
  const folderId = selection.kind === "folder" ? selection.folderId : undefined;

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    setError(null);
    try {
      const data = await loadProjects({
        view,
        folderId,
        search,
        signal: next.signal,
      });
      setProjects(data.projects);
      setFolders(data.folders);
    } catch (cause) {
      // An abort is this component superseding its own request, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (cause instanceof ApiError && cause.code === "aborted") return;
      setError(
        cause instanceof ApiError ? cause.message : "Could not load projects.",
      );
    } finally {
      setLoading(false);
    }
  }, [view, folderId, search, loadProjects]);

  useEffect(() => {
    setLoading(true);
    // 250ms: below the threshold where a list feels laggy, above the interval
    // between keystrokes for anyone typing at speed.
    const timer = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refresh, search]);

  useEffect(() => () => controller.current?.abort(), []);

  /** Run a mutation, report failure, then reload the view. */
  async function run<T>(
    id: string | null,
    action: () => Promise<T>,
    fallback: string,
  ): Promise<T | null> {
    setBusyId(id);
    try {
      return await action();
    } catch (cause) {
      toast.error(fallback, {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
      return null;
    } finally {
      setBusyId(null);
      await refresh();
    }
  }

  async function toggleFavorite(project: ProjectSummary) {
    const next = !project.isFavorite;

    // Optimistic: this is the one control people click repeatedly.
    setProjects((current) =>
      current.map((entry) =>
        entry.id === project.id ? { ...entry, isFavorite: next } : entry,
      ),
    );

    try {
      await patchProject(project.id, { isFavorite: next });
    } catch (cause) {
      setProjects((current) =>
        current.map((entry) =>
          entry.id === project.id
            ? { ...entry, isFavorite: project.isFavorite }
            : entry,
        ),
      );
      toast.error("Could not update that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
      return;
    }

    // Only the Favourites view changes membership, so only it needs a reload.
    if (view === "favorites") await refresh();
  }

  const heading =
    selection.kind === "view"
      ? {
          all: "All projects",
          recent: "Recent",
          favorites: "Favourites",
          archived: "Archived",
        }[selection.view]
      : selection.folderId === null
        ? "Unfiled"
        : (folders.find((folder) => folder.id === selection.folderId)?.name ??
          "Folder");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <FolderRail
        folders={folders}
        selection={selection}
        onSelect={setSelection}
        onCreateFolder={(name) =>
          void run(
            null,
            () => createFolder(name),
            "Could not create that folder",
          )
        }
        onRenameFolder={setRenamingFolder}
        onDeleteFolder={setConfirmingFolderDelete}
        className="lg:w-56 lg:shrink-0"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-lg font-semibold tracking-tight">
            {heading}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {loading ? "" : projects.length}
            </span>
          </h1>

          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            {/* The magnifier, the padding it needs and the clear button all
                come from the primitive now. Three screens had three
                hand-placed versions of this, and two of them left the icon
                6px from the first character. */}
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search projects and tags"
              aria-label="Search projects"
            />
          </div>

          <Button variant="gradient" onClick={() => setCreating(true)}>
            <Plus />
            New project
          </Button>
        </div>

        {error ? (
          <ErrorState
            title="Could not load projects"
            description={error}
            onRetry={() => void refresh()}
          />
        ) : loading ? (
          <SkeletonGrid count={6} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={search ? "Nothing matches that" : "No projects here yet"}
            description={
              search
                ? "Try a different word, or search a tag."
                : view === "archived"
                  ? "Archived projects appear here. Nothing has been archived."
                  : "Group your generations into projects to find them again. You can also save straight from the studio."
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id} className="min-w-0 card-defer">
                <ProjectCard
                  project={project}
                  folders={folders}
                  busy={busyId === project.id}
                  onRename={setRenaming}
                  onToggleFavorite={(entry) => void toggleFavorite(entry)}
                  onDuplicate={(entry) =>
                    void run(
                      entry.id,
                      () => duplicateProject(entry.id),
                      "Could not duplicate that project",
                    )
                  }
                  onArchive={(entry) =>
                    void run(
                      entry.id,
                      () =>
                        patchProject(entry.id, { archived: !entry.isArchived }),
                      "Could not archive that project",
                    )
                  }
                  onMove={(entry, target) =>
                    void run(
                      entry.id,
                      () => patchProject(entry.id, { folderId: target }),
                      "Could not move that project",
                    )
                  }
                  onDelete={setConfirmingDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New project"
        description="A place to collect related work. You can move things in and out at any time."
        label="Name"
        withDescription
        confirmLabel="Create"
        pending={pending}
        onSubmit={async (values) => {
          setPending(true);
          const created = await run(
            null,
            () =>
              createProject({
                name: values.name,
                description: values.description || undefined,
                ...(selection.kind === "folder" && selection.folderId
                  ? { folderId: selection.folderId }
                  : {}),
              }),
            "Could not create that project",
          );
          setPending(false);
          if (created) {
            setCreating(false);
            toast.success("Project created", created.project.name);
          }
        }}
      />

      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename project"
        label="Name"
        initialName={renaming?.name}
        confirmLabel="Save"
        pending={pending}
        onSubmit={async (values) => {
          if (!renaming) return;
          setPending(true);
          const result = await run(
            renaming.id,
            () => patchProject(renaming.id, { name: values.name }),
            "Could not rename that project",
          );
          setPending(false);
          if (result) setRenaming(null);
        }}
      />

      <NameDialog
        open={renamingFolder !== null}
        onOpenChange={(open) => !open && setRenamingFolder(null)}
        title="Rename folder"
        label="Name"
        initialName={renamingFolder?.name}
        confirmLabel="Save"
        pending={pending}
        onSubmit={async (values) => {
          if (!renamingFolder) return;
          setPending(true);
          const result = await run(
            null,
            () => patchFolder(renamingFolder.id, { name: values.name }),
            "Could not rename that folder",
          );
          setPending(false);
          if (result) setRenamingFolder(null);
        }}
      />

      <AlertDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{confirmingDelete?.name}”?
            </AlertDialogTitle>
            {/* The reassurance is the point. Without it, "delete project" reads
                as "delete my generations", and the safe action — archive — is
                one the user has to be told about at the moment they hesitate. */}
            <AlertDialogDescription>
              The project is removed permanently.{" "}
              <strong className="font-medium text-foreground">
                Your {confirmingDelete?.assetCount ?? 0} generation
                {confirmingDelete?.assetCount === 1 ? "" : "s"} are kept
              </strong>{" "}
              — they stay in your library and in any other project. If you only
              want it out of the way, archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmingDelete;
                setConfirmingDelete(null);
                if (!target) return;
                void run(
                  target.id,
                  () => deleteProject(target.id),
                  "Could not delete that project",
                ).then((result) => {
                  if (result) toast.success("Project deleted", target.name);
                });
              }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmingFolderDelete !== null}
        onOpenChange={(open) => !open && setConfirmingFolderDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{confirmingFolderDelete?.name}”?
            </AlertDialogTitle>
            {/* `totalCount`, not the badge's `projectCount`: archived projects
                are also inside and also move, and promising two while moving
                three is the kind of small dishonesty that costs trust in every
                other number on the page. */}
            <AlertDialogDescription>
              {confirmingFolderDelete?.totalCount === 0
                ? "The folder is empty, so nothing else changes."
                : `The ${confirmingFolderDelete?.totalCount} project${
                    confirmingFolderDelete?.totalCount === 1 ? "" : "s"
                  } inside will move to Unfiled. Nothing is deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmingFolderDelete;
                setConfirmingFolderDelete(null);
                if (!target) return;

                // Selection has to move: staying on a folder that no longer
                // exists would query for it and show a permanently empty grid.
                if (
                  selection.kind === "folder" &&
                  selection.folderId === target.id
                ) {
                  setSelection({ kind: "view", view: "all" });
                }

                void run(
                  null,
                  () => deleteFolder(target.id),
                  "Could not delete that folder",
                ).then((result) => {
                  if (result) {
                    toast.success(
                      "Folder deleted",
                      result.unfiled > 0
                        ? `${result.unfiled} project${result.unfiled === 1 ? "" : "s"} moved to Unfiled`
                        : undefined,
                    );
                  }
                });
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
