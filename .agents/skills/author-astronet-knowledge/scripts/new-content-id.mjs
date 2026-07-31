#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';

const kind = process.argv[2] ?? 'document';

if (kind !== 'document' && kind !== 'board') {
  process.stderr.write('Usage: new-content-id.mjs [document|board]\n');
  process.exitCode = 1;
} else {
  const id = randomBytes(16).toString('base64url');
  const shard = createHash('sha256').update(id).digest('hex').slice(0, 2);
  const directory = kind === 'document' ? 'documents' : 'boards';

  process.stdout.write(`${JSON.stringify({
    kind,
    id,
    shard,
    path: `content/${directory}/${shard}/${id}.xml`,
  })}\n`);
}
