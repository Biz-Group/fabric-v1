/**
 * The terms a workspace admin accepts when switching the Fabric MCP server on
 * (M1, M2, M9, B2). The accepted version is stored on
 * `orgFeatures.mcpPolicyVersion`; the admin page asks workspaces that accepted
 * an older version to accept again.
 *
 * Approved by Saish 2026-11-12 (docs/fabric-mcp-policy-draft.md): providers
 * stay unnamed, the checkbox confirms the admin's authority, and the staff
 * point says staff use is recorded and visible. Changing the text means a new
 * version.
 */
export const MCP_POLICY = {
  version: "2026-11-v1",
  title: "Connecting AI assistants to Fabric (MCP)",
  points: [
    "What this switches on: members of this workspace can connect AI assistants that support the Model Context Protocol (MCP), using their own Fabric sign-in. Each assistant sees only what that member can see in Fabric. It can read, and it can't change anything.",
    "Data leaves Fabric: when an assistant reads Fabric data, the data goes to that assistant's provider, which handles it under its own terms and in its own regions. These may be outside the UAE and the EU. Fabric's data-residency commitments cover Fabric's own systems, not the assistant's provider. Your organization chooses which assistants its members use, and is responsible for any agreements it needs with those providers.",
    "What assistants can read: by default, overviews, process flows, signals, systems, coverage and Fabric help. Individual contributions and transcripts are available only if you allow them; they contain contributors' own words and names.",
    "Fabric staff: Biz Group staff who are members of this workspace, for support and administration, can connect assistants to it on the same terms. Their use is recorded like any member's and appears on this page's Usage card.",
    "What Fabric records: for each request, the time, the member, the assistant and the tool used. Never the question or the answer. This shows you usage and is used to bill the add-on.",
    "Switching off: you can switch this off at any time, and access stops immediately. What an assistant has already read stays with its provider, under that provider's terms.",
  ],
} as const;

/** The acceptance checkbox's label on Admin → MCP. */
export const MCP_POLICY_ACCEPTANCE =
  "I accept these terms on behalf of this workspace and confirm I'm authorised to do so.";
