"use client";

import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { request } from "@/lib/http";

/**
 * Create and revoke the keys that let other programs act as you.
 *
 * ## The plaintext is shown once, and the UI has to be honest about it
 *
 * Only a hash is stored, so there is no endpoint that can return a key again —
 * see `services/api-keys/index.ts`. That makes the moment after creation the
 * single point of failure for the whole feature: somebody who closes the panel
 * without copying has to create another key and revoke this one.
 *
 * So the new key is not a toast. It stays on screen until explicitly dismissed,
 * it says plainly that it will not be shown again, and dismissing it is a
 * deliberate click rather than a timeout.
 *
 * ## Revoking asks first
 *
 * A revoked key cannot be un-revoked, and the thing it breaks is somebody's
 * automation rather than this page — the failure shows up somewhere else,
 * later. `lastUsedAt` is displayed for exactly that reason: "still in use
 * yesterday" is the fact that should stop the click.
 */

interface KeySummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function when(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const data = await request<{ keys: KeySummary[] }>("/api/keys");
      setKeys(data.keys);
    } catch {
      setError("Could not load your keys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError("");

    try {
      const key = await request<{ key: string; name: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setIssued(key);
      setName("");
      setCopied(false);
      await refresh();
    } catch {
      setError("Could not create that key.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, keyName: string) {
    if (
      !window.confirm(
        `Revoke "${keyName}"? Anything using it stops working immediately, and this cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await request(`/api/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      setError("Could not revoke that key.");
    }
  }

  const active = keys.filter((key) => !key.revokedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputField
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits, because naming a key then hunting for the button
            // is one interaction too many for something people do rarely and
            // always in a hurry.
            if (event.key === "Enter") void create();
          }}
          placeholder="What is it for? — Claude Desktop, my laptop, n8n"
          maxLength={80}
          aria-label="Name for the new key"
        />
        <Button onClick={create} disabled={creating || !name.trim()}>
          {creating ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Create key
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Not a toast. There is no way to retrieve this value again, so it must
          not disappear on a timer or when focus moves. */}
      {issued ? (
        <div className="rounded-xl border border-primary/40 bg-surface-sunken p-5">
          <p className="text-sm font-medium">
            Copy “{issued.name}” now — this is the only time it is shown.
          </p>
          <p className="mt-3 rounded-lg border border-border bg-background p-3 font-mono text-xs break-all select-all">
            {issued.key}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issued.key);
                  setCopied(true);
                } catch {
                  // Clipboard access is denied in some contexts. The value is
                  // `select-all` above, so a manual copy still works — saying
                  // "copied" when nothing was would be worse than saying
                  // nothing.
                  setError("Could not copy. Select the key above instead.");
                }
              }}
            >
              <Copy />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              I have saved it
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No keys yet. Create one to use Atheos from Claude, ChatGPT, your
          editor or your own code.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {active.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{key.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {key.prefix}…
                </p>
                {/* The fact that should stop a careless revoke. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {when(key.createdAt)} · Last used{" "}
                  {when(key.lastUsedAt)}
                </p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke(key.id, key.name)}
              >
                <Trash2 />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
