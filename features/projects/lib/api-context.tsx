"use client";

import { createContext, useContext, type ReactNode } from "react";

import * as api from "@/features/projects/lib/api";

/**
 * The projects client, injectable.
 *
 * ## Why a context rather than direct imports
 *
 * Every sprint in this project has run into the same wall: there is no database
 * and no Clerk instance here, so a page that fetches cannot be looked at. The
 * workaround has been fixtures — but Sprint 7's studio preview could only seed a
 * Zustand store, and a component that calls `fetch` directly has no such seam.
 *
 * One context with the real module as its default value gives it one. Production
 * behaviour is unchanged and nothing has to be passed anywhere; the preview
 * route wraps the same components in an in-memory implementation and every
 * interaction — rename, duplicate, archive, move, search, autosave — becomes
 * something that can actually be clicked.
 *
 * That is worth more than the indirection costs. It is also the shape a test
 * suite will want when there is one.
 */

export interface ProjectsApi {
  loadProjects: typeof api.loadProjects;
  loadProject: typeof api.loadProject;
  createProject: typeof api.createProject;
  patchProject: typeof api.patchProject;
  duplicateProject: typeof api.duplicateProject;
  deleteProject: typeof api.deleteProject;
  removeFromProject: typeof api.removeFromProject;
  createFolder: typeof api.createFolder;
  patchFolder: typeof api.patchFolder;
  deleteFolder: typeof api.deleteFolder;
}

const REAL: ProjectsApi = {
  loadProjects: api.loadProjects,
  loadProject: api.loadProject,
  createProject: api.createProject,
  patchProject: api.patchProject,
  duplicateProject: api.duplicateProject,
  deleteProject: api.deleteProject,
  removeFromProject: api.removeFromProject,
  createFolder: api.createFolder,
  patchFolder: api.patchFolder,
  deleteFolder: api.deleteFolder,
};

const ProjectsApiContext = createContext<ProjectsApi>(REAL);

/** The real client unless a provider says otherwise. */
export function useProjectsApi(): ProjectsApi {
  return useContext(ProjectsApiContext);
}

export function ProjectsApiProvider({
  value,
  children,
}: {
  value: ProjectsApi;
  children: ReactNode;
}) {
  return (
    <ProjectsApiContext.Provider value={value}>
      {children}
    </ProjectsApiContext.Provider>
  );
}
