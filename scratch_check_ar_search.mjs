import fs from "fs";

const js = fs.readFileSync("masterfile/js/sales.js", "utf8");
const lines = js.split("\n");
lines.forEach((l, i) => {
  if (l.includes("ar-customer-search-filter") || l.includes("ar-customer-typeahead-list") || l.includes("handleArCustomerSearch")) {
    console.log((i+1) + ": " + l.trim());
  }
});

