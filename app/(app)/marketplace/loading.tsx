import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";

/** Marketplace, loading. Rail plus grid, in the positions they will occupy. */
export default function MarketplaceLoading() {
  return (
    <div className="flex min-h-0 flex-1 gap-6 p-4 sm:p-6">
      <div className="hidden w-52 shrink-0 space-y-2 lg:block">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-lg" />
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-64 rounded-lg" />
        </div>
        <SkeletonGrid count={6} />
      </div>
    </div>
  );
}
