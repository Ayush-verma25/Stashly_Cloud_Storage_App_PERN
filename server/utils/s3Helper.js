import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET_NAME, client } from "../config/s3.js";

export const uploadToStorage = async (fileBuffer, key, mimeType) => {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    }),
  );
  return { s3Key: key };
};

export const getSignedFileURL = async (key) => {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return getSignedUrl(client, command, { expiresIn: 36000 });
};

export const deleteFromStorage = async (key) => {
  if (!key) return;

  const objects = [];
  let keyMarker;
  let versionIdMarker;
  let isTruncated;

  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: BUCKET_NAME,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );

    objects.push(
      ...[...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
        .filter((object) => object.Key === key)
        .map(({ Key, VersionId }) => ({ Key, VersionId })),
    );
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
    isTruncated = page.IsTruncated;
  } while (isTruncated);

  if (!objects.length) {
    await client.send(
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    );
    return;
  }

  for (let index = 0; index < objects.length; index += 1000) {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: objects.slice(index, index + 1000), Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(`Failed to delete ${result.Errors.length} object version(s).`);
    }
  }
};

export const deleteMultipleFromStorage = async (keys) => {
  if (!keys?.length) return;
  await Promise.all(keys.map(deleteFromStorage));
};
