import { Container } from "@/components/layout/container";
import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";

/**
 * Explore, loading.
 *
 * The one page a stranger is most likely to land on cold, from a shared link.
 * It gets a skeleton rather than a blank frame because a first impression of an
 * empty screen is the impression that sticks.
 */
export default function ExploreLoading() {
  return (
    <Container size="lg">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 flex gap-1.5">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_16rem]">
        <SkeletonGrid count={6} />
        <div className="hidden space-y-2 lg:block">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    </Container>
  );
}
