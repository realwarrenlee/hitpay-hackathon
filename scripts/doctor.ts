import { doctorReport } from "../src/server/doctor";

const report = doctorReport();
console.log(JSON.stringify(report, null, 2));
if (report.violations.length > 0) process.exit(1);
