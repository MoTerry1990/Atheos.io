import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Billing, loading.
 *
 * The plan card first, then three plan columns. Somebody arriving here after a
 * Stripe redirect is specifically looking for whether their payment landed, so
 * the current-plan block is the shape that matters most.
 */
export default function BillingLoading() {
  return (
    <Container size="lg" className="py-8 sm:py-12">
      <Skeleton className="h-9 w-40" />
      <div className="mt-8 space-y-8">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    </Container>
  );
}
