import pg from 'pg';
import config from './config.js';

const { Pool } = pg;
const pool = new Pool(config.db);

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

export default pool;