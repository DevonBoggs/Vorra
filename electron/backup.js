// Backup System — JSON backup/restore with auto-rotation

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const MAX_AUTO_BACKUPS = 10;

/**
 * Get the backups directory path, creating it if needed.
 * @returns {string}
 */
function getBackupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save a backup of the current database state.
 * @param {Object} dbModule — the database module (must have exportData())
 * @param {string} [customPath] — optional custom file path; uses default if omitted
 * @returns {string} The path the backup was saved to
 */
function saveBackup(dbModule, customPath) {
  const jsonStr = dbModule.exportData();
  let savePath;

  if (customPath) {
    savePath = customPath;
    // Ensure parent directory exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } else {
    const dir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    savePath = path.join(dir, `vorra-backup-${timestamp}.json`);
  }

  fs.writeFileSync(savePath, jsonStr, 'utf-8');
  console.log(`[Vorra:Backup] Saved to ${savePath}`);
  return savePath;
}

/**
 * Restore data from a backup file into the database.
 * @param {Object} dbModule — the database module (must have importData())
 * @param {string} filePath — path to the backup JSON file
 * @returns {Object} The restored data object
 */
function restoreBackup(dbModule, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid backup file (not valid JSON): ${err.message}`);
  }

  // Support both wrapped format { version, data } and raw key-value format
  const data = parsed.data || parsed;
  dbModule.importData(data);

  console.log(`[Vorra:Backup] Restored from ${filePath}`);
  return data;
}

/**
 * List all backups in the backup directory.
 * @returns {Array<{path: string, filename: string, date: string, size: number}>}
 */
function listBackups() {
  const dir = getBackupDir();
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return files
    .filter((f) => f.startsWith('vorra-backup-') && f.endsWith('.json'))
    .map((f) => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return {
        path: fullPath,
        filename: f,
        date: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

/**
 * Perform an auto-backup and clean old ones.
 * @param {Object} dbModule — the database module
 */
function autoBackup(dbModule) {
  try {
    saveBackup(dbModule);
    cleanOldBackups();
    console.log('[Vorra:Backup] Auto-backup complete');
  } catch (err) {
    console.error('[Vorra:Backup] Auto-backup failed:', err.message);
  }
}

/**
 * Remove old auto-backups, keeping only the most recent MAX_AUTO_BACKUPS.
 */
function cleanOldBackups() {
  const backups = listBackups();
  if (backups.length <= MAX_AUTO_BACKUPS) return;

  const toDelete = backups.slice(MAX_AUTO_BACKUPS);
  for (const backup of toDelete) {
    try {
      fs.unlinkSync(backup.path);
      console.log(`[Vorra:Backup] Removed old backup: ${backup.filename}`);
    } catch (err) {
      console.error(`[Vorra:Backup] Failed to remove ${backup.filename}:`, err.message);
    }
  }
}

module.exports = {
  saveBackup,
  restoreBackup,
  listBackups,
  autoBackup,
  cleanOldBackups,
  getBackupDir,
};
