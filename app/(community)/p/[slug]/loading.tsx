import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A post, loading.
 *
 * `aspect-video` is a guess — the real asset may be portrait. Chosen anyway
 * because a fixed-height block that resizes once is less disruptive than a
 * collapsed frame that expands from nothing, and the true ratio cannot be known
 * before the fetch.
 */
export default function PostLoading() {
  return (
    <Container size="lg">
      <Skeleton className="h-8 w-24" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    </Container>
  );
}
