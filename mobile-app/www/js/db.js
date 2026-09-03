// Local storage data layer for the Ledger app. No backend, no build step.
(function () {
  "use strict";

  const STORAGE_KEY = "ledger_data_v1";

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function defaultData() {
    return {
      settings: {
        currency: "฿",
      },
      categories: [
        { id: uid(), name: "Salary", icon: "💰", type: "income" },
        { id: uid(), name: "Bonus", icon: "🎁", type: "income" },
        { id: uid(), name: "Investment", icon: "📈", type: "income" },
        { id: uid(), name: "Other Income", icon: "➕", type: "income" },
        { id: uid(), name: "Food", icon: "🍜", type: "expense" },
        { id: uid(), name: "Transport", icon: "🚗", type: "expense" },
        { id: uid(), name: "Shopping", icon: "🛒", type: "expense" },
        { id: uid(), name: "Health", icon: "🏥", type: "expense" },
        { id: uid(), name: "Entertainment", icon: "🎬", type: "expense" },
        { id: uid(), name: "Bills", icon: "🧾", type: "expense" },
        { id: uid(), name: "Other", icon: "📦", type: "expense" },
        { id: uid(), name: "Savings", icon: "🐷", type: "saving" },
      ],
      pockets: [],
      pocketItems: [],
      recurringIncomes: [],
      transactions: [],
      scannedPhotos: {},
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const d = defaultData();
        save(d);
        return d;
      }
      const parsed = JSON.parse(raw);
      // fill in any missing top-level keys for forward-compat
      const d = defaultData();
      const mergedSettings = Object.assign({}, d.settings, parsed.settings || {});
      // migrate legacy single-album setting to the multi-album list
      if (!mergedSettings.slipAlbums && mergedSettings.slipAlbum) {
        mergedSettings.slipAlbums = [mergedSettings.slipAlbum];
      }
      delete mergedSettings.slipAlbum;
      return Object.assign({}, d, parsed, { settings: mergedSettings });
    } catch (e) {
      console.error("Failed to load data, resetting.", e);
      const d = defaultData();
      save(d);
      return d;
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  let data = load();

  function persist() {
    save(data);
  }

  const DB = {
    uid,

    get: () => data,

    replaceAll(newData) {
      data = newData;
      persist();
    },

    reset() {
      data = defaultData();
      persist();
    },

    // Settings
    getSettings: () => data.settings,
    updateSettings(patch) {
      data.settings = Object.assign({}, data.settings, patch);
      persist();
    },

    // Categories
    listCategories: (type) =>
      type ? data.categories.filter((c) => c.type === type) : data.categories.slice(),
    addCategory(cat) {
      const c = { id: uid(), name: cat.name, icon: cat.icon || "🏷️", type: cat.type };
      data.categories.push(c);
      persist();
      return c;
    },
    updateCategory(id, patch) {
      const c = data.categories.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      persist();
    },
    deleteCategory(id) {
      data.categories = data.categories.filter((c) => c.id !== id);
      persist();
    },

    // Pockets
    listPockets: () => data.pockets.slice(),
    getPocket: (id) => data.pockets.find((p) => p.id === id),
    addPocket(pocket) {
      const p = { id: uid(), name: pocket.name, color: pocket.color || "#4f46e5", icon: pocket.icon || "💼" };
      data.pockets.push(p);
      persist();
      return p;
    },
    updatePocket(id, patch) {
      const p = data.pockets.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
      persist();
    },
    deletePocket(id) {
      data.pockets = data.pockets.filter((p) => p.id !== id);
      data.pocketItems = data.pocketItems.filter((i) => i.pocketId !== id);
      persist();
    },

    // Pocket items (recurring monthly line items within a pocket)
    listPocketItems: (pocketId) => data.pocketItems.filter((i) => i.pocketId === pocketId),
    getPocketItem: (id) => data.pocketItems.find((i) => i.id === id),
    addPocketItem(item) {
      const i = {
        id: uid(),
        pocketId: item.pocketId,
        name: item.name,
        amount: Number(item.amount) || 0,
        dueDay: item.dueDay ? Number(item.dueDay) : null,
        categoryId: item.categoryId || null,
        installments: item.installments ? Number(item.installments) : null,
        kind: item.kind === "saving" ? "saving" : "bill",
        note: item.note || "",
        paidRecords: {},
      };
      data.pocketItems.push(i);
      persist();
      return i;
    },
    updatePocketItem(id, patch) {
      const i = data.pocketItems.find((x) => x.id === id);
      if (i) Object.assign(i, patch);
      persist();
    },
    deletePocketItem(id) {
      data.pocketItems = data.pocketItems.filter((i) => i.id !== id);
      persist();
    },

    // Mark/unmark a pocket item paid for a given month ("YYYY-MM").
    // Optionally links to an auto-created transaction so paying can log to the ledger.
    setPocketItemPaid(itemId, monthKey, paid, transactionId) {
      const i = data.pocketItems.find((x) => x.id === itemId);
      if (!i) return;
      if (!i.paidRecords) i.paidRecords = {};
      if (paid) {
        i.paidRecords[monthKey] = { paid: true, transactionId: transactionId || null };
      } else {
        delete i.paidRecords[monthKey];
      }
      persist();
    },

    // Recurring income sources (e.g. monthly salary) — defined once, logged with one tap each month.
    listRecurringIncomes: () => data.recurringIncomes.slice(),
    getRecurringIncome: (id) => data.recurringIncomes.find((r) => r.id === id),
    addRecurringIncome(item) {
      const r = {
        id: uid(),
        name: item.name,
        amount: Number(item.amount) || 0,
        categoryId: item.categoryId || null,
        dueDay: item.dueDay ? Number(item.dueDay) : null,
        receivedRecords: {},
      };
      data.recurringIncomes.push(r);
      persist();
      return r;
    },
    updateRecurringIncome(id, patch) {
      const r = data.recurringIncomes.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      persist();
    },
    deleteRecurringIncome(id) {
      data.recurringIncomes = data.recurringIncomes.filter((r) => r.id !== id);
      persist();
    },
    setRecurringIncomeReceived(id, monthKey, received, transactionId) {
      const r = data.recurringIncomes.find((x) => x.id === id);
      if (!r) return;
      if (!r.receivedRecords) r.receivedRecords = {};
      if (received) {
        r.receivedRecords[monthKey] = { received: true, transactionId: transactionId || null };
      } else {
        delete r.receivedRecords[monthKey];
      }
      persist();
    },

    // Transactions
    listTransactions: () => data.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
    getTransaction: (id) => data.transactions.find((t) => t.id === id),
    addTransaction(tx) {
      const t = {
        id: uid(),
        date: tx.date,
        type: tx.type, // 'income' | 'expense'
        amount: Number(tx.amount) || 0,
        categoryId: tx.categoryId || null,
        tag: tx.tag || "",
        note: tx.note || "",
        pocketId: tx.pocketId || null,
        pocketItemId: tx.pocketItemId || null,
        receiptImage: tx.receiptImage || null,
        payee: tx.payee || "",
        autoLogged: !!tx.autoLogged,
      };
      data.transactions.push(t);
      persist();
      return t;
    },
    updateTransaction(id, patch) {
      const t = data.transactions.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      persist();
    },
    deleteTransaction(id) {
      data.transactions = data.transactions.filter((t) => t.id !== id);
      persist();
    },

    // Remembers which category a payee/recipient was categorized as last,
    // so future auto-logged slips from the same payee reuse it.
    findCategoryForPayee(payee) {
      if (!payee) return null;
      const needle = payee.trim().toLowerCase();
      if (!needle) return null;
      const matches = data.transactions
        .filter((t) => t.payee && t.categoryId && t.payee.trim().toLowerCase() === needle)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return matches.length ? matches[0].categoryId : null;
    },

    // Native gallery auto-scan: remembers exactly which photos have already
    // been read (by native media id), so nothing is scanned twice or missed.
    isPhotoScanned(photoId) {
      return !!(data.scannedPhotos && data.scannedPhotos[photoId]);
    },
    markPhotoScanned(photoId) {
      if (!data.scannedPhotos) data.scannedPhotos = {};
      data.scannedPhotos[photoId] = Date.now();
      persist();
    },
  };

  window.DB = DB;
})();
