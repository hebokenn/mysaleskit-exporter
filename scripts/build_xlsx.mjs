import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const cwd = process.cwd();
const inputPath = path.join(cwd, "work", "mysaleskit_on_raw.json");
const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const rows = raw.payload.list;

const excludedPosts = new Set(["培训经理", "培训师"]);
const excludedNames = new Set(
  String(process.env.MYSK_EXCLUDED_NAMES || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const keptStudyStatuses = new Set(["未登录", "学习中"]);

const formatDuration = (seconds) => {
  if (!seconds) return "-";
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? "<1分钟" : `${minutes}分钟`;
};

const formatWorkStatus = (status) => {
  if (String(status).toUpperCase() === "ON") return "在职";
  if (String(status).toUpperCase() === "QUIT") return "离职";
  return status ?? "";
};

const finalRows = rows.filter((row) => {
  return (
    !excludedPosts.has(row.mainPost) &&
    !excludedNames.has(row.name) &&
    keptStudyStatuses.has(row.studyStatus) &&
    String(row.workStatus).toUpperCase() === "ON"
  );
});

const headers = [
  "姓名",
  "用户ID",
  "岗位",
  "在职状态",
  "手机号",
  "渠道",
  "经销商",
  "经销商ID",
  "店铺名称",
  "店铺ID",
  "特殊学员",
  "学习状态",
  "累计学习时长",
  "已完成课程",
  "累计登录次数",
  "最近登录时间",
];

const values = finalRows.map((row) => [
  row.name ?? "",
  row.bizId ? String(row.bizId) : "-",
  row.mainPost ?? "",
  formatWorkStatus(row.workStatus),
  row.mobile ? String(row.mobile) : "",
  row.channelName ?? "",
  row.resellerName ?? "",
  row.resellerCode ? String(row.resellerCode) : "",
  row.storeName ?? "",
  row.storeCode ? String(row.storeCode) : "",
  row.speciaStaffStr ?? "",
  row.studyStatus ?? "",
  formatDuration(row.studyTotalTime),
  `${row.finishTrainingCount ?? 0}/${row.allTrainingCount ?? 0}`,
  row.loginCount ?? "-",
  row.lastLoginDate ?? "-",
]);

const counts = finalRows.reduce(
  (acc, row) => {
    acc.byStudy[row.studyStatus] = (acc.byStudy[row.studyStatus] || 0) + 1;
    acc.byPost[row.mainPost] = (acc.byPost[row.mainPost] || 0) + 1;
    return acc;
  },
  { byStudy: {}, byPost: {} },
);

const nowParts = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
  .formatToParts(new Date())
  .reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

const updatedAt = `${nowParts.year}-${nowParts.month}-${nowParts.day} ${nowParts.hour}:${nowParts.minute}:${nowParts.second} 北京时间`;
const outputPath = path.join(cwd, "mysaleskit 最新数据.xlsx");

const workbook = new ExcelJS.Workbook();
workbook.creator = "mysaleskit-exporter";
workbook.created = new Date();

const sheet = workbook.addWorksheet("mysaleskit最新数据", {
  properties: { showGridLines: false },
});

// Column widths
const colWidths = [12, 34, 12, 12, 16, 10, 34, 14, 36, 14, 12, 12, 14, 14, 14, 20];
colWidths.forEach((width, i) => {
  sheet.getColumn(i + 1).width = width;
});

// Row 1: Title (merged A1:P1)
sheet.mergeCells("A1:P1");
const titleCell = sheet.getCell("A1");
titleCell.value = "mysaleskit 最新数据";
titleCell.font = { bold: true, size: 16, color: { argb: "FF1F2937" } };
titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
titleCell.alignment = { vertical: "middle", horizontal: "left" };
sheet.getRow(1).height = 28;

// Row 2: Subtitle (merged A2:P2)
sheet.mergeCells("A2:P2");
const subCell = sheet.getCell("A2");
subCell.value = `来源：MySalesKit 在职人员 ${rows.length} 条；筛选后 ${finalRows.length} 条。更新时间：${updatedAt}`;
subCell.font = { color: { argb: "FF475569" }, size: 11 };
subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
subCell.alignment = { vertical: "middle", horizontal: "left" };
sheet.getRow(2).height = 22;

// Row 4-6: Filter criteria table (A4:D6)
sheet.getCell("A4").value = "筛选项";
sheet.getCell("B4").value = "规则";
sheet.getCell("C4").value = "结果";
sheet.getCell("D4").value = "数量";

const filterHeader = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const filterHeaderFont = { bold: true, color: { argb: "FFFFFFFF" } };
for (let c = 1; c <= 4; c++) {
  const cell = sheet.getCell(4, c);
  cell.fill = filterHeader;
  cell.font = filterHeaderFont;
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

sheet.getCell("A5").value = "在职状态";
sheet.getCell("B5").value = "只保留在职";
sheet.getCell("C5").value = "在职";
sheet.getCell("D5").value = finalRows.length;

sheet.getCell("A6").value = "学习状态";
sheet.getCell("B6").value = "只保留未登录、学习中";
sheet.getCell("C6").value = Object.entries(counts.byStudy)
  .map(([k, v]) => `${k} ${v}`)
  .join("；");
sheet.getCell("D6").value = finalRows.length;

// Apply borders to filter criteria area
const filterAreaBorders = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
};
for (let r = 4; r <= 6; r++) {
  for (let c = 1; c <= 4; c++) {
    sheet.getCell(r, c).border = filterAreaBorders;
  }
}

// Data table
const tableStartRow = 8; // 1-indexed Excel row for data start
const headerRowNumber = tableStartRow;
const firstDataRowNumber = tableStartRow + 1;
const lastDataRowNumber = tableStartRow + values.length;
const numCols = headers.length;

// Write headers in row 8
const headerRow = sheet.getRow(headerRowNumber);
headers.forEach((h, i) => {
  headerRow.getCell(i + 1).value = h;
});
headerRow.height = 22;

// Style header row
const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
for (let c = 1; c <= numCols; c++) {
  const cell = sheet.getCell(headerRowNumber, c);
  cell.fill = headerFill;
  cell.font = headerFont;
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

// Write data rows starting from row 9
if (values.length > 0) {
  values.forEach((rowValues, i) => {
    const row = sheet.getRow(firstDataRowNumber + i);
    rowValues.forEach((v, j) => {
      row.getCell(j + 1).value = v;
    });
    row.height = 20;
  });
}

// Style data cells
const dataFont = { color: { argb: "FF111827" }, size: 10 };
const dataBorder = {
  top: { style: "thin", color: { argb: "FFD7DEE8" } },
  left: { style: "thin", color: { argb: "FFD7DEE8" } },
  bottom: { style: "thin", color: { argb: "FFD7DEE8" } },
  right: { style: "thin", color: { argb: "FFD7DEE8" } },
};
const lastTableRow = Math.max(lastDataRowNumber, headerRowNumber);
for (let r = headerRowNumber; r <= lastTableRow; r++) {
  for (let c = 1; c <= numCols; c++) {
    const cell = sheet.getCell(r, c);
    if (r >= firstDataRowNumber) {
      cell.font = dataFont;
    }
    cell.border = dataBorder;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  }
}

// Text format for ID columns (B=2, E=5, H=8, J=10) - only on data rows
const textColumns = [2, 5, 8, 10];
if (values.length > 0) {
  for (const col of textColumns) {
    for (let r = firstDataRowNumber; r <= lastDataRowNumber; r++) {
      sheet.getCell(r, col).numFmt = "@";
    }
  }
}

// Freeze rows 1-7 (header + filter area)
sheet.views = [{ state: "frozen", ySplit: tableStartRow - 1 }];

// Add table
if (values.length > 0) {
  sheet.addTable({
    name: "MysaleskitLatestData",
    ref: `A${headerRowNumber}`,
    headerRow: true,
    columns: headers.map((h) => ({ name: h, filterButton: true })),
    rows: values,
  });
}

// Write xlsx file
await fs.rm(outputPath, { force: true });
await workbook.xlsx.writeFile(outputPath);

// Write audit JSON
const audit = {
  sourceTotal: rows.length,
  finalTotal: finalRows.length,
  excludedPosts: [...excludedPosts],
  excludedNames: [...excludedNames],
  keptStudyStatuses: [...keptStudyStatuses],
  byStudy: counts.byStudy,
  byPost: counts.byPost,
  updatedAt,
  outputPath,
};
await fs.writeFile(
  path.join(cwd, "work", "mysaleskit_audit.json"),
  JSON.stringify(audit, null, 2),
  "utf8",
);
console.log(JSON.stringify(audit, null, 2));
