import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import express from "express";
import { test } from "node:test";
import { errorHandler } from "../middlewares/errorHandler.js";

process.env.MAX_FILE_SIZE = "1024";
const { withUpload } = await import("../middlewares/upload.js");

test("multipart uploads use disk and release their temporary files", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "stashly-upload-test-"));
  const originalTemp = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  t.after(async () => {
    if (originalTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTemp;
    await rm(temp, { recursive: true, force: true });
  });

  const app = express();
  app.post("/", withUpload(async (req, res) => {
    const [staged] = req.files;
    assert.equal(staged.buffer, undefined);
    assert.equal(staged.size, 5);
    assert.equal(await readFile(staged.path, "utf8"), "hello");
    assert.equal(req.body.folder_id, "root");
    res.sendStatus(req.query.reject ? 400 : 201);
  }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const post = (body, query = "") => {
    const form = new FormData();
    form.set("folder_id", "root");
    form.set("files", new Blob([body]), "test.txt");
    return fetch(url + query, { method: "POST", body: form });
  };
  for (const [query, status] of [["", 201], ["?reject=1", 400]]) {
    const response = await post("hello", query);
    assert.equal(response.status, status);
    await response.text();
    await t.waitFor(async () => assert.deepEqual(await readdir(temp), []));
  }

  const overLimit = await post("a".repeat(1025));
  assert.equal(overLimit.status, 413);
  await overLimit.text();
  await t.waitFor(async () => assert.deepEqual(await readdir(temp), []));

  // Hold four partial bodies open so the next batch must be declined.
  const partials = Array.from({ length: 4 }, () => {
    const req = request(url, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=test" },
    });
    req.on("error", () => {});
    req.write('--test\r\nContent-Disposition: form-data; name="files"; filename="test.txt"\r\n\r\nhello');
    return req;
  });
  t.after(() => partials.forEach((req) => req.destroy()));
  await t.waitFor(async () => assert.equal((await readdir(temp)).length, 4));
  const busy = await post("hello");
  assert.equal(busy.status, 503);
  assert.ok(busy.headers.get("Retry-After"));
  await busy.text();
  partials.forEach((req) => req.destroy());
  await t.waitFor(async () => assert.deepEqual(await readdir(temp), []));
});
