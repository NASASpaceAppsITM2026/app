const fs = require("fs");
const base = "D:/Projects/NASA2026/app/packages/";
for (const dir of ["core", "web"]) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + "/" + e.name;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
        const t = fs.readFileSync(p, "utf8");
        if (/LunarSite/.test(t)) console.log(p);
      }
    }
  };
  walk(base + dir + "/src");
}
