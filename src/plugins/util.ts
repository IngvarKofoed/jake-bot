/**
 * Clean up MCP-prefixed tool names into human-readable form.
 *
 * "mcp__process-manager__start_process" → "Process Manager · Start Process"
 * "Read"                                → "Read"
 */
export function cleanToolName(raw: string): string {
  if (raw.startsWith("mcp__")) {
    const parts = raw.slice(5).split("__");
    return parts
      .map((p) =>
        p
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      )
      .join(" \u00B7 ");
  }
  return raw;
}
