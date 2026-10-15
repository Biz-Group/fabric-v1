import type { Id } from "../../../convex/_generated/dataModel";

/** A node and every ancestor: what the workbench needs to select a node, or
 * to reveal it in the tree, without looking it up first. That matters for a
 * node just created by an action, which the hierarchy tree may not have yet.
 * A blank name is filled in by the workbench's display-name fallbacks. */
export type RevealPath =
  | { kind: "function"; functionId: Id<"functions">; functionName: string }
  | {
      kind: "department";
      functionId: Id<"functions">;
      functionName: string;
      departmentId: Id<"departments">;
      departmentName: string;
    }
  | {
      kind: "process";
      functionId: Id<"functions">;
      functionName: string;
      departmentId: Id<"departments">;
      departmentName: string;
      processId: Id<"processes">;
      processName: string;
    };
