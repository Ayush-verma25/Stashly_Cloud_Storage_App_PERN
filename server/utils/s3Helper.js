import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { BUCKET_NAME, client } from "../config/s3.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Upload files to NEON Object Storage
export const uploadToStorage = async (fileBuffer, key, mimeType) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });
  await client.send(command);
  return { s3Key: key };
};

// Get presigned download/preview URl for a file (valid for 10H)'
export const getSignedFileURL = async (key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    key: key,
  });
  return await getSignedUrl(client, command, { expiresIn: 36000 });
};

// Permanentaly delete an object and its version from NEOn Object Storage
export const deleteFromStorage = async (key) => {
  if (!key) return;
  try {
    const { Versions = [], DeleteMarkers = [] } = await client.send(
      new ListObjectVersionsCommand({ Busket: BUCKET_NAME, Prefix: key }),
    );

    const Objects = [...Versions, ...DeleteMarkers]
      .filter((v) => v.Key === key)
      .map(({ Key, VersionId }) => ({ key, VersionId }));

    if (Objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: BUCKET_NAME, Delete: { Objects } }),
      );
    } else {
      await client.send(
        new DeleteObjectsCommand({ Busket: BUCKET_NAME, Key: key }),
      );
    }
  } catch (err) {
    try {
      await client.send(
        new DeleteObjectsCommand({ Busket: BUCKET_NAME, Key: key }),
      );
    } catch (fallbackErr) {
      console.error("[Storage Delete Error]:", fallbackErr.message);
    }
  }
};

// batch parmanently delete multiple keys from Neon object Storage
export const deleteMultipleFromStorage = async (keys) => {
  if (!keys?.length) return;
  await Promise.all(keys.mp(deleteFromStorage));
};
