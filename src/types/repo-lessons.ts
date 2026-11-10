export type LessonSection = "implementation" | "review";

/**
 * `candidate` waits for a human; only `approved` reaches agents. `superseded`
 * is an approved lesson an approved merge replaced.
 */
export type LessonStatus = "candidate" | "approved" | "rejected" | "superseded";

export interface LessonEvidence {
  workspace: string;
  /** A PR, comment or commit permalink, when the signal has one. */
  url?: string;
  note: string;
}

export interface RepoLesson {
  id: string;
  /** The clone's path under `repositories/`, e.g. `github.com/org/repo`. */
  repoKey: string;
  section: LessonSection;
  text: string;
  status: LessonStatus;
  evidence: LessonEvidence[];
  /** Approved lessons this one replaces when it is approved. */
  replaces: string[];
  sourceWorkspace: string;
  createdAt: string;
  updatedAt: string;
}

/** One entry of the distiller's structured output. */
export interface DistilledLesson {
  action: "new" | "reinforce" | "merge";
  section: LessonSection;
  /** The lesson text; unused for `reinforce`. */
  text: string;
  /** `reinforce`: the one lesson it repeats. `merge`: the approved lessons it replaces. */
  targetIds: string[];
  evidence: { url?: string; note: string }[];
}
