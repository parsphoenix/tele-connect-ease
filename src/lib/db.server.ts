import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

export function getDb(): mysql.Pool {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST!,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 8,
    connectTimeout: 10000,
    enableKeepAlive: true,
  });
  return pool;
}

export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = getDb();
  const [rows] = await db.query(sql, params);
  return rows as T[];
}
