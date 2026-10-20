export { getDb, _resetDb, _setDbPath } from "./connection";
export { runMigrations } from "./migrations";

export {
  insertOperation,
  updateOperationStatus,
  updateOperationWorkspace,
  updateOperationMeta,
  fillMissingOperationResultSummary,
  getOperation,
  listOperations,
  listRunningOperations,
  listOperationsWithAge,
  deleteOperation,
  deleteOperationsForWorkspace,
  listRecentCompletedOperations,
  listRecentFinishedOperations,
  listLatestOperationPerWorkspace,
  listRecentOperationsByTypes,
  _resetStatements,
} from "./operations";

export { appendEvents, getEvents, _resetEventStatements } from "./events";

export { bufferEvent, flushEvents, startAutoFlush, stopAutoFlush } from "./event-buffer";

export { migrateJsonlToSqlite } from "./migrate-jsonl";

export { addPushSubscription, removePushSubscription, getAllPushSubscriptions, _resetPushStatements } from "./push";

export { upsertChatSession, markChatSessionExited, getChatSession, deleteChatSession, markAllSessionsExited, _resetChatStatements } from "./chat-sessions";

export { insertSuggestion, listActiveSuggestions, dismissSuggestion, getSuggestion, _resetSuggestionStatements } from "./suggestions";

export { archiveWorkspace, unarchiveWorkspace, isWorkspaceArchived, listArchivedWorkspaces, getArchivedNameSet, _resetArchiveStatements } from "./archives";
export type { ArchivedWorkspace } from "./archives";

export { insertSnippet, updateSnippet, deleteSnippet, getSnippet, listSnippets, _resetSnippetStatements } from "./snippets";

export { insertChatStartPrompt, updateChatStartPrompt, deleteChatStartPrompt, listChatStartPrompts, _resetChatStartPromptStatements } from "./chat-start-prompts";
