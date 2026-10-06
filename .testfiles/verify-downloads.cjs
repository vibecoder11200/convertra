// Deep content verification of the downloaded conversion results.
const fs = require("fs");
const path = require("path");
const { unzipSync } = require("fflate");
const XLSX = require("xlsx");

const dir = path.join(__dirname, "e2e", "out");
const read = (n) => fs.readFileSync(path.join(dir, n));
const results = {};

// 1) doc.docx — pandoc output: document.xml should contain the PDF text
const docx = unzipSync(read("Convertra_doc.docx"));
const docXml = Buffer.from(docx["word/document.xml"]).toString("utf8");
results["doc.docx"] = {
  hasWordXml: docx["word/document.xml"] !== undefined,
  quarterly: docXml.includes("Quarterly Report"),
  bullets: docXml.includes("First bullet point"),
  nextSteps: docXml.includes("Next Steps"),
};

// 2) notes.pptx — pandoc pptx: slide xml should contain the md headings
const pptx = unzipSync(read("Convertra_notes.pptx"));
const slideFiles = Object.keys(pptx).filter((k) => k.startsWith("ppt/slides/slide"));
let talkTitle = false;
let pointOne = false;
for (const f of slideFiles) {
  const xml = Buffer.from(pptx[f]).toString("utf8");
  if (xml.includes("Talk Title")) talkTitle = true;
  if (xml.includes("Point One")) pointOne = true;
}
results["notes.pptx"] = {
  slideXmlCount: slideFiles.filter((f) => f.endsWith(".xml")).length,
  talkTitle,
  pointOne,
};

// 3) book.zip — multi-sheet xlsx -> zip of per-sheet csvs
const book = unzipSync(read("Convertra_book.zip"));
results["book.zip"] = {
  entries: Object.keys(book),
  fruits: Buffer.from(book["Fruits.csv"] || Buffer.alloc(0)).toString("utf8").trim(),
};

// 4) sheet.xlsx — round-trip parse
const wb = XLSX.read(read("Convertra_sheet.xlsx"));
results["sheet.xlsx"] = {
  sheets: wb.SheetNames,
  csv: XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]).trim(),
};

// 5) sample.pdf — epub rendered: valid pdf, 2 pages, no text layer (raster)
const sample = read("Convertra_sample.pdf");
const sampleTxt = sample.toString("latin1");
results["sample.pdf"] = {
  pages: (sampleTxt.match(/\/Type\s*\/Page[^s]/g) || []).length,
  hasEOF: sampleTxt.includes("%%EOF"),
  sizeKB: Math.round(sample.length / 102.4) / 10,
};

// 6) test.pdf — jpg -> pdf: one page, 96dpi-normalized media box
const test = read("Convertra_test.pdf");
const boxes = test.toString("latin1").match(/MediaBox\s*\[[^\]]+\]/g);
results["test.pdf"] = {
  mediaBox: boxes ? boxes[0] : null,
  hasDCT: test.toString("latin1").includes("/DCTDecode"),
  sizeKB: Math.round(test.length / 102.4) / 10,
};

console.log(JSON.stringify(results, null, 1));
