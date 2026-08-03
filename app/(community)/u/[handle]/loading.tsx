import { Container } from "@/components/layout/container";
import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";

/** A profile, loading. Avatar and identity block, then the grid. */
export default function ProfileLoading() {
  return (
    <Container size="lg">
      <div className="flex gap-4">
        <Skeleton className="size-20 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="mt-8">
        <SkeletonGrid count={6} />
      </div>
    </Container>
  );
}
