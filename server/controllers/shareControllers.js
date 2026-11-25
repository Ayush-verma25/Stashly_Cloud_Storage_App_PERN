import { sql } from "../config/db.js";
import crypto from "crypto";
import { getSignedFileURL } from "../utils/s3Helper.js";

// Create or retrive publis shere link for file or Folder
// POST /api/shares
export const createShareLink = async (req, res, next) => {
  try {
    const body = req.body || {};
    const resourceType = body.resource_type ?? body.resourceType;
    const resourceId = body.resource_id ?? body.resourceId;
    const { permission = "download", expires_at, expiresAt } = body;

    const targetExpiresAt = expires_at ?? expiresAt;

    if (!["file", "folder"].includes(resourceType)) {
      return res
        .status(400)
        .json({ error: "Resource type must be file or folder!" });
    }
    if (permission !== "download") {
      return res.status(400).json({ error: "Permission must be download." });
    }
    if (
      typeof resourceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        resourceId,
      )
    ) {
      return res.status(400).json({ error: "A valid resource ID is required." });
    }

    let expiresAtDate = null;
    if (targetExpiresAt != null && targetExpiresAt !== "") {
      expiresAtDate = new Date(targetExpiresAt);
      if (!Number.isFinite(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
        return res.status(400).json({ error: "Expiration must be a future date." });
      }
    }

    // verify resoueces exists and belongs to user
    const [resource] =
      resourceType === "file"
        ? await sql`SELECT id FROM files WHERE id = ${resourceId} AND owner_id = ${req.user.id} AND is_trashed = false`
        : await sql`
        SELECT id FROM folders WHERE id = ${resourceId} AND owner_id = ${req.user.id} AND is_trashed = false`;

    if (!resource) {
      return res.status(404).json({ error: `${resourceType} not Found!` });
    }

    // Check for an existing shared link for this resource
    const [existing] =
      await sql`SELECT id, token, expires_at FROM share_links WHERE resource_type = ${resourceType} AND resource_id = ${resourceId} AND owner_id = ${req.user.id}`;

    // if expired, remove it.
    if (
      existing &&
      existing.expires_at &&
      new Date() > new Date(existing.expires_at)
    ) {
      await sql`DELETE FROM share_links WHERE id = ${existing.id}`;
    } else if (existing) {
      return res.status(200).json({ share_link: existing, is_existing: true });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const [shareLink] =
      await sql`INSERT INTO share_links (token, resource_type, resource_id, owner_id, permission, expires_at) VALUES (${token}, ${resourceType}, ${resourceId}, ${req.user.id}, ${permission}, ${expiresAtDate}) RETURNING *`;
    return res.status(200).json({ share_link: shareLink, is_existing: false });
  } catch (error) {
    return next(error);
  }
};

// Get user's shere links with single-query resource resolution
// GEt /api/shares
export const getUserShareLink = async (req, res, next) => {
  try {
    const activeShareLinks = await sql`
      SELECT sl.*,
        CASE
          WHEN sl.resource_type = 'file' THEN
            json_build_object('id', f.id, 'name', f.name, 'mime_type', f.mime_type, 'size', f.size)
          WHEN sl.resource_type = 'folder' THEN
            json_build_object('id', fo.id, 'name', fo.name)
        END AS resource
      FROM share_links sl
      LEFT JOIN files f
        ON sl.resource_type = 'file'
        AND f.id = sl.resource_id
        AND f.is_trashed = false
      LEFT JOIN folders pf ON f.folder_id = pf.id
      LEFT JOIN folders fo
        ON sl.resource_type = 'folder'
        AND fo.id = sl.resource_id
        AND fo.is_trashed = false
      WHERE sl.owner_id = ${req.user.id}
        AND (
          (sl.resource_type = 'file' AND f.id IS NOT NULL
            AND (f.folder_id IS NULL OR pf.is_trashed = false))
          OR (sl.resource_type = 'folder' AND fo.id IS NOT NULL)
        )
      ORDER BY sl.created_at DESC`;

    return res.status(200).json({ share_links: activeShareLinks });
  } catch (error) {
    return next(error);
  }
};

// Access shared items by token (public link for anyone)
// Get /api/shares/access/:token
export const accessShareLink = async (req, res, next) => {
  try {
    const { token } = req.params;

    const [shareLink] =
      await sql`SELECT * FROM share_links WHERE token = ${token}`;

    if (!shareLink) {
      return res
        .status(404)
        .json({ error: "Share link not found or has been revoked!" });
    }

    // check expiration
    if (shareLink.expires_at && new Date() > new Date(shareLink.expires_at)) {
      return res.status(410).json({ error: "This share link has expired!" });
    }

    // Fetch owner info
    const [owner] =
      await sql`SELECT name FROM users WHERE id = ${shareLink.owner_id}`;

    if (shareLink.resource_type === "file") {
      const [file] =
        await sql`SELECT id, name, mime_type, size, created_at, folder_id, s3_key FROM files WHERE id = ${shareLink.resource_id} AND is_trashed = false`;
      if (!file || file.is_trashed) {
        return res.status(404).json({ error: "File is no longer available!" });
      }

      if (file.folder_id) {
        const [parentFolder] =
          await sql`SELECT is_trashed FROM folders WHERE id = ${file.folder_id}`;
        if (!parentFolder || parentFolder.is_trashed) {
          return res
            .status(404)
            .json({ error: "File is no longer available!" });
        }
      }

      const downloadUrl = await getSignedFileURL(file.s3_key);
      await sql`UPDATE share_links SET access_count = access_count + 1 WHERE id = ${shareLink.id}`;
      const publicFile = {
        id: file.id,
        name: file.name,
        mime_type: file.mime_type,
        size: file.size,
        created_at: file.created_at,
      };
      return res.status(200).json({
        resource_type: "file",
        file: publicFile,
        url: downloadUrl,
        permission: shareLink.permission,
        owner,
      });
    }

    // Folder resource
    const requestedFolderId = req.query?.folder_id || shareLink.resource_id;
    const [folder] = await sql`
      SELECT id, name, parent_id, path, created_at FROM folders
      WHERE id = ${requestedFolderId} AND owner_id = ${shareLink.owner_id}
        AND is_trashed = false
        AND (id = ${shareLink.resource_id} OR ${shareLink.resource_id} = ANY(path))`;
    if (!folder || folder.is_trashed) {
      return res.status(404).json({ error: "Folder is not available in this share." });
    }

    const [subfolder, files, breadcrumbFolders] = await Promise.all([
      sql`SELECT id, name, parent_id, created_at FROM folders
          WHERE parent_id = ${folder.id} AND owner_id = ${shareLink.owner_id}
            AND is_trashed = false ORDER BY name ASC`,
      sql`SELECT id, name, mime_type, size, s3_key FROM files
          WHERE folder_id = ${folder.id} AND owner_id = ${shareLink.owner_id}
            AND is_trashed = false ORDER BY name ASC`,
      sql`SELECT id, name FROM folders
          WHERE id = ANY(${folder.path || []}::uuid[]) AND owner_id = ${shareLink.owner_id}`,
    ]);
    const rootIndex = (folder.path || []).indexOf(shareLink.resource_id);
    const breadcrumbIds =
      folder.id === shareLink.resource_id
        ? [folder.id]
        : [...folder.path.slice(rootIndex), folder.id];
    const breadcrumbNames = new Map(
      [...breadcrumbFolders, folder].map((entry) => [entry.id, entry.name]),
    );
    const breadcrumbs = breadcrumbIds.map((id) => ({
      id,
      name: breadcrumbNames.get(id) || "",
    }));

    const filesWithUrls = await Promise.all(
      files.map(async ({ s3_key: key, ...file }) => ({
        ...file,
        url: await getSignedFileURL(key),
      })),
    );

    await sql`UPDATE share_links SET access_count = access_count + 1 WHERE id = ${shareLink.id}`;
    return res.status(200).json({
      resource_type: "folder",
      folder: {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        created_at: folder.created_at,
      },
      root_folder_id: shareLink.resource_id,
      breadcrumbs,
      subfolder,
      files: filesWithUrls,
      permission: shareLink.permission,
      owner,
    });
  } catch (error) {
    return next(error);
  }
};

// Revoke/delete share Link
// DELETE /api/shares/:id
export const deleteShareLink = async (req, res, next) => {
  try {
    const [shareLink] =
      await sql`DELETE FROM share_links WHERE id = ${req.params.id} AND owner_id = ${req.user.id} RETURNING id`;

    if (!shareLink) {
      return res.status(404).json({ error: "Share link not Found!" });
    }

    return res
      .status(200)
      .json({ message: "Share link revoked Successfully." });
  } catch (error) {
    return next(error);
  }
};
