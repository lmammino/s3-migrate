# s3-migrate
A CLI to help you move all your objects between s3-compatible storage systems


# S3 Migrator CLI

A command-line tool to migrate objects from one S3-compatible storage bucket to another. Supports resuming interrupted transfers using a SQLite state file.

## Features
- Supports different AWS accounts, regions, and even S3-compatible services
- Uses Node.js streams for efficient transfers
- Allows stopping and resuming with a local SQLite database
- Graceful shutdown on Ctrl+C
- Configurable concurrency level for optimized performance

## Installation

Ensure you have Node.js installed, then install dependencies:
```sh
npm install
```

## Usage

Set the environment variables for source and destination credentials:
```sh
export SRC_AWS_ACCESS_KEY_ID=your-source-key
export SRC_AWS_SECRET_ACCESS_KEY=your-source-secret
export SRC_AWS_REGION=your-source-region
export DEST_AWS_ACCESS_KEY_ID=your-dest-key
export DEST_AWS_SECRET_ACCESS_KEY=your-dest-secret
export DEST_AWS_REGION=your-dest-region
```

### Step 1: Catalog Objects
```sh
node dist/index.js catalog --src-bucket-name my-source-bucket --state-file migration.db
```
This command fetches the list of objects and stores them in `migration.db`.

### Step 2: Copy Objects
```sh
node dist/index.js copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db --concurrency 5
```
This command transfers uncopied objects with up to 5 concurrent copies at a time.

### Graceful Shutdown
Press `Ctrl+C` during the copy process to stop it safely. Running the command again will resume from where it left off.

## License
MIT

