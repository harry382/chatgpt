'use strict';

class CloudStore {
  constructor(database, unit = database) { this.database = database; this.unit = unit; }
  async get(table, id) {
    try {
      const result = await this.unit.collection(table).doc(id).get();
      const data = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!data) return null;
      const row = { ...data }; delete row._id;
      return row;
    } catch (error) {
      if (['DATABASE_DOCUMENT_NOT_EXIST', 'DOCUMENT_NOT_FOUND'].includes(error.code) || /document[^\n]*(does not exist|not found|not exist)/i.test(error.message || error.errMsg || '')) return null;
      throw error;
    }
  }
  async put(table, id, data) {
    const row = { ...data }; delete row._id;
    await this.unit.collection(table).doc(id).set({ data: row });
  }
  async find(table, criteria, options = {}) {
    const where = {};
    Object.keys(criteria).forEach(key => {
      const value = criteria[key];
      where[key] = value && typeof value === 'object' && '$gt' in value ? this.database.command.gt(value.$gt) : value;
    });
    let query = this.unit.collection(table).where(where);
    if (options.orderBy) query = query.orderBy(options.orderBy, options.direction || 'asc').orderBy('_id', options.direction || 'asc');
    const result = await query.skip(options.offset || 0).limit(options.limit || 20).get();
    return result.data.map(item => { const row = { ...item }; delete row._id; return row; });
  }
  transaction(callback) { return this.database.runTransaction(unit => callback(new CloudStore(this.database, unit)), 5); }
}
module.exports = { CloudStore };
