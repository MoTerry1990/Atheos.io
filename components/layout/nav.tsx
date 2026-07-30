"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Navigation items.
 *
 * The active-state logic is the part worth reading. `/library` must be active
 * when the user is at `/library/collections`, but `/` must not be active
 * everywhere — so the root is matched exactly and everything else by prefix,
 * with a `/` boundary check so `/lib` does not light up `/library`.
 *
 * Active state is communicated three ways: colour, a left rail, and
 * `aria-current`. Colour alone fails for a colour-blind user; `aria-current` is
 * what a screen reader announces.
 */

export interface NavItemData {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Count or status shown at the trailing edge. */
  badge?: string | number;
  /** Match this route exactly rather than by prefix. */
  exact?: boolean;
  disabled?: boolean;
}

export function isRouteActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavItem({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItemData;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isRouteActive(pathname, item.href, item.exact);
  const Icon = item.icon;

  const content = (
    <>
      {/* Left rail marks the active item without relying on colour alone. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />

      {Icon ? (
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            active ? "text-primary" : "text-muted-foreground",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      ) : null}

      {/* When collapsed the label stays in the DOM for screen readers — the
          rail is narrow, not less navigable. */}
      <span className={cn("flex-1 truncate", collapsed && "sr-only")}>
        {item.label}
      </span>

      {item.badge !== undefined && !collapsed ? (
        <Badge variant={active ? "brand" : "default"} size="sm">
          {item.badge}
        </Badge>
      ) : null}
    </>
  );

  const className = cn(
    "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
    "transition-colors duration-150 outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/60",
    collapsed && "justify-center px-2",
    item.disabled && "pointer-events-none opacity-40",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  );

  if (item.disabled) {
    return (
      <span className={className} aria-disabled title={item.label}>
        {content}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={className}
    >
      {content}
    </Link>
  );
}

export interface NavSectionData {
  /** Omit for an unlabelled group. */
  title?: string;
  items: NavItemData[];
}

export function NavSection({
  section,
  collapsed = false,
  onNavigate,
}: {
  section: NavSectionData;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1">
      {section.title && !collapsed ? (
        <p className="px-3 pt-4 pb-1 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          {section.title}
        </p>
      ) : null}

      {/* A collapsed rail loses the group heading visually, so a rule keeps the
          grouping legible. */}
      {section.title && collapsed ? (
        <div className="mx-2 my-3 h-px bg-border" aria-hidden />
      ) : null}

      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.href}>
            <NavItem
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Nav({
  sections,
  collapsed = false,
  onNavigate,
  className,
}: {
  sections: NavSectionData[];
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav aria-label="Main" className={cn("space-y-1 px-2", className)}>
      {sections.map((section, index) => (
        <NavSection
          key={section.title ?? index}
          section={section}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
