import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * Breadcrumbs.
 *
 * A thin wrapper so call sites pass data rather than assembling six components
 * by hand and getting the last-item semantics wrong. The final crumb is the
 * current page: it is not a link, and it carries `aria-current="page"`, which
 * the underlying `BreadcrumbPage` handles.
 *
 * On mobile every crumb but the last is hidden. The trail is genuinely useful
 * on a wide screen and pure noise on a 375px one, where it would wrap to two
 * lines and push the actual page title below the fold.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          // The separator is a *sibling* of the item, not a child of it. Both
          // render as <li>, and an <li> inside an <li> is invalid HTML — React
          // rejects it as a hydration mismatch.
          return (
            <Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem
                className={isLast ? undefined : "hidden sm:inline-flex"}
              >
                {isLast || !item.href ? (
                  <BreadcrumbPage className="truncate">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>

              {isLast ? null : (
                <BreadcrumbSeparator className="hidden sm:block" />
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
