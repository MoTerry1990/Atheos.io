"use client";

import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Top bar.
 *
 * Sticky, translucent, and blurred — content scrolling underneath stays
 * suggested rather than hidden, which is what keeps a dense tool feeling like
 * one surface instead of stacked panels.
 *
 * The hamburger appears only below `lg`, where the sidebar has become a drawer.
 */
export interface TopBarProps {
  /** Usually breadcrumbs or the page title. */
  children?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  /** Shows the mobile menu button and wires it up. */
  onMenuClick?: () => void;
  className?: string;
}

export function TopBar({
  children,
  actions,
  onMenuClick,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-border bg-background/80",
        "flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-md sm:px-6",
        className,
      )}
    >
      {onMenuClick ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="lg:hidden"
        >
          <Menu />
        </Button>
      ) : null}

      <div className="min-w-0 flex-1">{children}</div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * Theme switcher.
 *
 * Three options rather than a binary toggle, because "follow the system" is a
 * real preference and a two-state switch silently discards it the first time
 * it is used.
 *
 * The mounted guard is not optional: on the server we cannot know the resolved
 * theme, so rendering the icon before hydration produces a guaranteed mismatch.
 * A same-sized placeholder keeps the top bar from shifting.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="size-8" aria-hidden />;
  }

  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  const active = options.find((option) => option.value === theme) ?? options[2];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          <ActiveIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={cn(option.value === theme && "text-primary")}
          >
            <option.icon className="size-4" aria-hidden />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
