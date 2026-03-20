export interface WorkspaceSuggestion {
  id: string;
  sourceWorkspace: string;
  sourceOperationId: string;
  title: string;
  description: string;
  dismissed: boolean;
  createdAt: string;
}
