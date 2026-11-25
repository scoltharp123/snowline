// Stamps index.html with a fingerprint of app.js (and sw.js with the same), so phones fetch the new code exactly
// when it changes and can keep a pre-compiled copy otherwise.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const js = readFileSync("public/app.js"), v = createHash("sha256").update(js).digest("hex").slice(0, 10);
for (const f of ["public/index.html", "public/sw.js"]) writeFileSync(f, readFileSync(f, "utf8").replaceAll("__APPV__", v));
console.log("stamped app.js", v);
