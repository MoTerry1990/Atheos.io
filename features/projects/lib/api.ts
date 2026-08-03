import { ApiError, request } from "@/lib/http";

/**
 * The projects client.
 *
 * Reuses the studio's `ApiError` rather than defining a second one: a component
 * that shows an error should not have to ask which feature threw it. The
 * request helper is deliberately duplicated in miniature instead — the studio's
 * is not exported, and exporting it would make an internal helper into a
 * contract for the sake of nine lines.
 */

export { ApiError };

export interface FolderSummary {
  id: string;
  name: string;
  hue: number;
  /** What opening the folder shows — archived excluded. */
  projectCount: number;
  /** Everything inside, archived included. What a delete would unfile. */
  totalCount: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  hue: number;
  folderId: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  assetCount: number;
  coverKey: string | null;
  coverAssetId: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface ProjectAsset {
  id: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  addedAt: number;
}

export interface ProjectDetail extends ProjectSummary {
  notes: string | null;
  assets: ProjectAsset[];
  totalBytes: number;
}

export type ProjectView = "all" | "recent" | "favorites" | "archived";

export function loadProjects(options: {
  view?: ProjectView;
  /** `null` selects unfiled; `undefined` applies no folder filter at all. */
  folderId?: string | null;
  search?: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (options.view) params.set("view", options.view);
  if (options.folderId !== undefined) {
    params.set("folder", options.folderId ?? "unfiled");
  }
  if (options.search?.trim()) params.set("q", options.search.trim());

  return request<{
    projects: ProjectSummary[];
    folders: FolderSummary[];
    view: ProjectView;
  }>(`/api/projects?${params}`, { signal: options.signal });
}

export function loadProject(
  id: string,
  options: { markOpened?: boolean } = {},
) {
  return request<{ project: ProjectDetail }>(
    `/api/projects/${id}${options.markOpened ? "?open=1" : ""}`,
  );
}

export function createProject(input: {
  name: string;
  description?: string;
  folderId?: string;
}) {
  return request<{ project: ProjectSummary }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  notes?: string | null;
  tags?: string[];
  hue?: number;
  coverAssetId?: string | null;
  folderId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
}

export function patchProject(id: string, patch: ProjectPatch) {
  return request<{ project: ProjectSummary }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function duplicateProject(id: string) {
  return request<{ project: ProjectSummary }>(`/api/projects/${id}/duplicate`, {
    method: "POST",
  });
}

export function deleteProject(id: string) {
  return request<{ deleted: { id: string; name: string } }>(
    `/api/projects/${id}`,
    { method: "DELETE" },
  );
}

export function removeFromProject(id: string, assetIds: string[]) {
  return request<{ removed: number }>(`/api/projects/${id}/assets`, {
    method: "DELETE",
    body: JSON.stringify({ assetIds }),
  });
}

export function loadFolders() {
  return request<{ folders: FolderSummary[] }>("/api/folders");
}

export function createFolder(name: string, hue?: number) {
  return request<{ folder: FolderSummary }>("/api/folders", {
    method: "POST",
    body: JSON.stringify({ name, ...(hue !== undefined ? { hue } : {}) }),
  });
}

export function patchFolder(
  id: string,
  patch: { name?: string; hue?: number },
) {
  return request<{ folder: FolderSummary }>(`/api/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteFolder(id: string) {
  return request<{ unfiled: number }>(`/api/folders/${id}`, {
    method: "DELETE",
  });
}
