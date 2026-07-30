"use client";

import {
  Copy,
  Download,
  ImageIcon,
  Mail,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, InputField } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import {
  LoadingOverlay,
  LoadingState,
  ProgressBar,
  Spinner,
} from "@/components/ui/loading";
import { FadeIn, Stagger, StaggerItem } from "@/components/ui/motion";
import { Pagination, PaginationSummary } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Skeleton,
  SkeletonCard,
  SkeletonGrid,
  SkeletonText,
} from "@/components/ui/skeleton";
import { Divider, Grid, Inline, Stack } from "@/components/ui/stack";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Code, Eyebrow, Heading, Text } from "@/components/ui/typography";
import { toast } from "@/lib/toast";

/* -------------------------------------------------------------------------- */
/* Documentation scaffolding                                                   */
/* -------------------------------------------------------------------------- */

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <Stack gap="lg">
        <div className="space-y-1.5">
          <Heading as="h2" size="h3">
            {title}
          </Heading>
          {description ? (
            <Text tone="muted" size="sm" className="max-w-2xl">
              {description}
            </Text>
          ) : null}
        </div>
        {children}
      </Stack>
      <Divider className="my-12" />
    </section>
  );
}

function Demo({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Eyebrow>{label}</Eyebrow>
        {note ? (
          <Text tone="muted" size="xs" className="max-w-xl">
            {note}
          </Text>
        ) : null}
      </div>
      <div className="rounded-xl border border-border bg-surface-sunken p-6">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Foundations                                                                 */
/* -------------------------------------------------------------------------- */

export function TypographySection() {
  return (
    <Section
      id="typography"
      title="Typography"
      description="Size and semantics are separate props. `as` sets the element for the document outline; `size` sets the appearance. Coupling them forces heading levels to be misused to get a size, which quietly breaks screen-reader navigation."
    >
      <Demo label="Scale">
        <Stack gap="md">
          <Heading as="h1" size="display">
            Display
          </Heading>
          <Heading as="h2" size="h1">
            Heading 1
          </Heading>
          <Heading as="h3" size="h2">
            Heading 2
          </Heading>
          <Heading as="h4" size="h3">
            Heading 3
          </Heading>
          <Heading as="h5" size="h4">
            Heading 4
          </Heading>
          <Text size="lg">Body large — for lead paragraphs.</Text>
          <Text>Body — the default reading size at 16px.</Text>
          <Text size="sm" tone="muted">
            Small muted — metadata, captions, helper text.
          </Text>
          <Text size="xs" mono>
            Mono — ids, keys, seeds, dimensions.
          </Text>
        </Stack>
      </Demo>

      <Demo label="Emphasis" note="One gradient headline per page, at most.">
        <Stack gap="sm">
          <Heading as="h3" size="h2" gradient>
            Generate anything
          </Heading>
          <Inline gap="sm">
            <Text tone="brand" weight="medium">
              Brand
            </Text>
            <Text tone="success" weight="medium">
              Success
            </Text>
            <Text tone="warning" weight="medium">
              Warning
            </Text>
            <Text tone="danger" weight="medium">
              Danger
            </Text>
          </Inline>
          <Text size="sm" tone="muted">
            Inline code looks like <Code>generation.providerJobId</Code>.
          </Text>
        </Stack>
      </Demo>
    </Section>
  );
}

const brandScale = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const roles = [
  { name: "background", className: "bg-background border" },
  { name: "surface", className: "bg-surface border" },
  { name: "surface-raised", className: "bg-surface-raised border" },
  { name: "card", className: "bg-card border" },
  { name: "primary", className: "bg-primary" },
  { name: "secondary", className: "bg-secondary" },
  { name: "muted", className: "bg-muted" },
  { name: "accent", className: "bg-accent" },
  { name: "destructive", className: "bg-destructive" },
  { name: "success", className: "bg-success" },
  { name: "warning", className: "bg-warning" },
  { name: "info", className: "bg-info" },
];

export function ColorSection() {
  return (
    <Section
      id="color"
      title="Colour"
      description="Raw scales exist so roles can be built from them. Components use roles only — `bg-surface`, never `bg-neutral-900`. That indirection is the entire reason the theme can change."
    >
      <Demo label="Brand scale" note="oklch, so equal steps look equal.">
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {brandScale.map((step) => (
            <div key={step} className="space-y-1.5">
              <div
                className="h-12 w-full rounded-lg border"
                style={{ backgroundColor: `var(--color-brand-${step})` }}
              />
              <p className="text-center font-mono text-2xs text-muted-foreground">
                {step}
              </p>
            </div>
          ))}
        </div>
      </Demo>

      <Demo
        label="Semantic roles"
        note="These are what components reference. Toggle the theme — every swatch below re-maps, and no component changes."
      >
        <Grid cols={4} gap="md">
          {roles.map((role) => (
            <div key={role.name} className="space-y-1.5">
              <div className={`h-12 w-full rounded-lg ${role.className}`} />
              <p className="font-mono text-2xs text-muted-foreground">
                {role.name}
              </p>
            </div>
          ))}
        </Grid>
      </Demo>
    </Section>
  );
}

const spacingSteps = [1, 2, 4, 6, 8, 12];

export function SpacingSection() {
  return (
    <Section
      id="spacing"
      title="Spacing"
      description="Gaps are applied by parents, never by children. A component that sets its own margin decides the spacing of every context it is dropped into."
    >
      <Demo label="Scale">
        <Stack gap="sm">
          {spacingSteps.map((step) => (
            <div key={step} className="flex items-center gap-4">
              <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                {step}
              </span>
              <div
                className="h-3 rounded bg-gradient-brand"
                style={{ width: `calc(var(--spacing) * ${step * 4})` }}
              />
            </div>
          ))}
        </Stack>
      </Demo>

      <Demo
        label="Layout primitives"
        note="Stack for columns, Inline for rows, Grid for responsive tiles."
      >
        <Stack gap="lg">
          <Inline gap="sm">
            {["Inline", "wraps", "by", "default"].map((word) => (
              <Badge key={word} variant="outline">
                {word}
              </Badge>
            ))}
          </Inline>
          <Grid cols={4} gap="sm">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground"
              >
                Grid
              </div>
            ))}
          </Grid>
        </Stack>
      </Demo>
    </Section>
  );
}

const elevations = [
  "elevation-flat",
  "elevation-raised",
  "elevation-floating",
  "elevation-overlay",
  "elevation-modal",
];

export function SurfaceSection() {
  return (
    <Section
      id="surfaces"
      title="Shadows & gradients"
      description="Elevation is named by intent, not by a shadow value picked per component. Shadows are layered — a tight contact shadow plus a soft ambient one — because that is what real objects cast."
    >
      <Demo label="Elevation">
        <Grid cols={3} gap="lg">
          {elevations.map((level) => (
            <div key={level} className="space-y-2">
              <div className={`h-20 rounded-xl border bg-card ${level}`} />
              <p className="font-mono text-2xs text-muted-foreground">
                {level}
              </p>
            </div>
          ))}
        </Grid>
      </Demo>

      <Demo
        label="Gradients"
        note="Three, and only three. A gradient per component is how an interface stops looking designed and starts looking decorated."
      >
        <Grid cols={3} gap="md">
          <div className="space-y-2">
            <div className="h-20 rounded-xl bg-gradient-brand" />
            <p className="font-mono text-2xs text-muted-foreground">
              gradient-brand
            </p>
          </div>
          <div className="space-y-2">
            <div className="h-20 rounded-xl border bg-gradient-brand-subtle" />
            <p className="font-mono text-2xs text-muted-foreground">
              gradient-brand-subtle
            </p>
          </div>
          <div className="space-y-2">
            <div className="h-20 rounded-xl border bg-surface bg-aurora" />
            <p className="font-mono text-2xs text-muted-foreground">
              gradient-aurora
            </p>
          </div>
        </Grid>
      </Demo>

      <Demo label="Glow" note="For the focused or actively-working element.">
        <Inline gap="lg">
          <div className="size-20 rounded-xl border bg-card glow-brand" />
          <div className="size-20 rounded-xl border bg-card glow-brand-sm" />
          <div className="size-20 animate-pulse-glow rounded-xl border bg-card" />
        </Inline>
      </Demo>
    </Section>
  );
}

export function IconSection() {
  return (
    <Section
      id="icons"
      title="Icons"
      description="`aria-hidden` is the default and `label` opts into the accessible variant — so the safe behaviour is what you get by doing nothing. Stroke width is fixed at 1.75 so large and small icons stay optically consistent."
    >
      <Demo label="Sizes">
        <Inline gap="lg" align="center">
          {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <Icon icon={Sparkles} size={size} />
              <span className="font-mono text-2xs text-muted-foreground">
                {size}
              </span>
            </div>
          ))}
        </Inline>
      </Demo>

      <Demo label="Tones">
        <Inline gap="lg">
          <Icon icon={ImageIcon} size="md" tone="muted" />
          <Icon icon={ImageIcon} size="md" tone="brand" />
          <Icon icon={ImageIcon} size="md" tone="success" />
          <Icon icon={ImageIcon} size="md" tone="warning" />
          <Icon icon={ImageIcon} size="md" tone="danger" />
        </Inline>
      </Demo>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function ButtonSection() {
  const [loading, setLoading] = useState(false);

  return (
    <Section
      id="buttons"
      title="Buttons"
      description="`gradient` and `glow` carry the futuristic look and are for the single primary action on a screen. A page of glowing buttons has no primary action at all."
    >
      <Demo label="Variants">
        <Inline gap="sm">
          <Button variant="gradient">
            <Sparkles /> Generate
          </Button>
          <Button>Default</Button>
          <Button variant="glow">Glow</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Link</Button>
        </Inline>
      </Demo>

      <Demo label="Sizes">
        <Inline gap="sm" align="center">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="xl">Extra large</Button>
          <Button size="icon" aria-label="More">
            <MoreHorizontal />
          </Button>
        </Inline>
      </Demo>

      <Demo
        label="States"
        note="Loading keeps the label so the button does not change width mid-interaction."
      >
        <Inline gap="sm">
          <Button
            variant="gradient"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 2000);
            }}
          >
            {loading ? "Generating" : "Click to load"}
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" block className="sm:w-auto">
            Block below sm
          </Button>
        </Inline>
      </Demo>
    </Section>
  );
}

export function BadgeSection() {
  return (
    <Section
      id="badges"
      title="Badges"
      description="Tonal by default — a badge annotates content, it does not compete with it. The dot is decorative; the text carries the meaning, so nothing is lost to colour blindness."
    >
      <Demo label="Variants">
        <Inline gap="sm">
          <Badge>Default</Badge>
          <Badge variant="brand">Brand</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="gradient">Pro</Badge>
        </Inline>
      </Demo>

      <Demo label="Status" note="How generation states are rendered.">
        <Inline gap="sm">
          <Badge variant="default" dot>
            Queued
          </Badge>
          <Badge variant="info" dot pulse>
            Running
          </Badge>
          <Badge variant="success" dot>
            Succeeded
          </Badge>
          <Badge variant="danger" dot>
            Failed
          </Badge>
        </Inline>
      </Demo>
    </Section>
  );
}

export function InputSection() {
  const [error, setError] = useState("");

  return (
    <Section
      id="inputs"
      title="Inputs"
      description="`Field` generates the id, associates the label, wires aria-describedby to whichever of hint/error is showing, and sets aria-invalid. Doing that by hand at every call site means it gets done correctly at about half of them."
    >
      <Demo label="Fields">
        <div className="max-w-md">
          <Stack gap="lg">
            <Field label="Email" hint="We never share this." required>
              {(props) => (
                <InputField
                  {...props}
                  type="email"
                  placeholder="you@studio.com"
                  leading={<Mail />}
                />
              )}
            </Field>

            <Field
              label="Prompt"
              error={error}
              hint="Describe what you want to generate."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  placeholder="A neon-lit street at night…"
                  onChange={(event) =>
                    setError(
                      event.target.value.length > 0 &&
                        event.target.value.length < 10
                        ? "Prompts need at least 10 characters."
                        : "",
                    )
                  }
                />
              )}
            </Field>

            <Field label="Search" hideLabel>
              {(props) => (
                <InputField
                  {...props}
                  placeholder="Search assets…"
                  leading={<Search />}
                />
              )}
            </Field>

            <Field label="Model">
              {(props) => (
                <Select>
                  <SelectTrigger {...props} className="w-full">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a">Aurora XL</SelectItem>
                    <SelectItem value="b">Nova Diffusion</SelectItem>
                    <SelectItem value="c">Helix Video</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </Stack>
        </div>
      </Demo>

      <Demo label="Toggles">
        <Stack gap="md">
          <label className="flex items-center gap-3 text-sm">
            <Checkbox defaultChecked />
            Save to library
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch defaultChecked />
            Public
          </label>
        </Stack>
      </Demo>
    </Section>
  );
}

export function CardSection() {
  return (
    <Section
      id="cards"
      title="Cards"
      description="Four surface treatments. `interactive` is separate from variant because any of them can be clickable — and the hover lift is suppressed on touch, where a sticky hover state is worse than none."
    >
      <Grid cols={2} gap="lg">
        <Card>
          <CardHeader>
            <CardTitle>Default</CardTitle>
            <CardDescription>
              The workhorse. A bordered panel on the page background.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Text size="sm" tone="muted">
              Use for almost everything.
            </Text>
          </CardContent>
        </Card>

        <Card variant="gradient">
          <CardHeader>
            <CardTitle>
              Gradient <Badge variant="gradient">Pro</Badge>
            </CardTitle>
            <CardDescription>
              Hairline gradient border, drawn with a mask so it works on any
              background.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="gradient" size="sm">
              Upgrade
            </Button>
          </CardFooter>
        </Card>

        <Card variant="glass">
          <CardHeader>
            <CardTitle>Glass</CardTitle>
            <CardDescription>
              Frosted. For anything floating over content.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card interactive>
          <CardHeader>
            <CardTitle>Interactive</CardTitle>
            <CardDescription>
              Lifts on hover, on pointer devices only.
            </CardDescription>
          </CardHeader>
        </Card>
      </Grid>
    </Section>
  );
}

export function OverlaySection() {
  return (
    <Section
      id="overlays"
      title="Dropdowns, dialogs & tooltips"
      description="All Radix-backed: focus trapping, focus restore, escape handling and scroll locking are behaviours you do not want to reimplement. Dialog for a task, AlertDialog for a decision that cannot be undone."
    >
      <Demo label="Dropdown">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              Actions <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Asset</DropdownMenuLabel>
            <DropdownMenuItem>
              <Download className="size-4" /> Download
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy className="size-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Demo>

      <Demo
        label="Dialogs"
        note="Dialog for a task with a form. AlertDialog for a destructive decision — it has no close-on-outside-click, on purpose."
      >
        <Inline gap="sm">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename collection</DialogTitle>
                <DialogDescription>
                  Choose a name your future self will recognise.
                </DialogDescription>
              </DialogHeader>
              <Field label="Name">
                {(props) => (
                  <InputField {...props} defaultValue="Neon studies" />
                )}
              </Field>
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button variant="gradient">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete 12 assets?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. The files are removed from storage
                  permanently.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Inline>
      </Demo>

      <Demo
        label="Tooltip"
        note="Never the only source of a label — tooltips do not exist on touch."
      >
        <Inline gap="sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Download">
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download original</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Copy">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy to clipboard</TooltipContent>
          </Tooltip>
        </Inline>
      </Demo>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

interface DemoRow {
  id: string;
  prompt: string;
  model: string;
  status: "SUCCEEDED" | "RUNNING" | "FAILED";
  credits: number;
}

const demoRows: DemoRow[] = [
  {
    id: "1",
    prompt: "Neon street at night",
    model: "Aurora XL",
    status: "SUCCEEDED",
    credits: 12,
  },
  {
    id: "2",
    prompt: "Isometric city block",
    model: "Nova",
    status: "RUNNING",
    credits: 20,
  },
  {
    id: "3",
    prompt: "Portrait, soft rim light",
    model: "Aurora XL",
    status: "FAILED",
    credits: 0,
  },
  {
    id: "4",
    prompt: "Product shot on marble",
    model: "Helix",
    status: "SUCCEEDED",
    credits: 8,
  },
];

const statusVariant = {
  SUCCEEDED: "success",
  RUNNING: "info",
  FAILED: "danger",
} as const;

export function TableSection() {
  const [page, setPage] = useState(3);

  const columns: DataTableColumn<DemoRow>[] = [
    {
      key: "prompt",
      header: "Prompt",
      cell: (row) => <span className="font-medium">{row.prompt}</span>,
    },
    {
      key: "model",
      header: "Model",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.model}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge
          variant={statusVariant[row.status]}
          dot
          pulse={row.status === "RUNNING"}
        >
          {row.status.toLowerCase()}
        </Badge>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.credits}</span>,
    },
  ];

  return (
    <Section
      id="tables"
      title="Tables & pagination"
      description="Below md each row becomes a stacked card. Every column stays visible, nothing truncates, and there is no hidden horizontal-scroll gesture. Narrow the window to see it switch."
    >
      <Demo label="DataTable">
        <DataTable
          columns={columns}
          rows={demoRows}
          getRowId={(row) => row.id}
          caption="Recent generations"
        />
      </Demo>

      <Demo
        label="Pagination"
        note="The slot count is constant, so the control does not resize as you page through it. Page numbers collapse to a counter on the narrowest screens."
      >
        <Stack gap="md" align="center">
          <Pagination page={page} totalPages={24} onPageChange={setPage} />
          <PaginationSummary page={page} pageSize={20} total={476} />
        </Stack>
      </Demo>

      <Demo label="Breadcrumbs">
        <Breadcrumbs
          items={[
            { label: "Library", href: "/library" },
            { label: "Collections", href: "/library/collections" },
            { label: "Neon studies" },
          ]}
        />
      </Demo>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function FeedbackSection() {
  const [overlay, setOverlay] = useState(false);

  return (
    <Section
      id="feedback"
      title="Loading, skeletons & toasts"
      description="Skeleton when the shape of the result is known; spinner when it is not; indeterminate progress when the work has no knowable total. A determinate bar frozen at 0% reads as a hung process."
    >
      <Demo label="Spinners & progress">
        <Stack gap="lg">
          <Inline gap="lg" align="center">
            <Spinner size="xs" />
            <Spinner size="sm" />
            <Spinner size="md" tone="brand" />
            <Spinner size="lg" tone="brand" />
          </Inline>
          <div className="max-w-md space-y-3">
            <ProgressBar value={68} label="Upload" />
            <ProgressBar label="Generating" />
            <Text size="xs" tone="muted">
              The second bar is indeterminate — the honest state for video
              generation, which reports nothing useful for minutes.
            </Text>
          </div>
        </Stack>
      </Demo>

      <Demo label="Skeletons">
        <Stack gap="lg">
          <SkeletonText lines={3} />
          <Grid cols={2} gap="md">
            <SkeletonCard />
            <Stack gap="sm">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-4/5" />
              <Skeleton className="h-9 w-3/5" />
            </Stack>
          </Grid>
          <SkeletonGrid count={4} />
        </Stack>
      </Demo>

      <Demo label="Loading overlay">
        <Stack gap="md" align="start">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOverlay(true);
              setTimeout(() => setOverlay(false), 1800);
            }}
          >
            Trigger overlay
          </Button>
          <LoadingOverlay loading={overlay} className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Content stays visible</CardTitle>
                <CardDescription>
                  Blurred rather than replaced, so the user keeps their context.
                </CardDescription>
              </CardHeader>
            </Card>
          </LoadingOverlay>
        </Stack>
      </Demo>

      <Demo
        label="Toasts"
        note="Failures persist, successes fade. A missed success costs nothing; a missed error costs ten minutes."
      >
        <Inline gap="sm">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.success("Asset saved", "Added to Neon studies.")
            }
          >
            Success
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.error("Generation failed", {
                description: "The provider rejected the prompt.",
                action: {
                  label: "Retry",
                  onClick: () => toast.info("Retrying…"),
                },
              })
            }
          >
            Error with action
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.warning("Low credits", "You have 12 remaining.")
            }
          >
            Warning
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.promise(
                new Promise((resolve) => setTimeout(resolve, 2000)),
                {
                  loading: "Generating…",
                  success: "Done",
                  error: "Failed",
                },
              )
            }
          >
            Promise
          </Button>
        </Inline>
      </Demo>

      <Demo
        label="Empty & error states"
        note="Not edge cases. Every account starts empty and generation regularly fails, so these are the first thing most users see."
      >
        <Grid cols={2} gap="md">
          <div className="rounded-xl border border-border">
            <EmptyState
              icon={ImageIcon}
              title="No assets yet"
              description="Generations you create will appear here."
              action={
                <Button variant="gradient" size="sm">
                  <Sparkles /> Generate
                </Button>
              }
            />
          </div>
          <div className="rounded-xl border border-border">
            <ErrorState onRetry={() => toast.info("Retrying…")} />
          </div>
        </Grid>
        <div className="mt-4 rounded-xl border border-border">
          <LoadingState message="Loading your library" />
        </div>
      </Demo>
    </Section>
  );
}

export function MotionSection() {
  const [key, setKey] = useState(0);

  return (
    <Section
      id="motion"
      title="Animation"
      description="Short, entrance-only, and reduced-motion aware. The CSS layer zeroes durations under prefers-reduced-motion, but JS-driven transforms bypass CSS entirely — so these components check it too."
    >
      <Demo label="Entrances">
        <Stack gap="md" align="start">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setKey((k) => k + 1)}
          >
            Replay
          </Button>
          <div key={key} className="w-full">
            <FadeIn>
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>FadeIn</CardTitle>
                  <CardDescription>
                    Fade and rise. The default for panels and sections.
                  </CardDescription>
                </CardHeader>
              </Card>
            </FadeIn>

            <Stagger stagger={0.06}>
              <Grid cols={4} gap="sm">
                {Array.from({ length: 8 }).map((_, i) => (
                  <StaggerItem key={i}>
                    <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-gradient-brand-subtle text-xs">
                      {i + 1}
                    </div>
                  </StaggerItem>
                ))}
              </Grid>
            </Stagger>
          </div>
        </Stack>
      </Demo>
    </Section>
  );
}
