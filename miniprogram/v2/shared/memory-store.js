'use strict';

const clone = value => JSON.parse(JSON.stringify(value));
function matches(row, criteria) {
  return Object.keys(criteria).every(key => {
    const expected = criteria[key];
    if (expected && typeof expected === 'object') {
      if ('$gt' in expected) return row[key] > expected.$gt;
      throw new Error('Unsupported query operator');
    }
    return row[key] === expected;
  });
}
class MemoryStore {
  constructor(initial = {}, onSave = () => {}) {
    this.data = clone(initial); this.onSave = onSave; this.queue = Promise.resolve();
  }
  async get(table, id) { const row = (this.data[table] || {})[id]; return row ? clone(row) : null; }
  async put(table, id, row) { if (!this.data[table]) this.data[table] = {}; this.data[table][id] = clone(row); }
  async find(table, criteria = {}, options = {}) {
    let rows = Object.values(this.data[table] || {}).filter(row => matches(row, criteria));
    const field = options.orderBy || 'id', direction = options.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : a.id.localeCompare(b.id)) * direction);
    return clone(rows.slice(options.offset || 0, (options.offset || 0) + (options.limit || 20)));
  }
  transaction(callback) {
    const operation = this.queue.then(async () => {
      const unit = new MemoryStore(this.data);
      const result = await callback(unit);
      const next = clone(unit.data);
      await this.onSave(next);
      this.data = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  snapshot() { return clone(this.data); }
}
module.exports = { MemoryStore };
