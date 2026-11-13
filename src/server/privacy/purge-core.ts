export type Due = { workspaces: string[]; users: string[] };
export type PurgeDeps = {
  removeFiles: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
};

/**
 * Deletes what is due. A business's files are removed BEFORE its rows: if the files cannot be removed the business
 * is kept and tried again tomorrow, so no file is left behind with nothing pointing at it. One failure never stops
 * the others. Accounts go last, after the businesses they owned alone.
 */
export async function processPurge(due: Due, deps: PurgeDeps): Promise<{ workspaces: number; users: number; failed: number }> {
  let workspaces = 0;
  let users = 0;
  let failed = 0;
  for (const id of due.workspaces) {
    try {
      await deps.removeFiles(id);
      await deps.deleteWorkspace(id);
      workspaces++;
    } catch {
      failed++;
    }
  }
  for (const id of due.users) {
    try {
      await deps.deleteUser(id);
      users++;
    } catch {
      failed++;
    }
  }
  return { workspaces, users, failed };
}
