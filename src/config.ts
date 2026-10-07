export function config(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('This development server must bind to 127.0.0.1.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!env.DEV_API_TOKEN || env.DEV_API_TOKEN.length < 32) throw new Error('DEV_API_TOKEN must have at least 32 characters.');
  if (!env.DEV_ACCOUNT_ID || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.DEV_ACCOUNT_ID)) throw new Error('DEV_ACCOUNT_ID must be a UUID.');
  return { host, port, databaseUrl: env.DATABASE_URL, token: env.DEV_API_TOKEN, accountId: env.DEV_ACCOUNT_ID };
}

export type Authentication={mode:'development';token:string;accountId:string}|{mode:'sessions';throttleKey:string};
export function serverConfig(env:NodeJS.ProcessEnv=process.env){
  if(Object.keys(env).some(k=>['DATABASE_ADMIN_URL','TEST_DATABASE_URL','TEST_DATABASE_ADMIN_URL'].includes(k) || k.startsWith('AUTH_ENROLL_'))) throw new Error('Administration/test secrets must not enter the server process.');
  const mode=env.AUTH_MODE??'development';
  if(mode==='development'){
    const settings=config(env);return {...settings,auth:{mode,token:settings.token,accountId:settings.accountId} as Authentication};
  }
  if(mode!=='sessions') throw new Error('Invalid AUTH_MODE.');
  if(env.DEV_API_TOKEN || env.DEV_ACCOUNT_ID) throw new Error('Session mode excludes development credentials.');
  if(!env.DATABASE_URL || !/^[0-9a-f]{64}$/.test(env.AUTH_THROTTLE_KEY??'')) throw new Error('Session database URL and authentication throttle key are required.');
  const host=env.HOST??'127.0.0.1',port=Number(env.PORT??3000);
  if(host!=='127.0.0.1' || !Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid private server address.');
  return {host,port,databaseUrl:env.DATABASE_URL,auth:{mode,throttleKey:env.AUTH_THROTTLE_KEY!} as Authentication};
}
