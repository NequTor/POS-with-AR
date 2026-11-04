import fs from "fs";

const js = fs.readFileSync("masterfile/js/sales.js", "utf8");
const lines = js.split("\n");
lines.forEach((l, i) => {
  if (l.includes("openArCustomerFlow") || l.includes('case "F8":')) {
    console.log((i+1) + ": " + l.trim());
  }
});

