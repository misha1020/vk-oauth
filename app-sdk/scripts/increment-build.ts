import * as fs from "fs";
import * as path from "path";

const filePath = path.join(__dirname, "..", "build-version.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
data.build += 1;
fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
console.log(`Build version incremented to v${data.build}`);
