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
  /**
   * Signs that following this approved lesson went wrong. They change nothing
   * agents get; a person keeps, rewrites or rejects the lesson, which clears them.
   */
  challenges: LessonEvidence[];
  /** Approved lessons this one replaces when it is approved. */
  replaces: string[];
  sourceWorkspace: string;
  createdAt: string;
  updatedAt: string;
}

/** One entry of the distiller's structured output. */
export interface DistilledLesson {
  action: "new" | "reinforce" | "merge" | "challenge";
  section: LessonSection;
  /** The lesson text; unused for `reinforce` and `challenge`. */
  text: string;
  /** `reinforce`: the one lesson it repeats. `merge`: the approved lessons it replaces. `challenge`: the one approved lesson it disputes. */
  targetIds: string[];
  evidence: { url?: string; note: string }[];
}
