export interface WorkspaceSuggestion {
  id: string;
  sourceWorkspace: string;
  sourceOperationId: string;
  targetRepository: string;
  title: string;
  description: string;
  dismissed: boolean;
  createdAt: string;
}
