// netlify/functions/nightly-backup.js
// Scheduled function — runs nightly at 2 AM ET via netlify.toml cron.
// Snapshots golf_registrations and golf_sponsors into golf_config,
// keyed as backup_YYYY-MM-DD. Retains 7 days; purges older entries.

function getStore() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

  return {
    async getTable(table) {
      const r = await fetch(`${base}/${table}?select=data&order=created_at.asc,id.asc`, { headers });
      if (!r.ok) throw new Error(`getTable ${table} failed: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      return rows.map(x => x.data);
    },
    async listBackupKeys() {
      const r = await fetch(`${base}/golf_config?key=like.backup_%25&select=key,updated_at&order=key.asc`, { headers });
      if (!r.ok) throw new Error(`listBackupKeys failed: ${r.status} ${await r.text()}`);
      return await r.json();
    },
    async saveBackup(key, value) {
      const r = await fetch(`${base}/golf_config`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal', 'on_conflict': 'key' },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`saveBackup ${key} failed: ${r.status} ${await r.text()}`);
    },
    async deleteBackup(key) {
      const r = await fetch(`${base}/golf_config?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE', headers,
      });
      if (!r.ok) throw new Error(`deleteBackup ${key} failed: ${r.status} ${await r.text()}`);
    },
  };
}

exports.handler = async (event) => {
  // Allow manual trigger via GET with admin key, or scheduled invocation
  const isScheduled = event.type === 'scheduled';
  const isManual    = event.httpMethod === 'GET' &&
    (event.headers['x-admin-key'] === process.env.ADMIN_PASSWORD);

  if (!isScheduled && !isManual) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const store = getStore();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const backupKey = `backup_${today}`;

  try {
    // Snapshot both tables
    const [registrations, sponsors] = await Promise.all([
      store.getTable('golf_registrations'),
      store.getTable('golf_sponsors'),
    ]);

    const snapshot = {
      date:          today,
      createdAt:     new Date().toISOString(),
      registrations,
      sponsors,
      counts: {
        registrations: registrations.length,
        sponsors:      sponsors.length,
      },
    };

    // Save today's backup
    await store.saveBackup(backupKey, snapshot);
    console.log(`Backup saved: ${backupKey} — ${registrations.length} registrations, ${sponsors.length} sponsors`);

    // Purge backups older than 7 days
    const allBackups = await store.listBackupKeys();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const toDelete = allBackups.filter(b => {
      const dateStr = b.key.replace('backup_', '');
      return dateStr < cutoffStr;
    });

    for (const b of toDelete) {
      await store.deleteBackup(b.key);
      console.log(`Purged old backup: ${b.key}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success:  true,
        backup:   backupKey,
        counts:   snapshot.counts,
        purged:   toDelete.map(b => b.key),
      }),
    };
  } catch (err) {
    console.error('Backup failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
