// Dump all current data from Supabase for audit
// Usage: SUPABASE_SERVICE_KEY=xxx node scripts/dump-data.js
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY environment variable.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from("benchmark_scores")
    .select("*")
    .order("benchmark")
    .order("lab")
    .order("quarter");

  if (error) { console.error(error); return; }

  const nonNull = data.filter(r => r.score != null);
  console.log("Total rows:", data.length, "| Non-null scores:", nonNull.length);

  const byBench = {};
  for (const r of nonNull) {
    if (!byBench[r.benchmark]) byBench[r.benchmark] = [];
    byBench[r.benchmark].push(r);
  }

  for (const [bench, rows] of Object.entries(byBench)) {
    console.log("\n--- " + bench + " ---");
    for (const r of rows) {
      console.log(
        "  " + r.lab.padEnd(12) +
        r.quarter.padEnd(10) +
        String(r.score).padEnd(8) +
        (r.model || "").padEnd(45) +
        (r.source || "")
      );
    }
  }

  // Also dump cost_intelligence
  const { data: costData, error: costErr } = await supabase
    .from("cost_intelligence")
    .select("*")
    .order("benchmark")
    .order("quarter");

  if (costErr) { console.error(costErr); return; }

  const costNonNull = costData.filter(r => r.price != null);
  console.log("\n\n=== COST OF INTELLIGENCE ===");
  console.log("Total rows:", costData.length, "| Non-null prices:", costNonNull.length);

  for (const r of costNonNull) {
    console.log(
      "  " + r.benchmark.padEnd(12) +
      r.quarter.padEnd(10) +
      ("$" + r.price).padEnd(10) +
      (r.model || "").padEnd(40) +
      (r.lab || "").padEnd(20) +
      "score=" + r.score + " thresh=" + r.threshold
    );
  }
}

main().catch(console.error);
