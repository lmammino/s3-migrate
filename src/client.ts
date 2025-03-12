import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'

function getCredentialsForPrefix(envPrefix: string) {
  const prefixes = [envPrefix, '']
  for (const prefix of prefixes) {
    if (
      process.env[`${prefix}AWS_ACCESS_KEY_ID`] &&
      process.env[`${prefix}AWS_SECRET_ACCESS_KEY`]
    ) {
      return {
        accessKeyId: process.env[`${prefix}AWS_ACCESS_KEY_ID`] as string,
        secretAccessKey: process.env[
          `${prefix}AWS_SECRET_ACCESS_KEY`
        ] as string,
        sessionToken: process.env[`${prefix}AWS_SESSION_TOKEN`],
      }
    }
  }

  return undefined
}

export function createS3Client(
  envPrefix: string,
  checksums: 'WHEN_REQUIRED' | 'WHEN_SUPPORTED' = 'WHEN_SUPPORTED',
): S3Client {
  const config: S3ClientConfig = {
    region:
      process.env[`${envPrefix}AWS_REGION`] ||
      process.env.AWS_REGION ||
      process.env.DEFAULT_AWS_REGION,
    endpoint: process.env[`${envPrefix}ENDPOINT`] || process.env.ENDPOINT,
    requestChecksumCalculation: checksums,
    responseChecksumValidation: checksums,
  }
  const credentials = getCredentialsForPrefix(envPrefix)
  if (credentials) {
    config.credentials = credentials
  }

  return new S3Client(config)
}
