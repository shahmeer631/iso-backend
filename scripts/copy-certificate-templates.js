/**
 * Cross-platform copy of Certificate HTML templates into dist/.
 * Used by npm run build after tsc.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(
  __dirname,
  "..",
  "src",
  "app",
  "modules",
  "Certificate",
  "templates",
);
const dest = path.join(
  __dirname,
  "..",
  "dist",
  "app",
  "modules",
  "Certificate",
  "templates",
);

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

if (!fs.existsSync(src)) {
  console.error("Certificate templates source missing:", src);
  process.exit(1);
}

copyRecursive(src, dest);
console.log("Copied Certificate templates to", dest);
