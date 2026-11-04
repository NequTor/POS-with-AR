import fs from "fs";

const files = ["masterfile/sales.html", "masterfile/js/sales.js", "masterfile/HOTKEY_REFERENCE_CARD.md"];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const c = fs.readFileSync(file, "utf8");
  c.split("\n").forEach((l, i) => {
    if (l.includes("Resume") || l.includes("resume sale") || l.includes("RESUME")) {
      console.log(`${file}:${i + 1}: ${l.trim()}`);
    }
  });
}

