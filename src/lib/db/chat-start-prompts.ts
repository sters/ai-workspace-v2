import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";
import type { ChatStartPrompt } from "@/types/chat-start-prompt";

let _insert: Statement | null = null;
let _update: Statement | null = null;
let _delete: Statement | null = null;
let _get: Statement | null = null;
let _list: Statement | null = null;

function stmts(db: Database) {
  if (!_insert) {
    _insert = db.prepare(`
      INSERT INTO chat_start_prompts (title, content)
      VALUES ($title, $content)
    `);
  }
  if (!_update) {
    _update = db.prepare(`
      UPDATE chat_start_prompts
      SET title = $title, content = $content, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $id
    `);
  }
  if (!_delete) {
    _delete = db.prepare("DELETE FROM chat_start_prompts WHERE id = ?");
  }
  if (!_get) {
    _get = db.prepare("SELECT * FROM chat_start_prompts WHERE id = ?");
  }
  if (!_list) {
    // Creation order: the Start Chat menu lists these, and an edit must not
    // move an item out from under the user's muscle memory.
    _list = db.prepare("SELECT * FROM chat_start_prompts ORDER BY id ASC");
  }
  return { insert: _insert, update: _update, delete: _delete, get: _get, list: _list };
}

export function _resetChatStartPromptStatements(): void {
  _insert = null;
  _update = null;
  _delete = null;
  _get = null;
  _list = null;
}

_onDbReset(_resetChatStartPromptStatements);

interface ChatStartPromptRow {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: ChatStartPromptRow): ChatStartPrompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertChatStartPrompt(p: { title: string; content: string }): ChatStartPrompt {
  const st = stmts(getDb());
  const result = st.insert.run({ $title: p.title, $content: p.content });
  return rowToDomain(st.get.get(Number(result.lastInsertRowid)) as ChatStartPromptRow);
}

export function updateChatStartPrompt(
  id: number,
  p: { title: string; content: string },
): ChatStartPrompt | null {
  const st = stmts(getDb());
  const result = st.update.run({ $id: id, $title: p.title, $content: p.content });
  if (result.changes === 0) return null;
  const row = st.get.get(id) as ChatStartPromptRow | null;
  return row ? rowToDomain(row) : null;
}

export function deleteChatStartPrompt(id: number): boolean {
  return stmts(getDb()).delete.run(id).changes > 0;
}

export function listChatStartPrompts(): ChatStartPrompt[] {
  return (stmts(getDb()).list.all() as ChatStartPromptRow[]).map(rowToDomain);
}
