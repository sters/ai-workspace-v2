// Connection
export { getDb, _resetDb, _setDbPath } from "./connection";
export { runMigrations } from "./migrations";

// Operations
export {
  insertOperation,
  updateOperationStatus,
  updateOperationWorkspace,
  updateOperationMeta,
  getOperation,
  listOperations,
  listRunningOperations,
  listOperationsWithAge,
  deleteOperation,
  deleteOperationsForWorkspace,
  _resetStatements,
} from "./operations";

// Events
export { appendEvents, getEvents, _resetEventStatements } from "./events";

// Event buffer
export { bufferEvent, flushEvents, startAutoFlush, stopAutoFlush } from "./event-buffer";

// JSONL migration
export { migrateJsonlToSqlite } from "./migrate-jsonl";

// Push subscriptions
export { addPushSubscription, removePushSubscription, getAllPushSubscriptions, _resetPushStatements } from "./push";

// Chat sessions
export { upsertChatSession, markChatSessionExited, getChatSession, deleteChatSession, markAllSessionsExited, _resetChatStatements } from "./chat-sessions";

// Workspace suggestions
export { insertSuggestion, listActiveSuggestions, dismissSuggestion, getSuggestion, _resetSuggestionStatements } from "./suggestions";
