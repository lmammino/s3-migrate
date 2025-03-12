# s3-migrate 🚀

[![build](https://github.com/lmammino/s3-migrate/actions/workflows/build.yml/badge.svg)](https://github.com/lmammino/s3-migrate/actions/workflows/build.yml)
[![npm](https://img.shields.io/npm/v/s3-migrate)](https://www.npmjs.com/package/s3-migrate)
[![release-please](https://badgen.net/static/release-please/%F0%9F%99%8F/green)](https://github.com/googleapis/release-please)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)

A command-line tool to migrate objects from one S3-compatible storage bucket to
another. Supports resuming interrupted transfers using a SQLite state file.

This tool can be useful in the following scenarios:

- You want to copy an entire bucket from an account to another, and you need two
  different set of credentials for the source and destination accounts.
- You want to migrate objects from an S3-compatible service to another, such as
  from DigitalOcean Spaces to AWS S3 or vice versa.

> [!NOTE]\
> This project is (currently) intended for a one-off migration, not to keep 2
> buckets in sync.

> [!WARNING]\
> The **experimental™️** nature of this project is to be taken very seriously.
> This is still a new project which has been tested only against a limited
> number of use cases and configuration. It might not work 100% with your
> specific configuration. Please use it with caution and report any issues you
> might find. Even better, consider opening a PR to improve it if you find any
> bug or a missing feature! 😇

## Features ✨

- Supports different AWS accounts, regions, and even S3-compatible services (it
  uses the AWS SDK under the hood but with the right configuration it should
  theoretically work with any S3-compatible service such as DigitalOcean Spaces,
  MinIO, Cloudflare R2, Backblaze B2, etc.)
- Uses Node.js streams for efficient transfers (Data is transfered directly from
  the source to the destination without buffering the entire object in memory)
- Allows stopping and resuming with a local SQLite database
- Graceful shutdown on Ctrl+C
- Configurable concurrency level and chunk size for memory / performance tuning
- Progress bar and ETA for the copy process

## Installation 📦

### Using npx, pnpm dlx, or yarn dlx

You can use the package directly without installing it globally with npm, pnpm,
or yarn:

```sh
npx s3-migrate <command> [options]
```

```sh
pnpm dlx s3-migrate <command> [options]
```

```sh
yarn dlx s3-migrate <command> [options]
```

### Installing as a global binary

If you prefer, you can also install the package globally with npm, pnpm, or
yarn:

```sh
npm install -g s3-migrate
```

```sh
pnpm add -g s3-migrate
```

```sh
yarn global add s3-migrate
```

Now you can run the `s3-migrate` command from anywhere in your terminal.

## Usage 🛠️

### STEP 0: Credential Configuration (Environment Variables) 🔐

Set the environment variables for source and destination credentials:

- `SRC_AWS_ACCESS_KEY_ID`: Your source AWS access key ID
- `SRC_AWS_SECRET_ACCESS_KEY`: Your source AWS secret access key
- `SRC_AWS_REGION`: Your source AWS region
- `SRC_AWS_SESSION_TOKEN`: (Optional) Your source AWS session token
- `DEST_AWS_ACCESS_KEY_ID`: Your destination AWS access key ID
- `DEST_AWS_SECRET_ACCESS_KEY`: Your destination AWS secret access key
- `DEST_AWS_REGION`: Your destination AWS region
- `DEST_AWS_SESSION_TOKEN`: (Optional) Your destination AWS session token
- `SRC_ENDPOINT`: (Optional) Custom endpoint for the source S3-compatible
  service
- `DEST_ENDPOINT`: (Optional) Custom endpoint for the destination S3-compatible
  service

> [!TIP]\
> All the variables prefixed with `SRC_` or `DEST_` will fallback to the
> respective variable without the prefix if not found (which means that you can
> use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` instead of
> `SRC_AWS_ACCESS_KEY_ID` and `SRC_AWS_SECRET_ACCESS_KEY` or
> `DEST_AWS_ACCESS_KEY_ID` and `DEST_AWS_SECRET_ACCESS_KEY`).

> [!TIP]\
> This project automatically loads `.env` files in the current directory. You
> can create a `.env` file with your values:
>
> ```plain
> SRC_AWS_ACCESS_KEY_ID=your-source-key
> SRC_AWS_SECRET_ACCESS_KEY=your-source-secret
> SRC_AWS_REGION=your-source-region
> DEST_AWS_ACCESS_KEY_ID=your-dest-key
> DEST_AWS_SECRET_ACCESS_KEY=your-dest-secret
> DEST_AWS_REGION=your-dest-region
> SRC_ENDPOINT=your-source-endpoint (optional)
> DEST_ENDPOINT=your-dest-endpoint (optional)
> ```

### STEP 1: Catalog Objects 📋

The first step is to catalog the objects in the source bucket:

```sh
s3-migrate catalog --src-bucket-name my-source-bucket --state-file migration.db
```

This command fetches the list of objects and stores them in a state file called
`migration.db`.

A state file is essentially a SQLite database that keeps track of the objects
that need to be copied. This file is used to resume the migration process in
case it gets interrupted. It is also used to keep track of how many bytes have
been copied so far and to give you an estimate of how much time is left.

### STEP 2: Copy Objects 📦➡️📦

Once you have cataloged the objects, you can start copying them to the
destination bucket:

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db
```

This command transfers uncopied objects and it will display a progress bar
indicating the amount of objects copied and the total number of bytes
transferred.

#### Sorting Options

You can sort the objects to be copied using the `--sort-by` and `--sort-order`
options. The `--sort-by` option accepts the following values: `key`, `size`,
`etag`, `last_modified`. The `--sort-order` option accepts `asc` or `desc`.

This allows you, for example, to prioritize files that have been modified more
recently or smaller or bigger files. In the following example we sort by
`last_modified` in descending order, to upload the most recently modified files
first:

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db --sort-by last_modified --sort-order desc
```

#### Checksum Options

You can use the `--checksums-when-required` option to initialize S3 clients with
the `checksums` options (`requestChecksumCalculation` and
`responseChecksumValidation`) set to `'WHEN_REQUIRED'`.

This can be useful if you see `XAmzContentSHA256Mismatch` errors during copy,
especially with some specific S3-compatible services (e.g. Aruba Object
Storage).

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db --checksums-when-required
```

## Graceful Shutdown 🛑

Press `Ctrl+C` during the copy process to stop it safely. Any file copy in
flight will be completed before the process exits. The state file will be
updated with the progress made so far.

> [!NOTE]\
> Depending on the size of the objects being copied, it might take a few seconds
> before the process exits. Please be patient.

Running the command again will resume from where it left off.

## Performance Tuning ⚙️

Here are some things you can do to try to improve the transfer performance in
case you are transferring a large number of objects and/or you are dealing with
large objects.

### Tweak Concurrency ⚡️

You can adjust the concurrency level to optimize the performance of the copy
process. By default, the tool uses 8 concurrent requests. You can change this by
setting the `--concurrency` option:

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db --concurrency 32
```

You can experiment with different values to find the optimal concurrency level
for your use case.

### Tweak Chunk size 🍔

You can also configure the chunk size for each request using the
`--chunk-size-bytes` option. The default value is 2MB:

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration.db --chunk-size-bytes 1048576
```

A smaller chunk size means more requests to the storage service but less memory
usage on the client side. A larger chunk size means fewer requests but more
memory usage. You can calculate an indicative memory usage by multiplying the
chunk size by the concurrency level.

### Run Multiple Concurrent processes 🖥️⚡️🖥️⚡️

You can run multiple concurrent versions of this tool, even on different
machines, by using different prefixes and a different state file for every
prefix. This allows you to parallelize the migration process and use more
networking bandwidth and CPU to speed up the migration.

Here's an example of how you might generate multiple state files using different
prefixes as in the following example:

```sh
s3-migrate catalog --src-bucket-name my-source-bucket --state-file migration-a.db --prefix "a" # in one shell / machine
s3-migrate catalog --src-bucket-name my-source-bucket --state-file migration-b.db --prefix "b" # in another shell / machine
```

Then you can

```sh
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration-a.db # in one shell / machine
s3-migrate copy --src-bucket-name my-source-bucket --dest-bucket-name my-dest-bucket --state-file migration-b.db # in another shell / machine
```

By using different prefixes and state files, you can distribute the workload
across multiple instances of the tool, potentially speeding up the migration
process. Note that you might still be subject to rate limits imposed by the
storage providers you are reading from or copying to.

Also note that finding a good set of prefixes depends on how you organised your
source data. The trick is to try to distribute the workload evenly across the
prefixes.

## Contributing 🤝

Everyone is very welcome to contribute to this project. You can contribute just
by submitting bugs or suggesting improvements by
[opening an issue on GitHub](https://github.com/lmammino/s3-migrate/issues). PRs
are also very welcome.

## License 📄

Licensed under [MIT License](LICENSE). © Luciano Mammino.
