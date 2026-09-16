import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// A small SQL repository adapter. Transactions must be synchronous: no await
// between BEGIN and COMMIT, so another request cannot join the transaction.
export class SQLiteDatabase {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.raw = new DatabaseSync(filename, { timeout: 5000, enableDoubleQuotedStringLiterals: true });
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  }

  prepare(sql) {
    const db = this;
    const statement = (values = []) => ({
      sql, values,
      bind: (...args) => statement(args),
      first: () => db.raw.prepare(sql).get(...values) || null,
      all: () => ({ results: db.raw.prepare(sql).all(...values) }),
      run: () => ({ success: true, meta: db.raw.prepare(sql).run(...values) })
    });
    return statement();
  }

  transaction(callback) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      if (result?.then) throw new Error('SQLite transactions cannot contain asynchronous work');
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  batch(statements) { return this.transaction(() => statements.map(statement => statement.run())); }
  exec(sql) { return this.raw.exec(sql); }
  backup(filename) { return backup(this.raw, filename); }
  close() { this.raw.close(); }
}
