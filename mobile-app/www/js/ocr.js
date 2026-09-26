// Best-effort client-side receipt/slip scanning using Tesseract.js (loaded from CDN on demand).
// Not perfect OCR — used to pre-fill a transaction draft for the user to review and correct.
(function () {
  "use strict";

  // A stalled request (no error event, just never finishing — happens on some
  // flaky mobile connections) used to hang this forever, and a failed load
  // used to be cached permanently, breaking OCR for the rest of the app
  // session. Both are bounded/reset here so one bad attempt can't wedge
  // every future slip scan.
  let loaderPromise;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (loaderPromise) return loaderPromise;
    const load = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load the OCR engine (check your internet connection)"));
      document.head.appendChild(s);
    });
    loaderPromise = Utils.withTimeout(load, 20000, "Timed out loading the OCR engine (check your internet connection)");
    loaderPromise.catch(() => {
      loaderPromise = null; // let the next scan attempt retry from scratch
    });
    return loaderPromise;
  }

  const AMOUNT_KEYWORDS = /(จำนวนเงิน|จำนวน|amount|โอนเงิน|total|บาท|thb)/i;
  // Comma-grouped numbers ("1,173.00") first, falling back to plain digit runs
  // ("1173.00") — a plain \d{1,3}(,\d{3})* pattern silently truncates a
  // non-comma-formatted 4+ digit amount at 3 digits and treats the remainder
  // as a second, spurious token (this was the actual cause of amounts like
  // 1,173 occasionally being read as a stray "3").
  const NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;

  function extractAmount(text) {
    const lines = text.split(/\r?\n/);
    const candidates = [];
    lines.forEach((line) => {
      const nums = line.match(NUM_RE) || [];
      nums.forEach((n) => {
        const val = parseFloat(n.replace(/,/g, ""));
        if (!isNaN(val) && val > 0 && val < 10000000) {
          candidates.push({ val, keyword: AMOUNT_KEYWORDS.test(line), hasDecimal: n.includes(".") });
        }
      });
    });
    if (!candidates.length) return null;

    // Real bank-slip totals are almost always written with a ".00"-style decimal,
    // and a keyword nearby is a good but imperfect signal (a stray small number —
    // a reference digit, a masked account fragment — can also sit on a keyword
    // line). Rank by both signals together rather than trusting "has a keyword"
    // alone, which previously could pick a tiny unrelated number over the real,
    // larger total sitting a line or two away with no keyword next to it.
    const tiers = [
      candidates.filter((c) => c.keyword && c.hasDecimal),
      candidates.filter((c) => c.hasDecimal),
      candidates.filter((c) => c.keyword),
      candidates,
    ];
    const pool = tiers.find((t) => t.length) || candidates;
    pool.sort((a, b) => b.val - a.val);
    return pool[0].val;
  }

  function extractDate(text) {
    const m = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    if (y > 2400) y -= 543; // Thai Buddhist Era -> Gregorian
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    if (isNaN(date.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Best-effort recipient/payee extraction for Thai bank transfer slips.
  // Looks for a line introduced by a "to/recipient" keyword and takes the name
  // that follows it (same line, or the next non-empty line if the label is alone).
  const PAYEE_KEYWORDS = /(ไปยัง|ไปที่|ถึง|ผู้รับโอน|ผู้รับเงิน|received?\s*by|receiver|payee|to\s*[:\-])/i;
  const SKIP_LINE = /^[\s\d.,฿$\-:\/]*$/; // lines that are just numbers/punctuation, not a name

  function extractPayee(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(PAYEE_KEYWORDS);
      if (!m) continue;
      let rest = lines[i].slice(m.index + m[0].length).replace(/^[:\-\s]+/, "").trim();
      if (rest && !SKIP_LINE.test(rest)) return rest.slice(0, 60);
      // label was on its own line — take the next non-empty, non-numeric line
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        if (lines[j] && !SKIP_LINE.test(lines[j])) return lines[j].slice(0, 60);
      }
    }
    return null;
  }

  async function scanReceipt(imageSource, onProgress) {
    await loadTesseract();
    // Tesseract's worker can occasionally wedge on a bad image (no error, it
    // just never posts back) — bound it so one photo can't hang every scan
    // after it.
    const { data } = await Utils.withTimeout(
      window.Tesseract.recognize(imageSource, "eng+tha", {
        logger: (m) => {
          if (onProgress && m.status === "recognizing text") onProgress(m.progress);
        },
      }),
      45000,
      "OCR timed out reading this photo"
    );
    const text = data.text || "";
    return { text, amount: extractAmount(text), date: extractDate(text), payee: extractPayee(text) };
  }

  window.OCR = { scanReceipt };
})();
