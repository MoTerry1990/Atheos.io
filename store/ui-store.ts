import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Ephemeral UI state.
 *
 * ## What belongs in a store, and what does not
 *
 * Almost nothing. In an App Router application, server state — assets,
 * generations, the credit balance — is fetched in Server Components and lives
 * in the React tree. Copying it into a client store creates a second source of
 * truth that goes stale the moment anything changes on the server.
 *
 * Zustand is here for the narrow band that genuinely is client state: what is
 * open, what is selected, what the user prefers about the chrome. If a value
 * could be read from the database, it does not belong here.
 *
 * `persist` writes to localStorage, so panel layout survives a reload. It is
 * scoped to a named key rather than the whole store, so adding transient state
 * later does not accidentally start persisting it.
 */
interface UIState {
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      commandPaletteOpen: false,

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setCommandPaletteOpen: (commandPaletteOpen) =>
        set({ commandPaletteOpen }),
    }),
    {
      name: "atheos:ui",
      // Only persist the layout preference. Whether a modal was open when the
      // user last closed the tab is not something they want restored.
      partialize: (state) => ({ sidebarOpen: state.sidebarOpen }),
    },
  ),
);
