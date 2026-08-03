import type {
  FolderSummary,
  ProjectAsset,
  ProjectDetail,
  ProjectPatch,
  ProjectSummary,
  ProjectView,
} from "@/features/projects/lib/api";
import { ApiError } from "@/features/projects/lib/api";
import type { ProjectsApi } from "@/features/projects/lib/api-context";

/**
 * An in-memory projects backend.
 *
 * Implements the same `ProjectsApi` the real client does, over a mutable array.
 * It exists because there is no database in this environment, and a page that
 * cannot be clicked has not been verified — a lesson every sprint in this
 * project has repeated.
 *
 * It is a **fixture, not a mock in the testing sense**: the point is not to
 * assert calls, it is to make the interface behave so the interaction design
 * can be looked at. Where the server has a rule worth exercising, this
 * reproduces it — unique names, the copy-name generator, archived hidden from
 * every view but Archived, tags lower-cased — because a preview that is more
 * permissive than the server teaches the wrong thing.
 *
 * Latency is simulated. Everything resolving instantly hides every loading
 * state, which is where the interface is at its least finished.
 */

const LATENCY_MS = 180;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function asset(
  id: string,
  overrides: Partial<ProjectAsset> = {},
): ProjectAsset {
  return {
    id,
    // Empty storage keys resolve to an empty URL, so the tiles fall back to
    // their placeholder rather than requesting a bucket that does not exist.
    storageKey: "",
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    durationMs: null,
    sizeBytes: 2_400_000,
    addedAt: 0,
    ...overrides,
  };
}

interface Row extends ProjectSummary {
  notes: string | null;
  assets: ProjectAsset[];
}

export function createFixtureApi(now: number): ProjectsApi {
  const folders: FolderSummary[] = [
    {
      id: "f_client",
      name: "Client work",
      hue: 268,
      projectCount: 2,
      totalCount: 3,
    },
    {
      id: "f_personal",
      name: "Personal",
      hue: 150,
      projectCount: 1,
      totalCount: 1,
    },
  ];

  const rows: Row[] = [
    {
      id: "p_atlas",
      name: "Atlas rebrand",
      description: "Key art exploration for the Atlas identity refresh.",
      notes:
        "Client wants something colder than the last round. Avoid warm oranges.\nDeliverable: 6 key frames + 2 clips.",
      tags: ["client", "branding"],
      hue: 268,
      folderId: "f_client",
      isFavorite: true,
      isArchived: false,
      assetCount: 5,
      coverKey: "",
      coverAssetId: "a_atlas_1",
      createdAt: now - 12 * 86_400_000,
      updatedAt: now - 3 * 3_600_000,
      lastOpenedAt: now - 3 * 3_600_000,
      assets: [
        asset("a_atlas_1"),
        asset("a_atlas_2", { width: 1920, height: 1080 }),
        asset("a_atlas_3", {
          mimeType: "video/mp4",
          width: 1920,
          height: 1080,
          durationMs: 10_000,
          sizeBytes: 18_400_000,
        }),
        asset("a_atlas_4", { width: 1024, height: 1536 }),
        asset("a_atlas_5"),
      ],
    },
    {
      id: "p_harbour",
      name: "Harbour campaign",
      description: "Autumn out-of-home. Nine by sixteen.",
      notes: null,
      tags: ["client", "campaign"],
      hue: 200,
      folderId: "f_client",
      isFavorite: false,
      isArchived: false,
      assetCount: 2,
      coverKey: "",
      coverAssetId: null,
      createdAt: now - 30 * 86_400_000,
      updatedAt: now - 2 * 86_400_000,
      lastOpenedAt: now - 26 * 3_600_000,
      assets: [
        asset("a_harbour_1", { width: 1080, height: 1920 }),
        asset("a_harbour_2", { width: 1080, height: 1920 }),
      ],
    },
    {
      id: "p_studies",
      name: "Light studies",
      description: null,
      notes: "Just messing about with volumetrics.",
      tags: ["personal", "lighting"],
      hue: 150,
      folderId: "f_personal",
      isFavorite: false,
      isArchived: false,
      assetCount: 3,
      coverKey: "",
      coverAssetId: null,
      createdAt: now - 5 * 86_400_000,
      updatedAt: now - 5 * 3_600_000,
      lastOpenedAt: null,
      assets: [asset("a_st_1"), asset("a_st_2"), asset("a_st_3")],
    },
    {
      id: "p_scratch",
      name: "Scratch",
      description: "Unsorted odds and ends.",
      notes: null,
      tags: [],
      hue: 40,
      folderId: null,
      isFavorite: false,
      isArchived: false,
      assetCount: 0,
      coverKey: "",
      coverAssetId: null,
      createdAt: now - 2 * 86_400_000,
      updatedAt: now - 2 * 86_400_000,
      lastOpenedAt: null,
      assets: [],
    },
    {
      id: "p_old",
      name: "Q1 pitch (dead)",
      description: "Kept in case the client comes back.",
      notes: null,
      tags: ["client"],
      hue: 10,
      folderId: null,
      isFavorite: false,
      isArchived: true,
      assetCount: 1,
      coverKey: "",
      coverAssetId: null,
      createdAt: now - 120 * 86_400_000,
      updatedAt: now - 60 * 86_400_000,
      lastOpenedAt: now - 60 * 86_400_000,
      assets: [asset("a_old_1")],
    },
  ];

  function summary(row: Row): ProjectSummary {
    const { notes: _notes, assets: _assets, ...rest } = row;
    return { ...rest, assetCount: row.assets.length };
  }

  function recountFolders() {
    for (const folder of folders) {
      const inside = rows.filter((row) => row.folderId === folder.id);
      folder.projectCount = inside.filter((row) => !row.isArchived).length;
      folder.totalCount = inside.length;
    }
  }

  function find(id: string): Row {
    const row = rows.find((entry) => entry.id === id);
    if (!row)
      throw new ApiError("That project was not found.", 404, "not_found");
    return row;
  }

  function requireFreeName(name: string, exceptId?: string) {
    if (
      rows.some(
        (row) =>
          row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new ApiError(
        `You already have a project called “${name}”.`,
        409,
        "duplicate_name",
      );
    }
  }

  return {
    async loadProjects({ view = "all", folderId, search }) {
      const query = search?.trim().toLowerCase();

      let matched = rows.filter((row) =>
        view === "archived" ? row.isArchived : !row.isArchived,
      );

      if (view === "favorites")
        matched = matched.filter((row) => row.isFavorite);
      if (view === "recent")
        matched = matched.filter((row) => row.lastOpenedAt);
      if (folderId !== undefined) {
        matched = matched.filter((row) => row.folderId === folderId);
      }
      if (query) {
        matched = matched.filter(
          (row) =>
            row.name.toLowerCase().includes(query) ||
            (row.description ?? "").toLowerCase().includes(query) ||
            row.tags.includes(query),
        );
      }

      const sorted = [...matched].sort((a, b) => {
        if (view === "recent") {
          return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
        }
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });

      recountFolders();

      return delay({
        projects: sorted.map(summary),
        folders: [...folders],
        view: view as ProjectView,
      });
    },

    async loadProject(id, options = {}) {
      const row = find(id);
      if (options.markOpened) row.lastOpenedAt = Date.now();

      const detail: ProjectDetail = {
        ...summary(row),
        notes: row.notes,
        assets: row.assets,
        totalBytes: row.assets.reduce(
          (total, entry) => total + entry.sizeBytes,
          0,
        ),
      };

      return delay({ project: detail });
    },

    async createProject(input) {
      requireFreeName(input.name);

      const row: Row = {
        id: `p_${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        description: input.description ?? null,
        notes: null,
        tags: [],
        hue: 268,
        folderId: input.folderId ?? null,
        isFavorite: false,
        isArchived: false,
        assetCount: 0,
        coverKey: "",
        coverAssetId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastOpenedAt: null,
        assets: [],
      };

      rows.unshift(row);
      recountFolders();
      return delay({ project: summary(row) });
    },

    async patchProject(id, patch: ProjectPatch) {
      const row = find(id);

      if (patch.name !== undefined) {
        requireFreeName(patch.name, id);
        row.name = patch.name;
      }
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (patch.tags !== undefined) {
        row.tags = Array.from(
          new Set(
            patch.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
          ),
        );
      }
      if (patch.hue !== undefined) row.hue = patch.hue;
      if (patch.coverAssetId !== undefined) {
        row.coverAssetId = patch.coverAssetId;
        row.coverKey =
          row.assets.find((entry) => entry.id === patch.coverAssetId)
            ?.storageKey ?? "";
      }
      if (patch.folderId !== undefined) row.folderId = patch.folderId;
      if (patch.isFavorite !== undefined) row.isFavorite = patch.isFavorite;
      if (patch.archived !== undefined) row.isArchived = patch.archived;

      row.updatedAt = Date.now();
      recountFolders();
      return delay({ project: summary(row) });
    },

    async duplicateProject(id) {
      const source = find(id);

      // Same generator as the server: "(copy)", then "(copy 2)", …
      let name = `${source.name} (copy)`;
      let counter = 2;
      while (rows.some((row) => row.name === name)) {
        name = `${source.name} (copy ${counter})`;
        counter += 1;
      }

      const copy: Row = {
        ...source,
        id: `p_${Math.random().toString(36).slice(2, 8)}`,
        name,
        isFavorite: false,
        isArchived: false,
        lastOpenedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assets: [...source.assets],
      };

      rows.unshift(copy);
      recountFolders();
      return delay({ project: summary(copy) });
    },

    async deleteProject(id) {
      const row = find(id);
      rows.splice(rows.indexOf(row), 1);
      recountFolders();
      return delay({ deleted: { id: row.id, name: row.name } });
    },

    async removeFromProject(id, assetIds) {
      const row = find(id);
      const before = row.assets.length;
      row.assets = row.assets.filter((entry) => !assetIds.includes(entry.id));
      if (row.coverAssetId && assetIds.includes(row.coverAssetId)) {
        row.coverAssetId = null;
        row.coverKey = "";
      }
      row.updatedAt = Date.now();
      return delay({ removed: before - row.assets.length });
    },

    async createFolder(name, hue) {
      if (
        folders.some(
          (folder) => folder.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new ApiError(
          `You already have a folder called “${name}”.`,
          409,
          "duplicate_name",
        );
      }

      const folder: FolderSummary = {
        id: `f_${Math.random().toString(36).slice(2, 8)}`,
        name,
        hue: hue ?? 268,
        projectCount: 0,
        totalCount: 0,
      };
      folders.push(folder);
      folders.sort((a, b) => a.name.localeCompare(b.name));
      return delay({ folder });
    },

    async patchFolder(id, patch) {
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) {
        throw new ApiError("That folder was not found.", 404, "not_found");
      }
      if (patch.name !== undefined) folder.name = patch.name;
      if (patch.hue !== undefined) folder.hue = patch.hue;
      folders.sort((a, b) => a.name.localeCompare(b.name));
      return delay({ folder });
    },

    async deleteFolder(id) {
      const index = folders.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new ApiError("That folder was not found.", 404, "not_found");
      }

      const unfiled = rows.filter((row) => row.folderId === id).length;
      // The schema's `onDelete: SetNull`, reproduced: the projects survive.
      rows.forEach((row) => {
        if (row.folderId === id) row.folderId = null;
      });
      folders.splice(index, 1);

      return delay({ unfiled });
    },
  };
}
