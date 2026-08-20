const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const keystoreFile = process.env.KEYSTORE_FILE;
const keystorePassword = process.env.KEYSTORE_PASSWORD;
const keyAlias = process.env.KEY_ALIAS || "key0";
const keyPassword = process.env.KEY_PASSWORD || keystorePassword;

if (!keystoreFile || !keystorePassword) {
  console.log("No KEYSTORE_FILE/KEYSTORE_PASSWORD in .env, skipping keystore.properties generation.");
  process.exit(0);
}

const outputPath = path.resolve(__dirname, "../src-tauri/gen/android/keystore.properties");
const outputDir = path.dirname(outputPath);

if (!fs.existsSync(outputDir)) {
  console.log("Android project not initialized yet, skipping.");
  process.exit(0);
}

const content = `storeFile=${keystoreFile.replace(/\\/g, "/")}
storePassword=${keystorePassword}
keyAlias=${keyAlias}
keyPassword=${keyPassword}
`;

fs.writeFileSync(outputPath, content, "utf-8");
console.log(`Generated keystore.properties at ${outputPath}`);
