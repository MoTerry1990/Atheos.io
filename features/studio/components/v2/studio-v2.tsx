"use client";

import { useState } from "react";
import {
  ChevronUp,
  Expand,
  ImageIcon,
  Info,
  Maximize2,
  Music,
  Paperclip,
  Settings2,
  Sparkles,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PublicStudioModel } from "@/features/studio/lib/public-model";

/**
 * Studio V2 — the creative workspace.
 *
 * ## What this replaces, and why
 *
 * The existing Studio is four permanent columns: a modality rail, a settings
 * column, the preview, and a queue-and-history rail. Every one of them holds
 * width whether or not it has anything to say, so the canvas — the only part a
 * customer is actually looking at — gets whatever is left.
 *
 * V2 inverts that. The canvas takes the space by default; navigation collapses
 * to icons; the queue is a status chip that opens on demand; history is a
 * filmstrip that slides up; the inspector is closed until asked for. Nothing
 * permanent except the thing the work happens in.
 *
 * ## Why the composer sits under the canvas
 *
 * A prompt is a caption for what you are looking at, not a form beside it.
 * Docking it under the canvas keeps the eye on the output and puts the text
 * where the next action starts — and it is the layout that survives a phone,
 * where a side-by-side never does.
 *
 * ## Release 1 scope
 *
 * This is the shell: layout, spacing, hierarchy, the states a customer moves
 * between. It renders real models from the public contract and real history.
 * It does not submit — generation stays on the existing Studio until the shell
 * is approved, so nothing here can spend a credit.
 */

type Modality = "image" | "video" | "audio";

const MODALITIES: { id: Modality; label: string; icon: typeof ImageIcon }[] = [
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video },
  { id: "audio", label: "Audio", icon: Music },
];

export interface StudioV2Props {
  models: PublicStudioModel[];
  creditBalance: number;
  /** Recent work, newest first. Thumbnails and status only. */
  history: {
    id: string;
    modelName: string;
    prompt: string;
    status: string;
    createdAt: number;
    thumbnailUrl?: string;
  }[];
  projectName?: string;
}

export function StudioV2({
  models,
  creditBalance,
  history,
  projectName = "Untitled project",
}: StudioV2Props) {
  const [modality, setModality] = useState<Modality>("image");
  const [prompt, setPrompt] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const available = models.filter(
    (model) => model.modality.toLowerCase() === modality,
  );
  const model = available[0];
  const selected = history.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-surface-sunken text-foreground">
      <GlobalNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          projectName={projectName}
          creditBalance={creditBalance}
          queueOpen={queueOpen}
          onQueueToggle={() => setQueueOpen((open) => !open)}
          onInspectorToggle={() => setInspectorOpen((open) => !open)}
          inspectorOpen={inspectorOpen}
        />

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <Canvas selected={selected} />

            <HistoryStrip
              open={historyOpen}
              onToggle={() => setHistoryOpen((open) => !open)}
              history={history}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setInspectorOpen(true);
              }}
            />

            <Composer
              modality={modality}
              onModality={setModality}
              prompt={prompt}
              onPrompt={setPrompt}
              model={model}
            />
          </div>

          {inspectorOpen ? (
            <Inspector
              selected={selected}
              model={model}
              onClose={() => setInspectorOpen(false)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Collapsed to icons, and it stays that way.
 *
 * 68px is enough for a 20px icon with real padding either side. The old rail
 * spent 200px on labels a daily user stopped reading after the first week;
 * tooltips carry them for the week that matters.
 */
function GlobalNav() {
  const items = [
    { label: "Dashboard", icon: Sparkles },
    { label: "Studio", icon: ImageIcon, active: true },
    { label: "Projects", icon: Paperclip },
    { label: "Library", icon: Music },
  ];

  return (
    <nav
      aria-label="Main"
      className="hidden w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-surface py-3 md:flex"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex size-11 items-center justify-center rounded-xl transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              item.active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </button>
        );
      })}

      <div className="mt-auto">
        <button
          type="button"
          title="Account"
          aria-label="Account"
          className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-brand text-2xs font-medium text-white">
            A
          </span>
        </button>
      </div>
    </nav>
  );
}

function TopBar({
  projectName,
  creditBalance,
  queueOpen,
  onQueueToggle,
  onInspectorToggle,
  inspectorOpen,
}: {
  projectName: string;
  creditBalance: number;
  queueOpen: boolean;
  onQueueToggle: () => void;
  onInspectorToggle: () => void;
  inspectorOpen: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-surface px-4">
      <p className="truncate text-sm font-medium">{projectName}</p>

      <div className="ml-auto flex items-center gap-2">
        {/* The queue is a chip, not a column. It has nothing to say most of
            the time, and a permanent rail for "nothing running" is width
            spent on silence. */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={onQueueToggle}
            aria-expanded={queueOpen}
            aria-label="Queue"
          >
            <span className="mr-1.5 size-2 rounded-full bg-muted-foreground/50" />
            Idle
          </Button>

          {queueOpen ? (
            <div
              role="dialog"
              aria-label="Queue"
              className="absolute top-full right-0 z-20 mt-2 w-72 rounded-2xl border border-border/60 bg-surface-raised p-4 shadow-lg"
            >
              <p className="text-sm font-medium">Nothing running</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generations you start will appear here until they finish.
              </p>
            </div>
          ) : null}
        </div>

        <span className="rounded-full bg-surface-raised px-3 py-1.5 text-xs text-muted-foreground">
          {creditBalance.toLocaleString("en-US")} credits
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={onInspectorToggle}
          aria-expanded={inspectorOpen}
        >
          <Settings2 className="size-4" aria-hidden />
          Details
        </Button>
      </div>
    </header>
  );
}

/**
 * The canvas takes whatever is left, which is most of the page.
 *
 * A neutral deep grey rather than pure black: black makes a dark render look
 * like a hole in the page, and gives the eye no edge to judge exposure
 * against.
 */
function Canvas({
  selected,
}: {
  selected: StudioV2Props["history"][0] | null;
}) {
  return (
    <section
      aria-label="Canvas"
      className="relative flex min-h-0 flex-1 items-center justify-center bg-canvas p-6"
    >
      {selected ? (
        <div className="flex max-h-full max-w-full flex-col items-center gap-3">
          <div className="flex size-full max-h-[60vh] min-h-[240px] w-[min(70vw,900px)] items-center justify-center rounded-2xl bg-surface-raised">
            <p className="text-xs text-muted-foreground">
              {selected.modelName}
            </p>
          </div>
        </div>
      ) : (
        /* One short line. The old empty state was a large bordered rectangle
           with a paragraph in it, which reads as a broken component. */
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Describe what you want to make.
        </p>
      )}

      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-xl bg-surface/80 p-1 backdrop-blur">
        {[
          { icon: ZoomOut, label: "Zoom out" },
          { icon: ZoomIn, label: "Zoom in" },
          { icon: Expand, label: "Fit" },
          { icon: Maximize2, label: "Fullscreen" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Icon className="size-4" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * History as a filmstrip, and thumbnails rather than prose.
 *
 * The old rail rendered whole prompts, so three entries filled it and the
 * fourth was below the fold. A thumbnail says which one it is faster than a
 * paragraph does, and the prompt is one line, truncated.
 */
function HistoryStrip({
  open,
  onToggle,
  history,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onToggle: () => void;
  history: StudioV2Props["history"];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronUp
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
        Recent
        <span className="text-muted-foreground/60">({history.length})</span>
      </button>

      {open ? (
        <ul className="flex gap-3 overflow-x-auto px-4 pb-3">
          {history.map((entry) => (
            <li key={entry.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(entry.id)}
                aria-pressed={selectedId === entry.id}
                className={cn(
                  "w-36 rounded-xl border p-2 text-left transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selectedId === entry.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-input",
                )}
              >
                <div className="mb-2 aspect-video w-full rounded-lg bg-surface-raised" />
                {/* One line, truncated. A history rail is for recognising
                    work, not for reading it. */}
                <p className="truncate text-xs text-foreground">
                  {entry.prompt || "Untitled"}
                </p>
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {entry.modelName} · {entry.status}
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Composer({
  modality,
  onModality,
  prompt,
  onPrompt,
  model,
}: {
  modality: Modality;
  onModality: (next: Modality) => void;
  prompt: string;
  onPrompt: (next: string) => void;
  model?: PublicStudioModel;
}) {
  return (
    <section
      aria-label="Composer"
      className="shrink-0 border-t border-border/60 bg-surface p-4"
    >
      <div className="mx-auto w-full max-w-4xl">
        {/* The Textarea primitive carries the project's spacing standard —
            pt-4 pr-[18px] pb-4 pl-[18px] — so prompt text never touches its
            border, which is the defect this composer replaces. */}
        <Textarea
          value={prompt}
          onChange={(event) => onPrompt(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Describe what you want to make…"
          aria-label="Prompt"
          className="resize-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="What to make"
            className="flex rounded-xl bg-surface-sunken p-1"
          >
            {MODALITIES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onModality(id)}
                aria-pressed={modality === id}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  modality === id
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {model ? (
            <>
              <Chip>{model.displayName}</Chip>
              <Chip>{model.creditCost} credits</Chip>
              {model.durations.length > 0 ? (
                <Chip>{model.durations.join("s / ")}s</Chip>
              ) : null}
              {/* Audio status, at last. The old picker had no audio field at
                  all, so it could not say this however honest the marketing
                  page had become. */}
              {model.modality === "VIDEO" ? (
                <Chip
                  tone={model.audio === "native" ? "brand" : "muted"}
                  title={model.audioNote}
                >
                  {model.audio === "native"
                    ? "Native audio"
                    : "Silent output — no native audio"}
                </Chip>
              ) : null}
              {model.takesReference ? <Chip>Takes a reference</Chip> : null}
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm">
              <Paperclip className="size-4" aria-hidden />
              Reference
            </Button>
            <Button variant="ghost" size="sm">
              Advanced
            </Button>
            <Button size="sm" disabled={!prompt.trim()}>
              Generate
            </Button>
          </div>
        </div>

        {model ? (
          <p className="mt-2 text-2xs text-muted-foreground">
            {formatWait(model.typicalWait)} · {prompt.length}/4000
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A wait range in units a person would use.
 *
 * Naive minute rounding produced "Usually 1-1 minutes" for a twelve-second
 * image — both ends rounded to the same number and the range said nothing. Sub-
 * minute waits stay in seconds, and a range that collapses is printed as a
 * single figure rather than as a fake interval.
 */
function formatWait(wait: { minSeconds: number; maxSeconds: number }): string {
  if (wait.maxSeconds < 90) {
    return `Usually ${wait.minSeconds}–${wait.maxSeconds} seconds`;
  }

  const min = Math.max(1, Math.round(wait.minSeconds / 60));
  const max = Math.max(1, Math.round(wait.maxSeconds / 60));

  return min === max
    ? `Usually about ${min} minute${min === 1 ? "" : "s"}`
    : `Usually ${min}–${max} minutes`;
}

function Chip({
  children,
  tone = "muted",
  title,
}: {
  children: React.ReactNode;
  tone?: "muted" | "brand";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "rounded-lg px-2.5 py-1.5 text-xs",
        tone === "brand"
          ? "bg-primary/10 text-primary"
          : "bg-surface-sunken text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Closed by default, and it does not take width when it is.
 *
 * The old settings column was permanent, so the canvas paid for it on every
 * screen whether or not anyone was adjusting anything.
 */
function Inspector({
  selected,
  model,
  onClose,
}: {
  selected: StudioV2Props["history"][0] | null;
  model?: PublicStudioModel;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Generation details"
      className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-border/60 bg-surface p-4 lg:block"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Details</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close details"
        >
          Close
        </Button>
      </div>

      {selected ? (
        <dl className="mt-4 space-y-3 text-xs">
          <Row label="Model" value={selected.modelName} />
          <Row label="Status" value={selected.status} />
          <Row
            label="Created"
            value={new Date(selected.createdAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <div>
            <dt className="text-muted-foreground">Prompt</dt>
            <dd className="mt-1 leading-relaxed break-words">
              {selected.prompt || "—"}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-4 space-y-3 text-xs">
          {model ? (
            <>
              <Row label="Model" value={model.displayName} />
              <Row label="Quality" value={model.qualityTier} />
              <Row label="Cost" value={`${model.creditCost} credits`} />
              {model.modality === "VIDEO" ? (
                <Row label="Audio" value={model.audioNote} />
              ) : null}
            </>
          ) : null}
          <p className="flex items-start gap-2 pt-2 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Select something from Recent to see its details.
          </p>
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right break-words">{value}</dd>
    </div>
  );
}
