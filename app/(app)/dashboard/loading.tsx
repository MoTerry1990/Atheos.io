import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard loading state.
 *
 * The shapes match the real layout — three stat tiles, five quick actions, a
 * project grid, a summary rail. A skeleton is a **promise about the layout that
 * is coming**; if the real content lands at a different size the page jumps and
 * the skeleton has made things worse than a spinner would have.
 *
 * Next renders this automatically while the Server Component awaits its
 * queries, which on a cold serverless connection to Supabase is long enough to
 * matter.
 */
export default function DashboardLoading() {
  return (
    <Container size="xl" className="space-y-8 py-6 sm:py-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>

      <div className="grid items-start gap-8 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <div className="space-y-4">
            <Skeleton className="h-5 w-36" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[13rem] rounded-xl" />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    </Container>
  );
}
