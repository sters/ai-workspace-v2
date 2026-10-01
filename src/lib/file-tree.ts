/**
 * A flat list of slash-separated file paths as tree rows: each directory once,
 * before its contents, directories before files, so the UI renders it in one
 * pass and hides a collapsed directory's rows by prefix. A chain of directories
 * that each hold only the next one is a single row named by the whole chain.
 */

export interface FileTreeRow {
  /** The directory's own path for a directory; the file's path otherwise. */
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
}

interface Node {
  dirs: Map<string, Node>;
  files: string[];
}

export function buildFileTree(paths: string[]): FileTreeRow[] {
  const root: Node = { dirs: new Map(), files: [] };
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      let next = node.dirs.get(dir);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(dir, next);
      }
      node = next;
    }
    node.files.push(parts[parts.length - 1]);
  }

  const rows: FileTreeRow[] = [];
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const name of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      // A directory holding only one directory says nothing on a row of its
      // own, and a deep source tree is mostly those: fold the chain into one.
      let label = name;
      let child = node.dirs.get(name)!;
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [onlyName, only] = [...child.dirs][0];
        label = `${label}/${onlyName}`;
        child = only;
      }
      const dirPath = prefix ? `${prefix}/${label}` : label;
      rows.push({ path: dirPath, name: label, depth, isDir: true });
      walk(child, dirPath, depth + 1);
    }
    for (const name of [...node.files].sort((a, b) => a.localeCompare(b))) {
      rows.push({ path: prefix ? `${prefix}/${name}` : name, name, depth, isDir: false });
    }
  };
  walk(root, "", 0);
  return rows;
}
