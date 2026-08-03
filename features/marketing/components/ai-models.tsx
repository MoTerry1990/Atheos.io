import { Check, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { PROVIDER_CATALOGUE } from "@/services/ai/catalogue";
import { cn } from "@/lib/utils";

/**
 * The AI models section.
 *
 * ## This reads the real catalogue, and that is the whole idea
 *
 * `PROVIDER_CATALOGUE` is the same file the Provider Manager routes on. Every
 * vendor here is one the engine actually knows about, and the `status` badge is
 * the same field that decides whether a request can reach it.
 *
 * The alternative — the wall of vendor logos every AI landing page has — is a
 * claim nobody can check and one this product cannot honestly make. Nine of
 * these eleven have no adapter. A logo wall would imply eleven working
 * integrations; this says two, out loud, on the marketing page.
 *
 * That is not a limitation dressed as a virtue. It is the more useful page: the
 * question a buyer is actually asking is "which of these can I use today", and
 * a logo grid never answers it. It also cannot go stale — flipping a provider
 * to `implemented` in the catalogue updates this section with no edit here.
 *
 * ## A Server Component
 *
 * `catalogue.ts` is `server-only`, which is correct: it is engine
 * configuration, not marketing copy. Reading it during the static render keeps
 * it out of the client bundle entirely — this section ships zero JavaScript.
 */

const FAMILY_LABEL: Record<string, string> = {
  image: "Image",
  video: "Video",
  multimodal: "Multimodal",
};

export function AIModels() {
  const live = PROVIDER_CATALOGUE.filter((p) => p.status === "implemented");
  const planned = PROVIDER_CATALOGUE.filter((p) => p.status === "declared");

  return (
    <Section id="models">
      <SectionHeading
        eyebrow="Providers"
        title="One interface. Every model worth using."
        description="Switch vendor without switching tools. The engine normalises submission, polling, errors, retries and cost across all of them — so a model change is a dropdown, not a migration."
      />

      <div className="mt-10 space-y-8">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-medium">Available now</h3>
            <Badge variant="outline" size="sm">
              {live.length}
            </Badge>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {live.map((provider) => (
              <li key={provider.id}>
                <ProviderCard
                  name={provider.displayName}
                  families={provider.families}
                  live
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-medium">On the roadmap</h3>
            <Badge variant="outline" size="sm">
              {planned.length}
            </Badge>
          </div>

          {/* Deliberately quieter than the live grid: three columns, no
              descriptions, lower contrast. A roadmap presented as loudly as
              shipped work is a roadmap being used as a claim. */}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {planned.map((provider) => (
              <li key={provider.id}>
                <ProviderCard
                  name={provider.displayName}
                  families={provider.families}
                  live={false}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* The line most landing pages will not print. It is here because a
            buyer who discovers it after signing up is a buyer who stops
            trusting everything else on this page. */}
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Providers marked{" "}
          <span className="text-foreground">on the roadmap</span> are not
          connected yet — the engine knows their shape and refuses to route to
          them until an adapter exists, so nothing here can be selected and
          silently fail. This list is generated from the engine&rsquo;s own
          configuration rather than maintained by hand, so it cannot drift from
          what the product actually does.
        </p>
      </div>
    </Section>
  );
}

function ProviderCard({
  name,
  families,
  live,
}: {
  name: string;
  families: readonly string[];
  live: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center gap-3 rounded-lg border p-3 transition-colors",
        live
          ? "border-border bg-card hover:border-border/70"
          : "border-dashed border-border/60 bg-transparent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md",
          live
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {live ? <Check className="size-3.5" /> : <Clock className="size-3.5" />}
      </span>

      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm font-medium",
            !live && "text-muted-foreground",
          )}
        >
          {name}
        </p>
        {live ? (
          <p className="truncate text-2xs text-muted-foreground">
            {families.map((f) => FAMILY_LABEL[f] ?? f).join(" · ")}
          </p>
        ) : null}
      </div>

      {/* Screen readers get the status as words. The icon alone is a colour
          distinction, which is not a distinction for everyone. */}
      <span className="sr-only">
        {live ? "Available now" : "On the roadmap, not yet connected"}
      </span>
    </div>
  );
}
