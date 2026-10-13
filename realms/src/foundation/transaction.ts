import type pg from 'pg';
export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    let broken=false;
    let disconnected:Error|undefined;
    const onError=(error:Error)=>{broken=true;disconnected=error;};
    client.on('error',onError);
    try {
      await client.query('BEGIN');
      const result = await work(client);
      if(disconnected)throw disconnected;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken=true; /* Discard a disconnected client; preserve the original failure. */ }
      const code = (error as { code?: string }).code;
      if (attempt >= 2 || (code !== '40001' && code !== '40P01')) throw error;
      // Only database work belongs here; external effects go through the outbox.
    } finally { client.release(broken);client.removeListener('error',onError); }
  }
}
