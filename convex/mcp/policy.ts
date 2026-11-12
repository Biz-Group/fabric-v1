/**
 * The terms a workspace admin accepts when switching the Fabric MCP server on
 * (M1, M9). The accepted version is stored on `orgFeatures.mcpPolicyVersion`.
 *
 * DRAFT: Saish finalises the wording in Phase 4 (docs/fabric-mcp-build-task-list.md).
 * Changing the text means a new version; admins who accepted an older one
 * keep MCP on, and the admin page shows which version they accepted.
 */
export const MCP_POLICY = {
  version: "draft-2026-11-12",
  title: "Connecting AI assistants to Fabric",
  points: [
    "Members of this workspace will be able to connect AI assistants, such as Claude or Microsoft Copilot, to Fabric. Each member sees only what they can already see in Fabric.",
    "When an assistant reads Fabric data, that data leaves Fabric and is processed by the assistant's provider, under that provider's terms and in that provider's regions. Fabric's data-residency commitments cover Fabric itself; they do not extend to an assistant's provider.",
    "Fabric staff who are members of this workspace can connect assistants too.",
    "You can switch this off at any time. Access stops immediately; anything an assistant has already read stays with that assistant.",
  ],
} as const;
