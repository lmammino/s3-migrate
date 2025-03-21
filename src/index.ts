#! /usr/bin/env node

// @ts-ignore
import { compose } from 'node:stream'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { ProgressBar } from '@opentf/cli-pbar'
import { Command, Option } from 'commander'
import 'dotenv/config'
import prettyBytes from 'pretty-bytes'
import { type Database, open } from 'sqlite'
import sqlite3 from 'sqlite3'
import pkg from '../package.json' with { type: 'json' }
import { ChunkSizeTransform } from './chunkSize.js'
import { createS3Client } from './client.js'

const program = new Command()
let db: Database
let isShuttingDown = false

async function openDatabase(stateFile: string) {
  return open({
    filename: stateFile,
    driver: sqlite3.Database,
  })
}

async function catalogObjects(
  bucketName: string,
  stateFile: string,
  prefix?: string,
) {
  const client = createS3Client('SRC_')
  db = await openDatabase(stateFile)
  await db.exec(
    'CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, size INTEGER, etag TEXT, last_modified TEXT, copied INTEGER DEFAULT 0)',
  )
  let ContinuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken,
      Prefix: prefix,
      MaxKeys: 1000,
    })
    const response = await client.send(command)

    if (response.Contents) {
      for (const obj of response.Contents) {
        await db.run(
          'INSERT OR IGNORE INTO objects (key, size, etag, last_modified, copied) VALUES (?, ?, ?, ?, 0)',
          obj.Key,
          obj.Size,
          obj.ETag,
          obj.LastModified?.toISOString(),
        )
      }
    }
    ContinuationToken = response.NextContinuationToken
  } while (ContinuationToken)

  await db.close()
  console.log('Cataloging complete.')
}

async function copyObjects(
  srcBucketName: string,
  destBucketName: string,
  stateFile: string,
  concurrency: number,
  chunkSizeBytes: number,
  sortBy?: string,
  sortOrder?: string,
  checksumsWhenRequired?: boolean,
) {
  const checksums = checksumsWhenRequired ? 'WHEN_REQUIRED' : 'WHEN_SUPPORTED'
  db = await openDatabase(stateFile)
  const srcS3 = createS3Client('SRC_', checksums)
  const destS3 = createS3Client('DEST_', checksums)
  const maxConcurrency = Math.max(1, concurrency)
  console.log(`Using concurrency level: ${maxConcurrency}`)

  const { count: totalObjects } = (await db.get(
    'SELECT COUNT(*) AS count FROM objects WHERE copied = 0',
  )) || { count: 0 }
  if (totalObjects === 0) {
    console.log('Nothing to copy.')
    return
  }

  const { totalBytes } = (await db.get(
    'SELECT SUM(size) AS totalBytes FROM objects WHERE copied = 0',
  )) || { count: 0 }

  console.log(`Copying ${totalObjects} objects...`)
  const bar = new ProgressBar()
  bar.start({ total: totalObjects })
  let completed = 0
  let copiedBytes = 0

  let orderByClause = ''

  if (sortBy) {
    const order = sortOrder || 'asc'
    orderByClause = `ORDER BY ${sortBy} ${order}`
  }

  async function copyObject(key: string, size: number) {
    if (isShuttingDown) {
      return
    }

    try {
      const getCommand = new GetObjectCommand({
        Bucket: srcBucketName,
        Key: key,
      })
      const response = await srcS3.send(getCommand)

      const dataStream = compose(
        response.Body,
        new ChunkSizeTransform(chunkSizeBytes),
      )

      const putCommand = new PutObjectCommand({
        Bucket: destBucketName,
        Key: key,
        Body: dataStream,
        ContentLength: size,
      })
      await destS3.send(putCommand)

      await db.run('UPDATE objects SET copied = 1 WHERE key = ?', key)
      completed++
      copiedBytes += size
      bar.update({
        value: completed,
        suffix: `(${prettyBytes(copiedBytes)}/${prettyBytes(totalBytes)})`,
      })
    } catch (error) {
      console.error(`Error copying ${key}:`, error)
    }
  }

  while (!isShuttingDown) {
    const objects = await db.all(
      `SELECT key, size FROM objects WHERE copied = 0 ${orderByClause} LIMIT ?`,
      maxConcurrency,
    )
    if (objects.length === 0) break
    await Promise.all(objects.map((obj) => copyObject(obj.key, obj.size)))
  }

  bar.stop()
  await db.close()

  console.log(isShuttingDown ? 'Copy interrupted.' : 'Copy process completed.')
}

process.on('SIGINT', () => {
  isShuttingDown = true
})

program
  .command('catalog')
  .requiredOption('--src-bucket-name <name>', 'Source bucket name')
  .requiredOption('--state-file <path>', 'Path to SQLite state file')
  .option('--prefix <prefix>', 'Prefix to filter objects by')
  .action(({ srcBucketName, stateFile, prefix }) =>
    catalogObjects(srcBucketName, stateFile, prefix),
  )

program
  .command('copy')
  .requiredOption('--src-bucket-name <name>', 'Source bucket name')
  .requiredOption('--dest-bucket-name <name>', 'Destination bucket name')
  .requiredOption('--state-file <path>', 'Path to SQLite state file')
  .option('--concurrency <number>', 'Max concurrent copies', '8')
  .option(
    '--chunk-size-bytes <number>',
    'Size of each chunk in bytes',
    '2097152',
  )
  .addOption(
    new Option(
      '--sort-by <field>',
      'Field to sort by (key, size, etag, last_modified)',
    ).choices(['key', 'size', 'etag', 'last_modified']),
  )
  .addOption(
    new Option('--sort-order <order>', 'Sort order (asc, desc)').choices([
      'asc',
      'desc',
    ]),
  )
  .option(
    '--checksums-when-required',
    'Use checksums when required (can be useful if your copy fails with a `XAmzContentSHA256Mismatch` error)',
  )
  .action(
    ({
      srcBucketName,
      destBucketName,
      stateFile,
      concurrency,
      chunkSizeBytes,
      sortBy,
      sortOrder,
      checksumsWhenRequired,
    }) =>
      copyObjects(
        srcBucketName,
        destBucketName,
        stateFile,
        Number.parseInt(concurrency),
        Number.parseInt(chunkSizeBytes),
        sortBy,
        sortOrder,
        checksumsWhenRequired,
      ),
  )

program.version(pkg.version).parse(process.argv)
