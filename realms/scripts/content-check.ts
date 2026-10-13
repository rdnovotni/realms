import { readFileSync } from 'node:fs';
import { validateContent } from '../src/domains/content.js';
try {
  const data=JSON.parse(readFileSync(0,'utf8')) as unknown;
  validateContent(data);
  console.log('Content package passed the existing backend validators. No database was accessed.');
} catch(error) {
  console.error(error instanceof Error ? error.message : 'Invalid content');
  process.exitCode=1;
}
