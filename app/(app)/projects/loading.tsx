import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";

/**
 * Projects, loading.
 *
 * ## A skeleton shaped like the destination, not a spinner
 *
 * The rail and the grid are where they will be when the data arrives, so the
 * page does not jump when it does. A centred spinner communicates "waiting";
 * this communicates "waiting, and here is what for" — and it costs nothing,
 * because the layout is already known.
 *
 * These files exist for the *navigation* case. Each of these pages also has its
 * own in-component skeleton for the refetch case, which `loading.tsx` never
 * sees: it only renders while the server component streams.
 */
export default function ProjectsLoading() {
  return (
    <div className="flex min-h-0 flex-1 gap-6 p-4 sm:p-6">
      <div className="hidden w-56 shrink-0 space-y-2 lg:block">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-lg" />
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-56 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <SkeletonGrid count={6} />
      </div>
    </div>
  );
}
