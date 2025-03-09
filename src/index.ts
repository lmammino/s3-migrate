#! /usr/bin/env node

// @ts-ignore
import { compose } from 'node:stream'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { ProgressBar } from '@opentf/cli-pbar'
import { Command } from 'commander'
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
    'CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, size INTEGER, copied INTEGER DEFAULT 0)',
  )
  let ContinuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken,
      Prefix: prefix,
    })
    const response = await client.send(command)

    if (response.Contents) {
      for (const obj of response.Contents) {
        await db.run(
          'INSERT OR IGNORE INTO objects (key, size, copied) VALUES (?, ?, 0)',
          obj.Key,
          obj.Size,
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
) {
  db = await openDatabase(stateFile)
  const srcS3 = createS3Client('SRC_')
  const destS3 = createS3Client('DEST_')
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
      'SELECT key, size FROM objects WHERE copied = 0 LIMIT ?',
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
  .action(
    ({
      srcBucketName,
      destBucketName,
      stateFile,
      concurrency,
      chunkSizeBytes,
    }) =>
      copyObjects(
        srcBucketName,
        destBucketName,
        stateFile,
        Number.parseInt(concurrency),
        Number.parseInt(chunkSizeBytes),
      ),
  )

program.version(pkg.version).parse(process.argv)
