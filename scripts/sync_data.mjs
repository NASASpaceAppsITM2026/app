#!/usr/bin/env node
/**
 * Sync the app repository against a pinned pipeline data release.
 *
 * Implements the sync-and-verify behavior from docs/data-contracts.md §6:
 * reads data.lock.json, resolves the pinned release artifacts, verifies
 * SHA-256 checksums (and byte sizes), and fails loudly on any mismatch.
 *
 * Bootstrap milestone: the pinned release is synthetic and the artifacts are
 * small synthetic files under tests/fixtures/synthetic/.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const lockPath = new URL("../data.lock.json", import.meta.url);
const lock = JSON.parse(await readFile(lockPath, "utf8"));

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

let failed = false;
for (const artifact of lock.artifacts ?? []) {
  const artifactPath = new URL(`../tests/fixtures/synthetic/${artifact.fileName}`, import.meta.url);
  try {
    const buffer = await readFile(artifactPath);
    const actualSha256 = sha256Hex(buffer);
    const actualBytes = buffer.byteLength;
    if (actualSha256 !== artifact.sha256 || actualBytes !== artifact.bytes) {
      failed = true;
      console.error(
        `checksum mismatch for artifact ${artifact.artifact}: expected ${artifact.sha256}/${artifact.bytes}, got ${actualSha256}/${actualBytes}`,
      );
    } else {
      console.log(`ok ${artifact.artifact} ${artifact.sha256}`);
    }
  } catch (error) {
    failed = true;
    console.error(`failed to read artifact ${artifact.artifact}: ${error.message}`);
  }
}

if (failed) {
  console.error("data sync failed; aborting (fail loudly on checksum mismatch)");
  process.exit(1);
}

console.log(`data sync ok for release ${lock.releaseVersion}`);
