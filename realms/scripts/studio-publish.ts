/** Called only by studio-fixture.py inside a newly owned disposable PostgreSQL cluster. */
import { readFileSync,realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { poolFor,migrate,assertSchema } from '../src/database.js';
import { publishContent,validateContent } from '../src/domains/content.js';
import { sandboxEncounter } from '../src/domains/content-studio.js';
const path=process.argv[2];if(!path)throw Error('Package path required');
const bytes=readFileSync(path),pkg=JSON.parse(bytes.toString());validateContent(pkg);
const directory=process.env.M02_DISPOSABLE_DATA_DIR,token=process.env.M02_DISPOSABLE_TOKEN,url=process.env.TEST_DATABASE_URL;
if(!directory||!token||!url||!/^\/tmp\/follybound-studio-[^/]+\/pgdata$/.test(directory)||realpathSync(directory)!==directory)throw Error('Owned disposable cluster required');
const marker=JSON.parse(readFileSync(directory+'/../disposable.json','utf8'));
if(marker.token!==token||marker.directory!==directory)throw Error('Disposable cluster marker mismatch');
const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/realms_test'||parsed.search)throw Error('Disposable loopback realms_test only');
const pool=poolFor(url);
try{
 const identity=(await pool.query("SELECT current_database() AS db,current_setting('data_directory') AS directory")).rows[0];
 if(identity.db!=='realms_test'||identity.directory!==directory)throw Error('Database is not the newly owned disposable cluster');
 if((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n!==0)throw Error('Fixture database must start empty');
 await migrate(pool);await assertSchema(pool);
 const release=await publishContent(pool,pkg),again=await publishContent(pool,pkg);if(release!==again)throw Error('Content publication was not idempotent');
 const modified=structuredClone(pkg);if(!modified.entities.length)throw Error('Fixture package must contain definitions');modified.entities[0]!.definition.name+=' changed without revision';
 let versionRefused=false,revisionRefused=false;
 try{await publishContent(pool,modified);}catch(e){if(e instanceof Error&&e.message==='CONTENT_VERSION_REUSED')versionRefused=true;else throw e;}
 modified.version+='-illegal-revision';try{await publishContent(pool,modified);}catch(e){if(e instanceof Error&&e.message==='CONTENT_REVISION_REUSED')revisionRefused=true;else throw e;}
 if(!versionRefused||!revisionRefused)throw Error('Released revision immutability failed');
 const encounters=pkg.entities.filter(e=>e.kind==='ENCOUNTER');if(encounters.length>32)throw Error('Local fixture proof supports up to 32 encounters; split larger authoring packages');
 const sandboxes=encounters.map(e=>{const a=sandboxEncounter(pkg,e.id,'BALANCED','studio-publication-proof-v1'),b=sandboxEncounter(pkg,e.id,'BALANCED','studio-publication-proof-v1');if(a.replayHash!==b.replayHash)throw Error('Sandbox replay differs');return {encounter:e.id,outcome:a.outcome,replayHash:a.replayHash,warnings:a.warnings};});
 const row=(await pool.query('SELECT checksum,manifest,sealed FROM content_releases WHERE id=$1',[release])).rows[0];
 console.log(JSON.stringify({status:'passed',scope:'DISPOSABLE_CLUSTER_ONLY',postgresVersion:(await pool.query('SELECT version() AS version')).rows[0].version,inputSha256:createHash('sha256').update(bytes).digest('hex'),packageVersion:pkg.version,contentReleaseId:release,releaseChecksum:row.checksum,sealed:row.sealed,manifest:row.manifest,migrations:(await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows,checks:['real backend content validation','001–050 migrations','real immutable content publication','idempotent seal','changed release version refused','changed definition revision refused','seeded encounter replay'],sandboxes,playerRuns:(await pool.query('SELECT count(*)::int n FROM runs')).rows[0].n}));
}finally{await pool.end();}
