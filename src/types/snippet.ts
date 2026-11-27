/** Where a snippet is offered: the new-workspace description, or a verification plan's instruction. */
export const SNIPPET_KINDS = ["init", "verify"] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

export interface Snippet {
  id: number;
  kind: SnippetKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
