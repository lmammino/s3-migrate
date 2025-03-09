import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { Command } from "commander";
import cliProgress from "cli-progress";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import prettyBytes from "pretty-bytes";

dotenv.config();
const program = new Command();
let db: any;
let isShuttingDown = false;

async function openDatabase(stateFile: string) {
    return open({
        filename: stateFile,
        driver: sqlite3.Database
    });
}

function createS3Client(prefix: string) {
    return new S3Client({
        region: process.env[`${prefix}_AWS_REGION`] || "us-east-1",
        endpoint: process.env[`${prefix}_ENDPOINT`],
        credentials: {
            accessKeyId: process.env[`${prefix}_AWS_ACCESS_KEY_ID`]!,
            secretAccessKey: process.env[`${prefix}_AWS_SECRET_ACCESS_KEY`]!
        }
    });
}

async function catalogObjects(bucketName: string, stateFile: string) {
    const client = createS3Client("SRC");
    db = await openDatabase(stateFile);
    await db.exec("CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, size INTEGER, copied INTEGER DEFAULT 0)");
    let ContinuationToken: string | undefined;

    do {
        const command = new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken });
        const response = await client.send(command);

        if (response.Contents) {
            for (const obj of response.Contents) {
                await db.run("INSERT OR IGNORE INTO objects (key, size, copied) VALUES (?, ?, 0)", obj.Key, obj.Size);
            }
        }
        ContinuationToken = response.NextContinuationToken;
    } while (ContinuationToken);

    await db.close();
    console.log("Cataloging complete.");
}

async function copyObjects(srcBucketName: string, destBucketName: string, stateFile: string, concurrency: number) {
    db = await openDatabase(stateFile);
    const srcS3 = createS3Client("SRC");
    const destS3 = createS3Client("DEST");
    const maxConcurrency = Math.max(1, concurrency);
    console.log(`Using concurrency level: ${maxConcurrency}`);

    const { count: totalObjects } = await db.get("SELECT COUNT(*) AS count FROM objects WHERE copied = 0") || { count: 0 };
    if (totalObjects === 0) {
        console.log("All objects have been copied.");
        return;
    }

    console.log(`Copying ${totalObjects} objects...`);
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar.start(totalObjects, 0);
    let completed = 0, totalSize = 0, startTime = Date.now();

    async function copyObject(key: string, size: number) {
        if (isShuttingDown) return;
        try {
            const getCommand = new GetObjectCommand({ Bucket: srcBucketName, Key: key });
            const response = await srcS3.send(getCommand);
            const putCommand = new PutObjectCommand({ Bucket: destBucketName, Key: key, Body: response.Body });
            await destS3.send(putCommand);

            await db.run("UPDATE objects SET copied = 1 WHERE key = ?", key);
            completed++;
            totalSize += size;
            bar.update(completed);
            const elapsedTime = (Date.now() - startTime) / 1000;
            console.log(`Copied ${completed}/${totalObjects} (${prettyBytes(totalSize)}). ETA: ${Math.round(elapsedTime / completed * (totalObjects - completed))}s`);
        } catch (error) {
            console.error(`Error copying ${key}:`, error);
        }
    }

    while (!isShuttingDown) {
        const objects = await db.all("SELECT key, size FROM objects WHERE copied = 0 LIMIT ?", maxConcurrency);
        if (objects.length === 0) break;
        await Promise.all(objects.map(obj => copyObject(obj.key, obj.size)));
    }

    bar.stop();
    await db.close();
    console.log("Copy process completed.");
}

process.on("SIGINT", () => {
    console.log("Gracefully shutting down...");
    isShuttingDown = true;
});

program.command("catalog")
    .requiredOption("--src-bucket-name <name>", "Source bucket name")
    .requiredOption("--state-file <path>", "Path to SQLite state file")
    .action(({ srcBucketName, stateFile }) => catalogObjects(srcBucketName, stateFile));

program.command("copy")
    .requiredOption("--src-bucket-name <name>", "Source bucket name")
    .requiredOption("--dest-bucket-name <name>", "Destination bucket name")
    .requiredOption("--state-file <path>", "Path to SQLite state file")
    .option("--concurrency <number>", "Max concurrent copies", "8")
    .action(({ srcBucketName, destBucketName, stateFile, concurrency }) =>
        copyObjects(srcBucketName, destBucketName, stateFile, parseInt(concurrency))
    );

program.parse(process.argv);
