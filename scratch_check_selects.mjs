import fs from "fs";

const html = fs.readFileSync("masterfile/sales.html", "utf8");
const lines = html.split("\n");
lines.forEach((l, i) => {
  if (l.includes("sale_payment_method_id") || l.includes("ar_customer_id")) {
    console.log((i+1) + ": " + l);
  }
});

