import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../config/db.js") {
      return {
        url: "data:text/javascript,export const sql = (...args) => globalThis.shareTestSql(...args)",
        shortCircuit: true,
      };
    }
    if (specifier === "../utils/s3Helper.js") {
      return {
        url: "data:text/javascript,export const getSignedFileURL=async%20key%3D%3E'signed%3A'%2Bkey",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  accessShareLink,
  createShareLink,
  getUserShareLink,
} = await import("../controllers/shareControllers.js");

function response() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("share creation rejects unsupported permissions and invalid expiry before database access", async () => {
  globalThis.shareTestSql = () => {
    assert.fail("Invalid share request must not query the database.");
  };
  const base = {
    resource_type: "file",
    resource_id: "8aa5a5e0-1c70-4e31-b75b-00d39dc5a21a",
  };

  const permissionResponse = response();
  await createShareLink({ body: { ...base, permission: "edit" } }, permissionResponse);
  assert.equal(permissionResponse.statusCode, 400);

  const expiryResponse = response();
  await createShareLink(
    { body: { ...base, expires_at: "not-a-date" } },
    expiryResponse,
  );
  assert.equal(expiryResponse.statusCode, 400);
});

test("existing share links include the token needed to display the URL", async () => {
  globalThis.shareTestSql = async (strings) => {
    const query = strings.join("?");
    if (query.startsWith("SELECT id FROM files")) return [{ id: "file-id" }];
    if (query.startsWith("SELECT id, token, expires_at")) {
      return [{ id: "share-id", token: "stable-share-token", expires_at: null }];
    }
    assert.fail(`Unexpected query: ${query}`);
  };

  const res = response();
  await createShareLink(
    {
      body: {
        resource_type: "file",
        resource_id: "8aa5a5e0-1c70-4e31-b75b-00d39dc5a21a",
      },
      user: { id: "owner-id" },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.share_link.token, "stable-share-token");
  assert.equal(res.body.is_existing, true);
});

test("shared links resolve file and folder resources with the schema column names", async () => {
  let query;
  const links = [{ id: "share-id", resource: { id: "file-id", name: "notes.txt" } }];
  globalThis.shareTestSql = async (strings, ...values) => {
    query = strings.join("?");
    assert.deepEqual(values, ["owner-id"]);
    return links;
  };

  const res = response();

  await getUserShareLink({ user: { id: "owner-id" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { share_links: links });
  assert.match(query, /f\.id = sl\.resource_id/);
  assert.match(query, /sl\.resource_type = 'folder'/);
  assert.doesNotMatch(query, /resouece_id/);
});

test("folder share access can browse descendants without exposing storage keys", async () => {
  const rootId = "8aa5a5e0-1c70-4e31-b75b-00d39dc5a21a";
  const childId = "8bb5a5e0-1c70-4e31-b75b-00d39dc5a21b";
  const queries = [];
  globalThis.shareTestSql = async (strings) => {
    const query = strings.join("?").trimStart();
    queries.push(query);
    if (query.startsWith("SELECT * FROM share_links")) {
      return [{
        id: "share-id",
        resource_type: "folder",
        resource_id: rootId,
        owner_id: "owner-id",
        permission: "download",
        expires_at: null,
      }];
    }
    if (query.startsWith("SELECT name FROM users")) return [{ name: "Owner" }];
    if (query.startsWith("SELECT id, name, parent_id, path, created_at FROM folders")) {
      return [{
        id: childId,
        name: "Nested",
        parent_id: rootId,
        path: [rootId],
        created_at: "2026-01-01T00:00:00.000Z",
      }];
    }
    if (query.startsWith("SELECT id, name, parent_id, created_at FROM folders")) {
      return [{ id: "nested-child", name: "Subfolder", parent_id: childId }];
    }
    if (query.startsWith("SELECT id, name, mime_type, size, s3_key FROM files")) {
      return [{
        id: "file-id",
        name: "notes.txt",
        mime_type: "text/plain",
        size: 12,
        s3_key: "private/storage/key",
      }];
    }
    if (query.startsWith("SELECT id, name FROM folders")) {
      return [{ id: rootId, name: "Shared root" }];
    }
    if (query.startsWith("UPDATE share_links")) return [];
    assert.fail(`Unexpected query: ${query}`);
  };

  const res = response();
  await accessShareLink(
    { params: { token: "share-token" }, query: { folder_id: childId } },
    res,
    assert.fail,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.folder.id, childId);
  assert.equal(res.body.root_folder_id, rootId);
  assert.deepEqual(res.body.breadcrumbs, [
    { id: rootId, name: "Shared root" },
    { id: childId, name: "Nested" },
  ]);
  assert.equal(res.body.subfolder[0].name, "Subfolder");
  assert.equal(res.body.files[0].url, "signed:private/storage/key");
  assert.equal(res.body.files[0].s3_key, undefined);
  assert.ok(queries[2].includes("= ANY(path)"));
});
