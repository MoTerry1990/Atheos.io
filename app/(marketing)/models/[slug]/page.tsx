import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import { Section } from "@/features/marketing/components/section";
import {
  publicModelBySlug,
  publicModels,
  type PublicModel,
} from "@/features/marketing/lib/public-models";

/**
 * One model, described honestly.
 *
 * ## Every number comes from the catalogue
 *
 * Nothing on this page is written down a second time. `publicModelBySlug` reads
 * the registry, the cost table and the audited audio capabilities — so a model
 * that gets disabled stops having a page, and a price that moves moves here
 * too. A hand-written model page is a page that will eventually lie.
 *
 * ## Unavailable models 404 rather than render
 *
 * `generateStaticParams` only lists what is currently public, and the component
 * calls `notFound()` for anything else. A model behind a feature flag has no
 * page at all — not a page with a disabled button, which would still advertise
 * it.
 *
 * ## "Use this model" opens Studio with it selected
 *
 * `?model=` is read by the studio's URL seeding. The link is the only place
 * this page touches the application, and it carries an id the catalogue
 * produced rather than one typed here.
 */

export function generateStaticParams() {
  return publicModels().map((model) => ({ slug: model.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const model = publicModelBySlug(slug);
  if (!model) return {};

  return {
    title: model.name,
    description: model.bestFor,
  };
}

function audioSentence(model: PublicModel): string {
  switch (model.audio) {
    case "native":
      return "Sound is generated together with the picture, in the same pass.";
    case "atheos":
      // The claim the audio audit exists to keep honest.
      return "This model produces no sound. Atheos can generate and mix sound afterwards, priced separately, and it is labelled as Atheos sound design rather than as the model's own.";
    case "silent":
      return "This model produces no sound.";
    default:
      return "Sound does not apply to this model.";
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-3 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const model = publicModelBySlug(slug);
  if (!model) notFound();

  const modality =
    model.modality === "IMAGE"
      ? "image"
      : model.modality === "VIDEO"
        ? "video"
        : "audio";

  return (
    <MarketingShell locale="en">
      {/* 1. What it makes, stated first. */}
      <div data-band="dark">
        <Section size="wide">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="default">
                {modality}
              </Badge>
              {model.supportsReferenceImage ? (
                <Badge size="sm" variant="outline">
                  Takes a reference image
                </Badge>
              ) : null}
            </div>

            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {model.name}
            </h1>
            <p className="mt-5 text-lg text-balance text-muted-foreground">
              {model.bestFor}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" variant="gradient">
                {/* Opens Studio with this exact catalogue id preselected. */}
                <Link href={`/studio?model=${encodeURIComponent(model.id)}`}>
                  Use this model
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/models">All models</Link>
              </Button>
            </div>
          </div>
        </Section>
      </div>

      {/* 2. The facts, from the catalogue. */}
      <div data-band="light">
        <Section>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight">
                What it can do
              </h2>
              <p className="mt-4 text-muted-foreground">
                {model.supportsReferenceImage
                  ? "You can give it a picture to work from as well as a description."
                  : "It works from a written description. It cannot take a picture as a starting point."}
              </p>
              <p className="mt-3 text-muted-foreground">
                {audioSentence(model)}
              </p>

              <h2 className="mt-12 text-2xl font-semibold tracking-tight">
                What it will not do
              </h2>
              {/* Deliberately not softened, and deliberately not last on the
                  page under a fold. A limitation a visitor finds after paying
                  is a refund and a lost customer. */}
              <p className="mt-4 text-muted-foreground">{model.limitation}</p>
            </div>

            <aside className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-sm font-medium">Cost and time</h2>
              <dl className="mt-3">
                <Fact label="From" value={`${model.credits} credits`} />
                {model.maxDurationSeconds ? (
                  <Fact
                    label="Longest clip"
                    value={`${model.maxDurationSeconds} seconds`}
                  />
                ) : null}
                {model.estimatedSeconds ? (
                  <Fact
                    label="Typical wait"
                    value={`about ${Math.round(model.estimatedSeconds / 60)} minutes`}
                  />
                ) : null}
                {model.aspectRatios.length > 0 ? (
                  <Fact label="Shapes" value={model.aspectRatios.join(", ")} />
                ) : null}
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                The exact cost is shown before anything is generated. Nothing is
                spent until you confirm it.
              </p>
            </aside>
          </div>
        </Section>
      </div>
    </MarketingShell>
  );
}
