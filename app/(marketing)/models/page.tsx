import type { Metadata } from "next";
import Link from "next/link";

import {
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import {
  publicModels,
  type PublicModel,
} from "@/features/marketing/lib/public-models";
import { SITE } from "@/features/marketing/content";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Models",
  description:
    "Every model Atheos can run right now, with what it costs and what it cannot do.",
};

/**
 * The model index.
 *
 * ## Why every fact on this page is derived
 *
 * `publicModels()` reads the registry, the cost table and the audited audio
 * capabilities. Nothing here is written down twice, because a marketing page
 * with its own copy of the catalogue is a page that will eventually advertise a
 * model nobody can select or promise sound a model cannot make — which is
 * exactly what happened on the video side before the audio audit.
 *
 * A model that is flag-disabled simply does not appear. There is no "coming
 * soon" state, deliberately: a visitor cannot tell the difference between
 * "soon" and "never", and neither can we.
 */

const MODALITY_LABEL: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  AUDIO: "Audio",
};

/** How sound happens, said plainly. Never softened into "supports audio". */
function audioLine(model: PublicModel): string | null {
  switch (model.audio) {
    case "native":
      return "Sound generated with the clip";
    case "atheos":
      /**
       * The model is silent, and Atheos does **not** add sound to it.
       *
       * This said "Silent model — Atheos adds sound afterwards", which
       * advertised a pipeline that has never been built: the mux step does not
       * exist, and `routeAudio` refuses `ATHEOS_SOUND_MIX` with "not built
       * yet". A page promising sound that cannot arrive is the same defect the
       * audio work spent this whole programme removing, so it says what is
       * true today and nothing more.
       */
      return "Silent — no native audio";
    case "silent":
      return "No sound";
    default:
      return null;
  }
}

function ModelCard({ model }: { model: PublicModel }) {
  const audio = audioLine(model);

  return (
    <Link
      href={`/models/${model.slug}`}
      className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent-purple/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center gap-2">
        <Badge size="sm" variant="default">
          {MODALITY_LABEL[model.modality] ?? model.modality}
        </Badge>
        {model.supportsReferenceImage ? (
          <Badge size="sm" variant="outline">
            Takes a reference
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-4 text-lg font-semibold tracking-tight text-card-foreground">
        {model.name}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{model.bestFor}</p>

      <dl className="mt-5 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">From</dt>
          <dd className="tabular-nums">{model.credits} credits</dd>
        </div>
        {model.maxDurationSeconds ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Up to</dt>
            <dd className="tabular-nums">{model.maxDurationSeconds}s</dd>
          </div>
        ) : null}
        {/* Only when it was actually measured. */}
        {model.estimatedSeconds ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Typically</dt>
            <dd className="tabular-nums">
              about {Math.round(model.estimatedSeconds / 60)} min
            </dd>
          </div>
        ) : null}
        {audio ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Sound</dt>
            <dd className="text-right">{audio}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
        {model.limitation}
      </p>
    </Link>
  );
}

export default function ModelsPage() {
  const models = publicModels();
  const byModality = (modality: string) =>
    models.filter((model) => model.modality === modality);

  return (
    <MarketingShell locale="en">
      <div data-band="dark">
        <Section size="wide">
          <SectionHeading
            eyebrow="Models"
            as="h1"
            title="Every model Atheos can run today"
            description="What each one is for, what it costs, and what it will not do. Nothing here is available later — if it is on this page, you can select it."
            align="left"
          />
        </Section>
      </div>

      <div data-band="light">
        <Section size="wide">
          {(["IMAGE", "VIDEO", "AUDIO"] as const).map((modality) => {
            const group = byModality(modality);
            if (group.length === 0) return null;

            return (
              <div key={modality} className="mb-16 last:mb-0">
                <h2 className="mb-6 text-2xl font-semibold tracking-tight">
                  {MODALITY_LABEL[modality]}
                </h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((model) => (
                    <ModelCard key={model.id} model={model} />
                  ))}
                </div>
              </div>
            );
          })}

          <p className="mt-12 max-w-2xl text-sm text-muted-foreground">
            Credit costs are what {SITE.name} charges per generation. Longer
            clips and larger images cost more; the exact figure is shown before
            anything is generated, and nothing is spent until you confirm it.
          </p>
        </Section>
      </div>
    </MarketingShell>
  );
}
