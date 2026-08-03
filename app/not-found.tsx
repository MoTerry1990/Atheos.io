import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { EmptyState } from "@/components/ui/state";
import { FileQuestion } from "lucide-react";

/**
 * 404.
 *
 * ## It says nothing about why
 *
 * "This page does not exist" — not "you do not have access", not "this post was
 * removed". `/admin` reaches this page for every non-admin, and every admin API
 * returns the same 404, precisely so absence and refusal are indistinguishable
 * (§ 38). A helpful 404 that explained itself would undo that.
 *
 * ## The links go somewhere useful for both kinds of visitor
 *
 * Somebody who mistyped a URL and somebody who followed a dead link to a
 * deleted post are the two people who land here, and Explore serves both better
 * than a bare "go home".
 */
export default function NotFound() {
  return (
    <Container size="md" className="py-16">
      <EmptyState
        icon={FileQuestion}
        title="This page does not exist"
        description="The link may be wrong, or whatever was here is no longer public."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/explore">Browse Explore</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        }
      />
    </Container>
  );
}
