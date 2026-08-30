// Best-effort client-side receipt/slip scanning using Tesseract.js (loaded from CDN on demand).
// Not perfect OCR — used to pre-fill a transaction draft for the user to review and correct.
(function () {
  "use strict";

  let loaderPromise;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load the OCR engine (check your internet connection)"));
      document.head.appendChild(s);
    });
    return loaderPromise;
  }

  const AMOUNT_KEYWORDS = /(จำนวนเงิน|จำนวน|amount|โอนเงิน|total|บาท|thb)/i;
  const NUM_RE = /\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g;

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
    const keyworded = candidates.filter((c) => c.keyword);
    const pool = keyworded.length ? keyworded : candidates;
    pool.sort((a, b) => (b.hasDecimal - a.hasDecimal) || (b.val - a.val));
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

  async function scanReceipt(imageSource, onProgress) {
    await loadTesseract();
    const { data } = await window.Tesseract.recognize(imageSource, "eng", {
      logger: (m) => {
        if (onProgress && m.status === "recognizing text") onProgress(m.progress);
      },
    });
    const text = data.text || "";
    return { text, amount: extractAmount(text), date: extractDate(text) };
  }

  window.OCR = { scanReceipt };
})();
