(function () {
  "use strict";

  const { el, formatMoney, formatNumber, formatDateShort, formatDateLong, monthLabel, shiftMonth, todayISO, escapeHtml, pad2 } = Utils;

  function setHeader(title, actionsHtml) {
    document.getElementById("page-title").textContent = title;
    document.querySelector("header.topbar").classList.toggle("compact", !title);
    document.querySelector("header.topbar .actions").innerHTML = actionsHtml || "";
  }

  function monthSwitcher(state) {
    const wrap = el(`
      <div class="month-switch">
        <button class="icon-btn" data-dir="-1">‹</button>
        <span class="label">${monthLabel(state.month)}</span>
        <button class="icon-btn" data-dir="1">›</button>
      </div>
    `);
    wrap.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => App.setMonth(shiftMonth(state.month, Number(b.dataset.dir))))
    );
    return wrap;
  }

  function monthCompare(mk, currentMk) {
    if (mk === currentMk) return 0;
    return mk < currentMk ? -1 : 1;
  }

  function pocketItemStatus(item, mk) {
    const paid = !!(item.paidRecords && item.paidRecords[mk]);
    if (paid) return "paid";
    const cmp = monthCompare(mk, Utils.monthKey());
    if (cmp < 0) return "overdue";
    if (cmp > 0) return "upcoming";
    if (item.dueDay && new Date().getDate() > item.dueDay) return "overdue";
    return "unpaid";
  }

  function paidMonthsCount(item) {
    return item.paidRecords ? Object.keys(item.paidRecords).length : 0;
  }

  // Bills/income logged for the currently-real month use today's actual date;
  // logging ahead (or catching up) for a different month dates the transaction
  // inside that month instead, so it lands in the right month's statement.
  function transactionDateForMonth(mk, day) {
    if (mk === Utils.monthKey()) return todayISO();
    return Utils.dateForDay(mk, day);
  }

  function txInMonth(tx, mk) {
    return tx.date && tx.date.slice(0, 7) === mk;
  }

  function categoryById(id) {
    return DB.listCategories().find((c) => c.id === id);
  }

  // ---------- HOME (statement + budget overview) ----------
  function dashboard(state) {
    setHeader("");
    const wrap = el(`<div></div>`);
    wrap.appendChild(monthSwitcher(state));

    const txs = DB.listTransactions().filter((t) => txInMonth(t, state.month));
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const currency = DB.getSettings().currency;

    wrap.appendChild(el(`
      <div class="statement-head">
        <div class="eyebrow">Monthly Expense</div>
        <div class="statement-total">${formatNumber(expense)}<span class="cur">${escapeHtml(currency)}</span></div>
      </div>
    `));

    if (!txs.length) {
      wrap.appendChild(el(`<div class="empty-state"><div class="big">🧾</div><div>No transactions this month yet.</div><div style="font-size:13px;margin-top:4px">Tap + to add one.</div></div>`));
    } else {
      const byDate = {};
      txs.forEach((t) => (byDate[t.date] = byDate[t.date] || []).push(t));
      const groups = el(`<div class="day-groups"></div>`);
      Object.keys(byDate)
        .sort((a, b) => (a < b ? 1 : -1))
        .forEach((date) => {
          const dayTxs = byDate[date];
          const dayExpense = dayTxs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
          const group = el(`
            <div class="day-group">
              <div class="day-header-row">
                <span>${formatDateShort(date)}</span>
                <span>${formatNumber(dayExpense)} ${escapeHtml(currency)}</span>
              </div>
            </div>
          `);
          dayTxs.forEach((t) => {
            const c = categoryById(t.categoryId);
            const pocket = t.pocketId ? DB.getPocket(t.pocketId) : null;
            const fallbackIcon = t.type === "income" ? "💰" : t.type === "saving" ? "🐷" : t.type === "transfer" ? "🔁" : "💸";
            const amtSign = t.type === "income" ? "+" : t.type === "transfer" ? "" : "-";
            const subParts = [];
            if (pocket) subParts.push(escapeHtml(pocket.name));
            if (t.payee) subParts.push(escapeHtml(t.payee));
            // Auto-logged rows (bill payments, recurring, slip scans) skip the
            // note — it's just boilerplate ("Rent", "Auto-logged from slip
            // photo") that repeats what the category/pocket already show.
            if (t.note && !t.autoLogged) subParts.push(escapeHtml(t.note));
            const row = el(`
              <div class="day-sub-row">
                <div class="emoji">${c ? c.icon : fallbackIcon}</div>
                <div class="main">
                  <div class="title">${c ? escapeHtml(c.name) : "Uncategorized"}${t.tag ? " · " + escapeHtml(t.tag) : ""}${t.receiptImage ? " 📷" : ""}</div>
                  <div class="sub">${subParts.join(" · ")}</div>
                </div>
                <div class="amt ${t.type}">${amtSign}${formatNumber(t.amount)} ${escapeHtml(currency)}</div>
              </div>
            `);
            row.style.cursor = "pointer";
            row.addEventListener("click", () => openTransactionForm(state, t));
            group.appendChild(row);
          });
          groups.appendChild(group);
        });
      groups.appendChild(el(`<div class="day-groups-spacer"></div>`));
      wrap.appendChild(groups);
    }

    return wrap;
  }

  function billStatusLabel(status, isSaving) {
    if (status === "paid") return isSaving ? "Saved" : "Paid";
    if (status === "overdue") return isSaving ? "Not saved yet" : "Overdue";
    if (status === "upcoming") return "Upcoming";
    return isSaving ? "Not saved" : "Unpaid";
  }

  // Pockets list: which pockets/bills are currently expanded in the
  // accordion. Lives at module scope (not per-render) so it survives the
  // full re-render that toggling paid state or expand/collapse triggers.
  const expandedPockets = new Set();
  const expandedPocketItems = new Set();

  function pocketItemDetailLine(item, state) {
    const parts = [];
    if (item.installments) parts.push(`${paidMonthsCount(item)}/${item.installments} paid`);
    if (item.dueDay) parts.push(`due date ${formatDateLong(Utils.dateForDay(state.month, item.dueDay))}`);
    if (item.autoDebit) parts.push("auto debit");
    return parts.join(" · ");
  }

  // A bill/saving-reminder row inside an expanded pocket: check to toggle
  // paid, amount, and its own arrow to reveal installment/due-date detail.
  function pocketAccordionItemRow(item, pocket, state) {
    const isPaid = pocketItemStatus(item, state.month) === "paid";
    const cat = item.categoryId ? categoryById(item.categoryId) : null;
    const isExpanded = expandedPocketItems.has(item.id);
    const currency = DB.getSettings().currency;
    const icon = cat ? cat.icon : item.kind === "saving" ? "🐷" : pocket.icon;
    const row = el(`
      <div class="day-sub-row item-row">
        <div class="emoji">${icon}</div>
        <div class="main"><div class="title">${escapeHtml(item.name)}</div></div>
        <div class="item-actions">
          <button type="button" class="check-btn ${isPaid ? "paid" : ""}">✓</button>
          <span class="amt">${formatNumber(item.amount)} ${escapeHtml(currency)}</span>
          <button type="button" class="item-toggle">${isExpanded ? "▾" : "▴"}</button>
        </div>
      </div>
    `);
    row.querySelector(".check-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePaid(item, state.month);
    });
    row.querySelector(".item-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      if (isExpanded) expandedPocketItems.delete(item.id);
      else expandedPocketItems.add(item.id);
      App.render();
    });
    row.addEventListener("click", () => openPocketItemActions(item, pocket, state.month));
    return row;
  }

  // A pocket as a collapsible group: collapsed shows one summary row (paid
  // check + total + arrow); expanded shows the pocket name as a header
  // followed by each bill's own row.
  function pocketGroupEl(pocket, state) {
    const items = DB.listPocketItems(pocket.id);
    const total = items.reduce((s, i) => s + i.amount, 0);
    const allPaid = items.length > 0 && items.every((i) => pocketItemStatus(i, state.month) === "paid");
    const isExpanded = expandedPockets.has(pocket.id);
    const currency = DB.getSettings().currency;

    const group = el(`<div class="day-group pocket-group"></div>`);
    const header = el(`
      <div class="day-header-row pocket-head">
        <span>${escapeHtml(pocket.name)}</span>
        <span class="pocket-head-right"></span>
      </div>
    `);
    header.querySelector(".pocket-head-right").innerHTML = isExpanded
      ? `<button type="button" class="pocket-toggle">▾</button>`
      : `
        <span class="check-btn ${allPaid ? "paid" : ""}" style="pointer-events:none">✓</span>
        <span class="amt">${formatNumber(total)} ${escapeHtml(currency)}</span>
        <button type="button" class="pocket-toggle">▴</button>
      `;
    header.querySelector(".pocket-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      if (isExpanded) expandedPockets.delete(pocket.id);
      else expandedPockets.add(pocket.id);
      App.render();
    });
    header.addEventListener("click", () => App.navigate(`#/pocket/${pocket.id}`));
    group.appendChild(header);

    if (isExpanded) {
      if (!items.length) {
        group.appendChild(el(`<div class="day-sub-row item-empty"><div class="main"><div class="sub">No bills in this pocket yet.</div></div></div>`));
      } else {
        items
          .slice()
          .sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99))
          .forEach((item) => {
            group.appendChild(pocketAccordionItemRow(item, pocket, state));
            if (expandedPocketItems.has(item.id)) {
              const line = pocketItemDetailLine(item, state);
              if (line) group.appendChild(el(`<div class="day-sub-row item-detail"><div class="detail-text">${line}</div></div>`));
            }
          });
      }
    }
    return group;
  }

  // Creates the paid transaction for a bill/saving item and marks it paid;
  // shared by the manual checkbox toggle and the silent auto-debit engine.
  function markPocketItemPaid(item, mk) {
    const isSaving = item.kind === "saving";
    const cat = item.categoryId ? categoryById(item.categoryId) : null;
    const txType = isSaving ? "saving" : "expense";
    const fallbackCat = cat || (isSaving
      ? DB.listCategories("saving")[0]
      : DB.listCategories("expense").find((c) => /bills?/i.test(c.name)) || DB.listCategories("expense")[0]);
    const tx = DB.addTransaction({
      date: transactionDateForMonth(mk, item.dueDay),
      type: txType,
      amount: item.amount,
      categoryId: fallbackCat ? fallbackCat.id : null,
      note: item.name,
      pocketId: item.pocketId,
      pocketItemId: item.id,
      autoLogged: true,
    });
    DB.setPocketItemPaid(item.id, mk, true, tx.id);
    const fresh = DB.getPocketItem(item.id);
    const completedInstallment = !!(fresh && fresh.installments && paidMonthsCount(fresh) >= fresh.installments);
    if (completedInstallment) DB.deletePocketItem(item.id);
    return { isSaving, completedInstallment };
  }

  function togglePaid(item, mk) {
    const isSaving = item.kind === "saving";
    const isPaid = !!(item.paidRecords && item.paidRecords[mk]);
    if (isPaid) {
      const rec = item.paidRecords[mk];
      if (rec && rec.transactionId) DB.deleteTransaction(rec.transactionId);
      DB.setPocketItemPaid(item.id, mk, false);
      App.toast(isSaving ? "Unmarked" : "Marked unpaid");
      App.render();
      return;
    }
    const pocket = DB.getPocket(item.pocketId);
    const { completedInstallment } = markPocketItemPaid(item, mk);
    if (completedInstallment) {
      App.toast(`Installment plan complete — "${item.name}" cleared from ${pocket ? pocket.name : "pocket"}`);
    } else {
      App.toast(isSaving ? "Marked as saved & logged" : "Marked paid & logged to ledger");
    }
    App.render();
  }

  // Bills flagged auto-debit are marked paid (and logged) as soon as their
  // due day arrives, without waiting for a manual tap — mirrors a real
  // automatic bank debit. Runs on app open, same cadence as recurring
  // transactions.
  function runAutoDebitBills() {
    const mk = Utils.monthKey();
    const today = new Date().getDate();
    let changed = false;
    DB.listPockets().forEach((pocket) => {
      DB.listPocketItems(pocket.id).forEach((item) => {
        if (!item.autoDebit) return;
        const isPaid = !!(item.paidRecords && item.paidRecords[mk]);
        if (isPaid) return;
        if (item.dueDay && today < item.dueDay) return;
        markPocketItemPaid(item, mk);
        changed = true;
      });
    });
    return changed;
  }

  // ---------- POCKETS ----------
  function pocketsList(state) {
    setHeader("", `<button class="icon-btn" id="add-pocket">＋</button>`);
    const wrap = el(`<div></div>`);
    wrap.appendChild(monthSwitcher(state));

    const currency = DB.getSettings().currency;
    const pockets = DB.listPockets();
    const allItems = pockets.flatMap((p) => DB.listPocketItems(p.id));
    // Pockets' own "Monthly Expense"/"Save" are the total monthly obligation
    // across every bill/saving item (regardless of paid status this month) —
    // deliberately separate from Home's statement total, which sums actually
    // logged transactions app-wide. "Remaining" here is Salary minus both
    // (bills and money set aside), not a net-of-everything figure.
    const salary = DB.listTransactions()
      .filter((t) => txInMonth(t, state.month) && t.type === "income")
      .reduce((s, t) => s + t.amount, 0);
    const pocketExpense = allItems.filter((i) => i.kind !== "saving").reduce((s, i) => s + i.amount, 0);
    const pocketSave = allItems.filter((i) => i.kind === "saving").reduce((s, i) => s + i.amount, 0);
    const remaining = salary - pocketExpense - pocketSave;

    const statsRow = el(`
      <div class="pocket-stats-row">
        <button type="button" class="pocket-stat" id="salary-stat">
          <div class="pocket-stat-label income">Salary</div>
          <div class="pocket-stat-value income">${formatNumber(salary)}<span class="cur">${escapeHtml(currency)}</span></div>
        </button>
        <div class="pocket-stat right">
          <div class="pocket-stat-label">Monthly Expense</div>
          <div class="pocket-stat-value">${formatNumber(pocketExpense)}<span class="cur">${escapeHtml(currency)}</span></div>
        </div>
      </div>
    `);
    statsRow.querySelector("#salary-stat").addEventListener("click", () => openTransactionForm(state, null, { type: "income" }));
    wrap.appendChild(statsRow);

    if (!pockets.length) {
      const emptyCard = el(`
        <div class="pocket-empty-card">
          <button type="button" class="pocket-empty-add"><img src="icons/nav/nav-add-container.png" alt="Add pocket" /></button>
        </div>
      `);
      emptyCard.querySelector(".pocket-empty-add").addEventListener("click", () => openPocketItemForm(null));
      wrap.appendChild(emptyCard);
    } else {
      const groups = el(`<div class="day-groups pocket-groups"></div>`);
      pockets.forEach((pocket) => groups.appendChild(pocketGroupEl(pocket, state)));
      const addRow = el(`
        <div class="pocket-add-row">
          <button type="button" class="pocket-add-btn"><img src="icons/nav/nav-add-container.png" alt="Add pocket" /></button>
        </div>
      `);
      addRow.querySelector(".pocket-add-btn").addEventListener("click", () => openPocketItemForm(null));
      groups.appendChild(addRow);
      wrap.appendChild(groups);
    }

    wrap.appendChild(el(`
      <div class="pocket-foot-stats">
        <div class="pocket-foot-row"><span>Remaining</span><span class="amt remaining">${formatMoney(remaining)}</span></div>
        <div class="pocket-foot-row"><span>Save</span><span class="amt save">${formatMoney(pocketSave)}</span></div>
      </div>
    `));

    document.getElementById("add-pocket").addEventListener("click", () => openPocketItemForm(null));
    return wrap;
  }

  const POCKET_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
  const POCKET_ICONS = ["💼", "🏠", "📈", "🛍️", "🚗", "🏥", "🎓", "✈️", "💡", "🐷"];

  function openPocketForm(existing) {
    const chosenColor = { v: existing ? existing.color : POCKET_COLORS[0] };
    const chosenIcon = { v: existing ? existing.icon : POCKET_ICONS[0] };
    App.openSheet(existing ? "Edit Pocket" : "New Pocket", `
      <div class="field"><label>Name</label><input type="text" id="f-name" placeholder="e.g. Fixed Cost" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="field"><label>Icon</label><div class="chip-grid" id="f-icons">${POCKET_ICONS.map((ic) => `<div class="chip icon-choice ${ic === chosenIcon.v ? "active" : ""}" data-v="${ic}">${ic}</div>`).join("")}</div></div>
      <div class="field"><label>Color</label><div class="color-grid" id="f-colors">${POCKET_COLORS.map((c) => `<div class="color-swatch ${c === chosenColor.v ? "active" : ""}" data-v="${c}" style="background:${c}"></div>`).join("")}</div></div>
      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, (body) => {
      body.querySelectorAll(".icon-choice").forEach((b) => b.addEventListener("click", () => {
        body.querySelectorAll(".icon-choice").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        chosenIcon.v = b.dataset.v;
      }));
      body.querySelectorAll(".color-swatch").forEach((b) => b.addEventListener("click", () => {
        body.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        chosenColor.v = b.dataset.v;
      }));
      body.querySelector("#save").addEventListener("click", () => {
        const name = body.querySelector("#f-name").value.trim();
        if (!name) return App.toast("Enter a name");
        if (existing) {
          DB.updatePocket(existing.id, { name, icon: chosenIcon.v, color: chosenColor.v });
        } else {
          DB.addPocket({ name, icon: chosenIcon.v, color: chosenColor.v });
        }
        App.closeSheet();
        App.render();
      });
      wireDeleteButton(body.querySelector("#delete"), () => {
        DB.deletePocket(existing.id);
        App.closeSheet();
        App.navigate("#/pockets");
      }, "Tap again to delete");
    });
  }

  function pocketDetail(state, id) {
    const pocket = DB.getPocket(id);
    if (!pocket) {
      App.navigate("#/pockets");
      return el(`<div></div>`);
    }
    setHeader(pocket.name, `
      <button class="icon-btn" id="back">←</button>
      <button class="icon-btn" id="edit-pocket">✎</button>
    `);
    const wrap = el(`<div></div>`);
    wrap.appendChild(monthSwitcher(state));

    const items = DB.listPocketItems(pocket.id);
    const total = items.reduce((s, i) => s + i.amount, 0);
    const paid = items.filter((i) => pocketItemStatus(i, state.month) === "paid");
    const paidTotal = paid.reduce((s, i) => s + i.amount, 0);
    const pct = total > 0 ? Math.min(100, (paidTotal / total) * 100) : 0;

    wrap.appendChild(el(`
      <div class="card">
        <div class="budget-line"><span>Total monthly</span><span class="amt">${formatMoney(total)}</span></div>
        <div class="budget-line"><span>Paid</span><span class="amt">${formatMoney(paidTotal)}</span></div>
        <div class="budget-line remaining"><span>Remaining</span><span class="amt">${formatMoney(total - paidTotal)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    `));

    if (!items.length) {
      wrap.appendChild(el(`<div class="empty-state"><div class="big">🧾</div><div>No bills in this pocket yet.</div></div>`));
    } else {
      const list = el(`<div class="list"></div>`);
      items
        .slice()
        .sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99))
        .forEach((item) => {
          const status = pocketItemStatus(item, state.month);
          const isSaving = item.kind === "saving";
          const pillClass = status === "paid" ? "paid" : status === "overdue" ? "overdue" : "unpaid";
          const pillText = billStatusLabel(status, isSaving);
          const cat = item.categoryId ? categoryById(item.categoryId) : null;
          const installBadge = item.installments ? `<span class="pill installment">${paidMonthsCount(item)}/${item.installments} paid</span>` : "";
          const kindBadge = isSaving ? `<span class="pill installment">🐷 Reminder</span>` : "";
          const row = el(`
            <div class="row-item">
              <div class="emoji">${cat ? cat.icon : isSaving ? "🐷" : "🧾"}</div>
              <div class="main">
                <div class="title">${escapeHtml(item.name)}</div>
                <div class="sub">${item.dueDay ? "Due day " + item.dueDay : "No due date"} · <span class="pill ${pillClass}">${pillText}</span> ${installBadge} ${kindBadge}${item.note ? "<br>" + escapeHtml(item.note) : ""}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
                <div class="amt">${formatMoney(item.amount)}</div>
              </div>
            </div>
          `);
          row.style.cursor = "pointer";
          row.addEventListener("click", () => openPocketItemActions(item, pocket, state.month));
          list.appendChild(row);
        });
      wrap.appendChild(list);
    }

    const addBtn = el(`<button class="secondary" style="width:100%;margin-top:6px">＋ Add Bill</button>`);
    addBtn.addEventListener("click", () => openPocketItemForm(pocket.id));
    wrap.appendChild(addBtn);

    setTimeout(() => {
      document.getElementById("back").addEventListener("click", () => App.navigate("#/pockets"));
      document.getElementById("edit-pocket").addEventListener("click", () => openPocketForm(pocket));
    });

    return wrap;
  }

  function openPocketItemActions(item, pocket, mk) {
    const status = pocketItemStatus(item, mk);
    const isSaving = item.kind === "saving";
    const toggleLabel = status === "paid"
      ? (isSaving ? "Mark as Not Saved" : "Mark as Unpaid")
      : (isSaving ? "Mark as Saved" : "Mark as Paid");
    App.openSheet(escapeHtml(item.name), `
      <div class="sheet-actions" style="flex-direction:column">
        <button class="primary" id="toggle-paid">${toggleLabel}</button>
        <button class="secondary" id="edit-item">Edit ${isSaving ? "Reminder" : "Bill"}</button>
        <button class="secondary danger" id="delete-item">Delete ${isSaving ? "Reminder" : "Bill"}</button>
      </div>
    `, (body) => {
      body.querySelector("#toggle-paid").addEventListener("click", () => {
        App.closeSheet();
        togglePaid(item, mk);
      });
      body.querySelector("#edit-item").addEventListener("click", () => {
        App.closeSheet();
        openPocketItemForm(pocket.id, item);
      });
      wireDeleteButton(body.querySelector("#delete-item"), () => {
        DB.deletePocketItem(item.id);
        App.closeSheet();
        App.render();
      }, "Tap again to delete");
    });
  }

  // pocketId may be null when creating a pocket from scratch (e.g. the
  // Pockets list's own "+"): saving then auto-creates a new pocket, named
  // after this bill, to hold it.
  function openPocketItemForm(pocketId, existing) {
    const kind = { v: existing && existing.kind === "saving" ? "saving" : "bill" };
    const categoryId = { v: existing ? existing.categoryId : null };
    // Which pocket this bill belongs to. Starts as whatever was passed in
    // (an existing item's own pocket, or the pocket you tapped "+ Add Bill"
    // from); left unset otherwise so it can be picked explicitly.
    const chosenPocketId = { v: pocketId || (existing ? existing.pocketId : null) };
    const newPocketName = { v: "" };
    const autoDebit = { v: existing ? !!existing.autoDebit : false };
    const currency = DB.getSettings().currency;
    // dueDay is a plain day-of-month (recurs every month); the calendar
    // picker is just a friendlier way to choose it — only the day is kept.
    const dueDay = { v: existing && existing.dueDay ? existing.dueDay : new Date().getDate() };
    const dueDateIso = { v: Utils.dateForDay(Utils.monthKey(), dueDay.v) };
    const dueEnabled = { v: existing ? !!existing.dueDay : true };

    function catChips() {
      return DB.listCategories(kind.v === "saving" ? "saving" : "expense")
        .map((c) => `<div class="chip cat-choice ${c.id === categoryId.v ? "active" : ""}" data-v="${c.id}">${c.icon} ${escapeHtml(c.name)}</div>`)
        .join("");
    }
    function catIconHtml() {
      const cat = categoryId.v && DB.listCategories().find((c) => c.id === categoryId.v);
      return cat ? escapeHtml(cat.icon) : `<img class="tx-icon-img" src="icons/tx/catgetory-icon.png" alt="">`;
    }
    function kindIcon() {
      return kind.v === "saving" ? "icons/tx/saving.png" : "icons/tx/outcome.png";
    }
    function pocketChips() {
      return DB.listPockets()
        .map((p) => `<div class="chip pocket-choice ${p.id === chosenPocketId.v ? "active" : ""}" data-v="${p.id}">${p.icon} ${escapeHtml(p.name)}</div>`)
        .join("");
    }
    function pocketRowText() {
      if (chosenPocketId.v) {
        const p = DB.getPocket(chosenPocketId.v);
        return p ? escapeHtml(p.name) : "pocket";
      }
      if (newPocketName.v) return `${escapeHtml(newPocketName.v)} (new)`;
      return "pocket";
    }

    App.openSheet(
      `<div class="tx-sheet-head"><span>${existing ? "Edit pocket" : "Add pocket"}</span><button type="button" id="tx-close" class="tx-close-btn" aria-label="Close">&times;</button></div>`,
      `
      <div class="seg tx-type-seg">
        <button type="button" class="kind-choice ${kind.v === "bill" ? "active" : ""}" data-v="bill">Bill</button>
        <button type="button" class="kind-choice ${kind.v === "saving" ? "active" : ""}" data-v="saving">Reminder</button>
      </div>
      <div class="type-hint">${kind.v === "saving" ? "Reminds you to set money aside — it won't count as spending." : "Logs a real expense to your ledger once marked paid."}</div>

      <div class="tx-row ${dueEnabled.v ? "" : "pk-row-disabled"}" id="pk-due-row">
        <span class="pk-tap-area" id="pk-due-tap">
          <img class="tx-row-icon" src="icons/tx/calendar.png" alt="" />
          <span class="tx-row-text" id="pk-due-label">${dueEnabled.v ? formatDateLong(dueDateIso.v) : "No due date"}</span>
        </span>
        <span class="pk-switch ${dueEnabled.v ? "on" : ""}" id="pk-due-switch"><span class="pk-switch-knob"></span></span>
      </div>
      ${calendarPanelHtml("pk-due", "Select due date")}

      <div class="tx-row tx-amount-row" id="pk-amount-row">
        <span class="tx-row-icon tx-icon-badge" id="pk-type-icon"><img class="tx-icon-img" src="${kindIcon()}" alt="" /></span>
        <span class="tx-row-text">Amount</span>
        <span class="tx-row-value" id="pk-amount-value">${existing ? formatNumber(existing.amount) : "0"} ${currency}</span>
      </div>
      <div class="tx-calc-panel hidden" id="pk-calc-panel">
        ${calculatorHtml("pk-amount", existing ? existing.amount : "")}
      </div>

      <div class="tx-row" id="pk-category-row">
        <span class="tx-row-icon tx-icon-badge" id="pk-cat-icon">${catIconHtml()}</span>
        <span class="tx-row-text" id="pk-cat-label">category</span>
        <span class="tx-row-chevron">›</span>
      </div>
      <div class="tx-panel hidden" id="pk-cat-panel">
        <div class="tx-panel-head"><button type="button" class="tx-back" id="pk-cat-back">‹</button><span>Select category</span></div>
        <div class="chip-grid" id="pk-cats">${catChips()}</div>
      </div>

      <div class="tx-row" id="pk-pocket-row">
        <span class="tx-row-icon">💼</span>
        <span class="tx-row-text" id="pk-pocket-label">${pocketRowText()}</span>
        <span class="tx-row-chevron">›</span>
      </div>
      <div class="tx-panel hidden" id="pk-pocket-panel">
        <div class="tx-panel-head"><button type="button" class="tx-back" id="pk-pocket-back">‹</button><span>Select pocket</span></div>
        <div class="chip-grid" id="pk-pockets">${pocketChips()}</div>
        <div class="tx-row tx-note-row" style="margin-top:10px">
          <input type="text" id="pk-new-pocket" class="tx-note-input" placeholder="or type a new pocket name" />
        </div>
      </div>

      <div class="tx-row tx-note-row"><input type="text" id="pk-name" class="tx-note-input" placeholder="name" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="tx-row tx-note-row"><input type="number" id="pk-installments" class="tx-note-input" placeholder="installments" min="1" value="${existing && existing.installments ? existing.installments : ""}" /></div>
      <div class="tx-row tx-note-row"><input type="text" id="pk-note" class="tx-note-input" placeholder="note" value="${existing ? escapeHtml(existing.note || "") : ""}" /></div>

      <div class="tx-row" id="pk-auto-row">
        <img class="tx-row-icon" src="icons/tx/recurring.png" alt="" />
        <span class="tx-row-text">Auto debit every month</span>
        <span class="pk-switch ${autoDebit.v ? "on" : ""}" id="pk-auto-switch"><span class="pk-switch-knob"></span></span>
      </div>
      <div class="type-hint">Marks this paid and logs it automatically once its due day arrives each month — no need to tap.</div>

      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, wire);

    function wire(sheetBody) {
      document.getElementById("tx-close").addEventListener("click", () => App.closeSheet());

      const amountRow = sheetBody.querySelector("#pk-amount-row");
      const calcPanel = sheetBody.querySelector("#pk-calc-panel");
      const amountInput = sheetBody.querySelector("#pk-amount");
      const amountValueEl = sheetBody.querySelector("#pk-amount-value");
      function syncAmount() {
        amountValueEl.textContent = `${amountInput.value || "0"} ${currency}`;
      }
      amountRow.addEventListener("click", () => {
        calcPanel.classList.toggle("hidden");
        sheetBody.querySelector("#pk-cat-panel").classList.add("hidden");
        sheetBody.querySelector("#pk-pocket-panel").classList.add("hidden");
      });
      wireCalculator(sheetBody, amountInput);
      amountInput.addEventListener("input", syncAmount);
      syncAmount();

      const dueLabel = sheetBody.querySelector("#pk-due-label");
      const dueTap = sheetBody.querySelector("#pk-due-tap");
      // Registered before wireCalendarPanel's own click listener on the same
      // element, so when the due date is off this blocks that later listener
      // (stopImmediatePropagation) instead of popping the calendar anyway.
      dueTap.addEventListener("click", (e) => {
        if (!dueEnabled.v) e.stopImmediatePropagation();
      });
      wireCalendarPanel(sheetBody, "pk-due", dueTap, () => dueDateIso.v, (iso) => {
        dueDateIso.v = iso;
        dueDay.v = Number(iso.slice(8, 10));
        dueLabel.textContent = formatDateLong(iso);
        sheetBody.querySelector("#pk-due-panel").classList.add("hidden");
      });
      sheetBody.querySelector("#pk-due-switch").addEventListener("click", (e) => {
        e.stopPropagation();
        dueEnabled.v = !dueEnabled.v;
        sheetBody.querySelector("#pk-due-switch").classList.toggle("on", dueEnabled.v);
        sheetBody.querySelector("#pk-due-row").classList.toggle("pk-row-disabled", !dueEnabled.v);
        dueLabel.textContent = dueEnabled.v ? formatDateLong(dueDateIso.v) : "No due date";
      });

      const catRow = sheetBody.querySelector("#pk-category-row");
      const catPanel = sheetBody.querySelector("#pk-cat-panel");
      function updateCatRow() {
        const cat = categoryId.v && DB.listCategories().find((c) => c.id === categoryId.v);
        sheetBody.querySelector("#pk-cat-icon").innerHTML = catIconHtml();
        sheetBody.querySelector("#pk-cat-label").textContent = cat ? cat.name : "category";
      }
      catRow.addEventListener("click", () => {
        catPanel.classList.remove("hidden");
        calcPanel.classList.add("hidden");
        sheetBody.querySelector("#pk-pocket-panel").classList.add("hidden");
      });
      sheetBody.querySelector("#pk-cat-back").addEventListener("click", () => catPanel.classList.add("hidden"));

      const pocketRow = sheetBody.querySelector("#pk-pocket-row");
      const pocketPanel = sheetBody.querySelector("#pk-pocket-panel");
      const pocketLabel = sheetBody.querySelector("#pk-pocket-label");
      const newPocketInput = sheetBody.querySelector("#pk-new-pocket");
      function refreshPocketChips() {
        sheetBody.querySelector("#pk-pockets").innerHTML = pocketChips();
        sheetBody.querySelectorAll(".pocket-choice").forEach((b) => b.addEventListener("click", () => {
          chosenPocketId.v = b.dataset.v;
          newPocketName.v = "";
          newPocketInput.value = "";
          sheetBody.querySelectorAll(".pocket-choice").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          pocketLabel.textContent = pocketRowText();
          pocketPanel.classList.add("hidden");
        }));
      }
      pocketRow.addEventListener("click", () => {
        refreshPocketChips();
        pocketPanel.classList.remove("hidden");
        calcPanel.classList.add("hidden");
        catPanel.classList.add("hidden");
      });
      sheetBody.querySelector("#pk-pocket-back").addEventListener("click", () => pocketPanel.classList.add("hidden"));
      newPocketInput.addEventListener("input", (e) => {
        newPocketName.v = e.target.value.trim();
        if (newPocketName.v) chosenPocketId.v = null;
        sheetBody.querySelectorAll(".pocket-choice").forEach((x) => x.classList.remove("active"));
        pocketLabel.textContent = pocketRowText();
      });

      function refreshCats() {
        sheetBody.querySelector("#pk-cats").innerHTML = catChips();
        sheetBody.querySelectorAll(".cat-choice").forEach((b) => b.addEventListener("click", () => {
          categoryId.v = b.dataset.v;
          sheetBody.querySelectorAll(".cat-choice").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          updateCatRow();
          catPanel.classList.add("hidden");
        }));
      }
      sheetBody.querySelectorAll(".kind-choice").forEach((b) => b.addEventListener("click", () => {
        kind.v = b.dataset.v;
        categoryId.v = null;
        sheetBody.querySelectorAll(".kind-choice").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        sheetBody.querySelector(".type-hint").textContent = kind.v === "saving"
          ? "Reminds you to set money aside — it won't count as spending."
          : "Logs a real expense to your ledger once marked paid.";
        sheetBody.querySelector("#pk-type-icon img").src = kindIcon();
        refreshCats();
        updateCatRow();
      }));
      refreshCats();
      updateCatRow();

      sheetBody.querySelector("#pk-auto-row").addEventListener("click", () => {
        autoDebit.v = !autoDebit.v;
        sheetBody.querySelector("#pk-auto-switch").classList.toggle("on", autoDebit.v);
      });

      sheetBody.querySelector("#save").addEventListener("click", () => {
        const name = sheetBody.querySelector("#pk-name").value.trim();
        const amount = readAmountValue(amountInput);
        if (!name || !amount || isNaN(amount)) return App.toast("Enter name and amount");
        const installRaw = sheetBody.querySelector("#pk-installments").value;
        const payload = {
          name,
          amount,
          kind: kind.v,
          categoryId: categoryId.v,
          dueDay: dueEnabled.v ? dueDay.v : null,
          installments: installRaw ? Number(installRaw) : null,
          note: sheetBody.querySelector("#pk-note").value.trim(),
          autoDebit: autoDebit.v,
        };
        // Resolve which pocket this goes into: an existing one you picked,
        // a brand-new one under the typed (or, failing that, the bill's own)
        // name, or — when editing — whatever's currently chosen.
        let targetPocketId = chosenPocketId.v;
        if (!targetPocketId) {
          const cat = categoryId.v && DB.listCategories().find((c) => c.id === categoryId.v);
          const color = POCKET_COLORS[DB.listPockets().length % POCKET_COLORS.length];
          targetPocketId = DB.addPocket({ name: newPocketName.v || name, icon: cat ? cat.icon : (kind.v === "saving" ? "🐷" : "💼"), color }).id;
        }
        payload.pocketId = targetPocketId;
        if (existing) {
          DB.updatePocketItem(existing.id, payload);
        } else {
          DB.addPocketItem(payload);
        }
        App.closeSheet();
        App.render();
      });
      wireDeleteButton(sheetBody.querySelector("#delete"), () => {
        DB.deletePocketItem(existing.id);
        App.closeSheet();
        App.render();
      }, "Tap again to delete");
    }
  }

  // ---------- TRANSACTION FORM (with optional receipt/OCR pre-fill) ----------
  let activeTxSheetBody = null;

  // Small left-to-right calculator: numbers separated by + - × ÷, with × ÷
  // applied immediately (proper precedence) and + - terms summed at the end.
  // No parentheses — this is a quick "50+89" style helper, not a full calculator.
  function evalCalcExpr(expr) {
    const tokens = expr.match(/(\d+\.?\d*|[+\-×÷])/g);
    if (!tokens || !tokens.length || isNaN(parseFloat(tokens[0]))) return null;
    let result = parseFloat(tokens[0]);
    let i = 1;
    while (i < tokens.length - 1) {
      const op = tokens[i];
      const num = parseFloat(tokens[i + 1]);
      if (isNaN(num)) break;
      if (op === "×") result *= num;
      else if (op === "÷") result = num !== 0 ? result / num : result;
      else if (op === "+") result += num;
      else if (op === "-") result -= num;
      i += 2;
    }
    return result;
  }

  function calculatorHtml(id, initialValue) {
    return `
      <input type="text" id="${id}" class="amount-display" inputmode="none" placeholder="0" autocomplete="off"
        value="${initialValue != null && initialValue !== "" ? initialValue : ""}" />
      <div class="calc-grid">
        <button type="button" class="calc-key" data-k="7">7</button>
        <button type="button" class="calc-key" data-k="8">8</button>
        <button type="button" class="calc-key" data-k="9">9</button>
        <button type="button" class="calc-key op" data-k="÷">÷</button>
        <button type="button" class="calc-key" data-k="4">4</button>
        <button type="button" class="calc-key" data-k="5">5</button>
        <button type="button" class="calc-key" data-k="6">6</button>
        <button type="button" class="calc-key op" data-k="×">×</button>
        <button type="button" class="calc-key" data-k="1">1</button>
        <button type="button" class="calc-key" data-k="2">2</button>
        <button type="button" class="calc-key" data-k="3">3</button>
        <button type="button" class="calc-key op" data-k="-">−</button>
        <button type="button" class="calc-key" data-k="0">0</button>
        <button type="button" class="calc-key" data-k=".">.</button>
        <button type="button" class="calc-key fn" data-k="back">⌫</button>
        <button type="button" class="calc-key op" data-k="+">+</button>
        <button type="button" class="calc-key fn wide" data-k="clear">C</button>
        <button type="button" class="calc-key eq wide" data-k="=">=</button>
      </div>
    `;
  }

  function wireCalculator(container, inputEl) {
    container.querySelectorAll(".calc-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.k;
        let v = inputEl.value;
        if (k === "clear") {
          v = "";
        } else if (k === "back") {
          v = v.slice(0, -1);
        } else if (k === "=") {
          const result = evalCalcExpr(v);
          if (result != null && isFinite(result)) v = String(Math.round(result * 100) / 100);
        } else if (k === "+" || k === "-" || k === "×" || k === "÷") {
          if (!v) return; // can't lead with an operator
          v = /[+\-×÷]$/.test(v) ? v.slice(0, -1) + k : v + k;
        } else if (k === ".") {
          const lastSegment = v.split(/[+\-×÷]/).pop();
          if (lastSegment.includes(".")) return;
          v = v + k;
        } else {
          v = v + k;
        }
        inputEl.value = v;
        inputEl.dispatchEvent(new Event("input"));
      });
    });
    inputEl.addEventListener("input", () => {
      inputEl.value = inputEl.value.replace(/[^0-9+\-×÷.*/]/g, "").replace(/\*/g, "×").replace(/\//g, "÷");
    });
  }

  // Reads the amount field's final numeric value, evaluating an unfinished
  // expression (e.g. "50+89") automatically if the user never pressed "=".
  function readAmountValue(inputEl) {
    const v = inputEl.value.trim();
    if (!v) return NaN;
    if (/[+\-×÷]/.test(v)) {
      const result = evalCalcExpr(v);
      return result != null ? result : NaN;
    }
    return parseFloat(v);
  }

  const TYPE_HINTS = {
    saving: "Saving is money you set aside — it won't count as spending in your totals.",
    transfer: "Transfer is money moving between your own accounts/pockets — it won't count as spending or income.",
  };
  const TYPE_ICONS = {
    expense: "icons/tx/outcome.png",
    income: "icons/tx/income.png",
    saving: "icons/tx/saving.png",
    transfer: "icons/tx/transfer.png",
  };

  // A small self-contained month-grid calendar popup, used in place of the
  // native <input type=date> picker — some WebViews (notably the Android
  // Capacitor wrapper) don't reliably pop up a real calendar UI for it, so
  // rolling our own guarantees the same picker everywhere.
  function calendarPanelHtml(idPrefix, title) {
    return `
      <div class="tx-panel hidden" id="${idPrefix}-panel">
        <div class="tx-panel-head"><button type="button" class="tx-back" id="${idPrefix}-back">‹</button><span>${title}</span></div>
        <div class="cal-nav">
          <button type="button" class="icon-btn" id="${idPrefix}-prev">‹</button>
          <span class="cal-label" id="${idPrefix}-cal-label"></span>
          <button type="button" class="icon-btn" id="${idPrefix}-next">›</button>
        </div>
        <div class="cal-dow"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
        <div class="cal-grid" id="${idPrefix}-grid"></div>
      </div>
    `;
  }

  // Wires up a calendar panel built by calendarPanelHtml. `getSelectedIso`
  // supplies the currently-selected date (or null) each time the panel opens
  // and is redrawn; `onPick(iso)` fires when a day is tapped.
  function wireCalendarPanel(sheetBody, idPrefix, rowEl, getSelectedIso, onPick) {
    const panel = sheetBody.querySelector(`#${idPrefix}-panel`);
    const label = sheetBody.querySelector(`#${idPrefix}-cal-label`);
    const grid = sheetBody.querySelector(`#${idPrefix}-grid`);
    let viewDate = new Date(`${getSelectedIso() || todayISO()}T00:00:00`);
    viewDate.setDate(1);

    function draw() {
      label.textContent = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const startDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const selectedIso = getSelectedIso();
      const todayIso = todayISO();
      let html = "";
      for (let i = 0; i < startDow; i++) html += `<span class="cal-cell empty"></span>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
        const cls = ["cal-cell"];
        if (iso === selectedIso) cls.push("selected");
        if (iso === todayIso) cls.push("today");
        html += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}">${d}</button>`;
      }
      grid.innerHTML = html;
      grid.querySelectorAll("[data-iso]").forEach((btn) => btn.addEventListener("click", () => onPick(btn.dataset.iso)));
    }

    sheetBody.querySelector(`#${idPrefix}-prev`).addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); draw(); });
    sheetBody.querySelector(`#${idPrefix}-next`).addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); draw(); });
    sheetBody.querySelector(`#${idPrefix}-back`).addEventListener("click", () => panel.classList.add("hidden"));
    rowEl.addEventListener("click", () => {
      viewDate = new Date(`${getSelectedIso() || todayISO()}T00:00:00`);
      viewDate.setDate(1);
      draw();
      sheetBody.querySelectorAll(".tx-panel, .tx-calc-panel").forEach((p) => { if (p !== panel) p.classList.add("hidden"); });
      panel.classList.remove("hidden");
    });
  }

  // window.confirm() is unreliable across WebViews — it silently no-ops in
  // some (including, per a user report, the Android app wrapper), so every
  // delete button uses this tap-twice-to-confirm pattern instead.
  function wireDeleteButton(btn, onConfirm, label) {
    if (!btn) return;
    const original = btn.textContent;
    let confirming = false;
    let revertTimer;
    btn.addEventListener("click", () => {
      if (!confirming) {
        confirming = true;
        btn.textContent = label || "Tap again to confirm";
        revertTimer = setTimeout(() => {
          confirming = false;
          btn.textContent = original;
        }, 3000);
        return;
      }
      clearTimeout(revertTimer);
      onConfirm();
    });
  }

  const RECUR_FREQS = { weekly: "week", biweekly: "2 weeks", monthly: "month" };
  function recurringLabelText(v) {
    if (!v) return "Recurring";
    return `Every ${RECUR_FREQS[v.freq] || v.freq} from ${formatDateLong(v.nextDate)}`;
  }

  function openTransactionForm(state, existing, ocr) {
    ocr = ocr || {};
    const type = { v: existing ? existing.type : (ocr.type || "expense") };
    const categoryId = { v: existing ? existing.categoryId : null };
    const date = { v: existing ? existing.date : todayISO() };
    // Old shape was a bare ISO date string; normalize to {freq, nextDate}.
    const existingRecurring = existing && existing.recurring && typeof existing.recurring === "object" ? existing.recurring : null;
    const recurring = { v: existingRecurring };
    // Payee isn't shown in the UI anymore, but it's kept as a hidden value so
    // OCR-detected payees (and the category-memory they drive) still work.
    const payee = existing ? (existing.payee || "") : (ocr.payee || "");
    const currency = DB.getSettings().currency;

    function categoryChips() {
      return DB.listCategories(type.v)
        .map((c) => `<div class="chip cat-choice ${c.id === categoryId.v ? "active" : ""}" data-v="${c.id}">${c.icon} ${escapeHtml(c.name)}</div>`)
        .join("");
    }

    // Selected categories keep their own emoji icon; with none chosen yet,
    // fall back to the generic category glyph.
    function catIconHtml() {
      const cat = categoryId.v && DB.listCategories().find((c) => c.id === categoryId.v);
      return cat ? escapeHtml(cat.icon) : `<img class="tx-icon-img" src="icons/tx/catgetory-icon.png" alt="">`;
    }

    const receiptImage = ocr.receiptImage || (existing ? existing.receiptImage : null);
    const receiptHtml = receiptImage
      ? `<div class="receipt-preview"><img src="${receiptImage}" alt="Receipt" />${ocr.scanning ? `<div class="ocr-status" id="ocr-status">🔍 Scanning photo for the amount…</div>` : ""}</div>`
      : "";

    App.openSheet(
      `<div class="tx-sheet-head"><span>${existing ? "Edit transaction" : "Add transaction"}</span><button type="button" id="tx-close" class="tx-close-btn" aria-label="Close">&times;</button></div>`,
      `
      ${receiptHtml}
      <div class="seg seg-4 tx-type-seg">
        <button type="button" class="type-choice ${type.v === "expense" ? "active" : ""}" data-v="expense">outcome</button>
        <button type="button" class="type-choice ${type.v === "income" ? "active" : ""}" data-v="income">income</button>
        <button type="button" class="type-choice ${type.v === "saving" ? "active" : ""}" data-v="saving">saving</button>
        <button type="button" class="type-choice ${type.v === "transfer" ? "active" : ""}" data-v="transfer">transfers</button>
      </div>
      <div id="type-hint" class="type-hint">${TYPE_HINTS[type.v] || ""}</div>

      <div class="tx-row" id="tx-date-row">
        <img class="tx-row-icon" src="icons/tx/calendar.png" alt="" />
        <span class="tx-row-text" id="tx-date-label">${formatDateLong(date.v)}</span>
      </div>
      ${calendarPanelHtml("tx-date", "Select date")}

      <div class="tx-row tx-amount-row" id="tx-amount-row">
        <span class="tx-row-icon tx-icon-badge" id="tx-type-icon"><img class="tx-icon-img" src="${TYPE_ICONS[type.v]}" alt="" /></span>
        <span class="tx-row-text">Amount</span>
        <span class="tx-row-value" id="f-amount-value">0 ${currency}</span>
      </div>
      <div class="tx-calc-panel hidden" id="tx-calc-panel">
        ${calculatorHtml("f-amount", existing ? existing.amount : "")}
      </div>

      <div class="tx-row" id="tx-category-row">
        <span class="tx-row-icon tx-icon-badge" id="tx-cat-icon">${catIconHtml()}</span>
        <span class="tx-row-text" id="tx-cat-label">category</span>
        <span class="tx-row-chevron">›</span>
      </div>
      <div class="tx-panel hidden" id="tx-cat-panel">
        <div class="tx-panel-head"><button type="button" class="tx-back" id="tx-cat-back">‹</button><span>Select category</span></div>
        <div class="chip-grid" id="f-cats">${categoryChips()}</div>
      </div>

      <div class="tx-row tx-note-row">
        <input type="text" id="f-note" class="tx-note-input" placeholder="note" value="${existing ? escapeHtml(existing.note || "") : (ocr.receiptImage ? "Imported from slip photo" : "")}" />
      </div>

      <div class="tx-row" id="tx-recurring-row">
        <img class="tx-row-icon" src="icons/tx/recurring.png" alt="" />
        <span class="tx-row-text" id="tx-recurring-label">${recurringLabelText(recurring.v)}</span>
        <span class="tx-row-chevron">›</span>
      </div>
      <div class="tx-panel hidden" id="tx-recurring-panel">
        <div class="tx-panel-head"><button type="button" class="tx-back" id="tx-recurring-back">‹</button><span>Recurring</span></div>
        <div class="seg tx-type-seg" id="tx-freq-seg">
          <button type="button" class="freq-choice" data-v="weekly">Weekly</button>
          <button type="button" class="freq-choice" data-v="biweekly">2 weeks</button>
          <button type="button" class="freq-choice" data-v="monthly">Monthly</button>
        </div>
        <div class="cal-nav">
          <button type="button" class="icon-btn" id="tx-recurring-prev">‹</button>
          <span class="cal-label" id="tx-recurring-cal-label"></span>
          <button type="button" class="icon-btn" id="tx-recurring-next">›</button>
        </div>
        <div class="cal-dow"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
        <div class="cal-grid" id="tx-recurring-grid"></div>
        <button type="button" class="secondary danger tx-recurring-clear" id="tx-recurring-clear">Turn off recurring</button>
      </div>

      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, wire);

    function wire(sheetBody) {
      activeTxSheetBody = sheetBody;
      if (receiptImage) sheetBody.dataset.receiptImage = receiptImage;
      sheetBody.dataset.payee = payee;

      document.getElementById("tx-close").addEventListener("click", () => {
        activeTxSheetBody = null;
        App.closeSheet();
      });

      // Amount row: tap to reveal the calculator; keep the row's own display
      // (and the type-colored icon badge) in sync with whatever it computes.
      const amountRow = sheetBody.querySelector("#tx-amount-row");
      const calcPanel = sheetBody.querySelector("#tx-calc-panel");
      const amountInput = sheetBody.querySelector("#f-amount");
      const amountValueEl = sheetBody.querySelector("#f-amount-value");
      function syncAmountDisplay() {
        amountValueEl.textContent = `${amountInput.value || "0"} ${currency}`;
      }
      amountRow.addEventListener("click", () => {
        calcPanel.classList.toggle("hidden");
        sheetBody.querySelector("#tx-cat-panel").classList.add("hidden");
      });
      wireCalculator(sheetBody, amountInput);
      amountInput.addEventListener("input", syncAmountDisplay);
      syncAmountDisplay();

      // Date row: opens a custom calendar popup (a native <input type=date>
      // picker isn't reliable across WebViews, notably the Android app).
      const dateLabel = sheetBody.querySelector("#tx-date-label");
      wireCalendarPanel(sheetBody, "tx-date", sheetBody.querySelector("#tx-date-row"), () => date.v, (iso) => {
        date.v = iso;
        dateLabel.textContent = formatDateLong(iso);
        sheetBody.querySelector("#tx-date-panel").classList.add("hidden");
      });
      // Lets OCR (outside this closure) push a detected date into the same state.
      sheetBody.__setDate = (iso) => {
        date.v = iso;
        dateLabel.textContent = formatDateLong(iso);
      };

      // Recurring row: same calendar popup, plus a frequency choice. Picking a
      // day finalizes both; "Turn off recurring" clears it.
      const recurringLabel = sheetBody.querySelector("#tx-recurring-label");
      let freqChoice = (recurring.v && recurring.v.freq) || "monthly";
      const freqButtons = sheetBody.querySelectorAll("#tx-freq-seg .freq-choice");
      function paintFreqButtons() {
        freqButtons.forEach((b) => b.classList.toggle("active", b.dataset.v === freqChoice));
      }
      freqButtons.forEach((b) => b.addEventListener("click", () => {
        freqChoice = b.dataset.v;
        paintFreqButtons();
      }));
      paintFreqButtons();
      wireCalendarPanel(sheetBody, "tx-recurring", sheetBody.querySelector("#tx-recurring-row"), () => recurring.v && recurring.v.nextDate, (iso) => {
        recurring.v = { freq: freqChoice, nextDate: iso };
        recurringLabel.textContent = recurringLabelText(recurring.v);
        sheetBody.querySelector("#tx-recurring-panel").classList.add("hidden");
      });
      sheetBody.querySelector("#tx-recurring-clear").addEventListener("click", () => {
        recurring.v = null;
        recurringLabel.textContent = recurringLabelText(null);
        sheetBody.querySelector("#tx-recurring-panel").classList.add("hidden");
      });

      // Category row: tap to swap the main rows out for a picker panel.
      const catRow = sheetBody.querySelector("#tx-category-row");
      const catPanel = sheetBody.querySelector("#tx-cat-panel");
      function updateCatRow() {
        const cat = categoryId.v && DB.listCategories().find((c) => c.id === categoryId.v);
        sheetBody.querySelector("#tx-cat-icon").innerHTML = catIconHtml();
        sheetBody.querySelector("#tx-cat-label").textContent = cat ? cat.name : "category";
      }
      catRow.addEventListener("click", () => {
        catPanel.classList.remove("hidden");
        calcPanel.classList.add("hidden");
      });
      sheetBody.querySelector("#tx-cat-back").addEventListener("click", () => catPanel.classList.add("hidden"));

      function refreshCats() {
        sheetBody.querySelector("#f-cats").innerHTML = categoryChips();
        sheetBody.querySelectorAll(".cat-choice").forEach((b) => b.addEventListener("click", () => {
          categoryId.v = b.dataset.v;
          sheetBody.querySelectorAll(".cat-choice").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          updateCatRow();
          catPanel.classList.add("hidden");
        }));
      }
      sheetBody.querySelectorAll(".type-choice").forEach((b) => b.addEventListener("click", () => {
        type.v = b.dataset.v;
        categoryId.v = null;
        sheetBody.querySelectorAll(".type-choice").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        sheetBody.querySelector("#type-hint").textContent = TYPE_HINTS[type.v] || "";
        sheetBody.querySelector("#tx-type-icon img").src = TYPE_ICONS[type.v];
        refreshCats();
        updateCatRow();
      }));
      refreshCats();
      updateCatRow();

      sheetBody.querySelector("#save").addEventListener("click", () => {
        const amount = readAmountValue(amountInput);
        if (!amount || isNaN(amount)) return App.toast("Enter an amount");
        const payload = {
          type: type.v,
          amount,
          date: date.v,
          categoryId: categoryId.v,
          payee: sheetBody.dataset.payee || "",
          note: sheetBody.querySelector("#f-note").value.trim(),
          receiptImage: sheetBody.dataset.receiptImage || null,
          recurring: recurring.v || null,
        };
        if (existing) {
          DB.updateTransaction(existing.id, payload);
        } else {
          DB.addTransaction(payload);
        }
        activeTxSheetBody = null;
        App.closeSheet();
        App.render();
        runRecurringTransactions();
      });
      wireDeleteButton(sheetBody.querySelector("#delete"), () => {
        DB.deleteTransaction(existing.id);
        activeTxSheetBody = null;
        App.closeSheet();
        App.render();
      }, "Tap again to delete");
    }
  }

  function applyOcrResult(result) {
    if (!activeTxSheetBody || !document.body.contains(activeTxSheetBody)) return;
    const statusEl = activeTxSheetBody.querySelector("#ocr-status");
    if (result.amount) {
      const amountInput = activeTxSheetBody.querySelector("#f-amount");
      amountInput.value = result.amount;
      amountInput.dispatchEvent(new Event("input"));
    }
    if (result.date && activeTxSheetBody.__setDate) {
      activeTxSheetBody.__setDate(result.date);
    }
    if (result.payee) {
      activeTxSheetBody.dataset.payee = result.payee;
      const rememberedCat = DB.findCategoryForPayee(result.payee);
      if (rememberedCat) {
        const chip = activeTxSheetBody.querySelector(`.cat-choice[data-v="${rememberedCat}"]`);
        if (chip) chip.click();
      }
    }
    if (statusEl) {
      if (result.amount) {
        statusEl.textContent = `✓ Detected ${formatMoney(result.amount)}${result.date ? " on " + result.date : ""} — please verify`;
        statusEl.classList.add("detected");
      } else {
        statusEl.textContent = "Couldn't auto-detect the amount — please enter it manually.";
      }
    }
  }

  function addRecurInterval(iso, freq) {
    const d = new Date(iso + "T00:00:00");
    if (freq === "weekly") d.setDate(d.getDate() + 7);
    else if (freq === "biweekly") d.setDate(d.getDate() + 14);
    else d.setMonth(d.getMonth() + 1); // monthly (also the fallback for unknown freqs)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // Runs on app open (and right after saving a transaction) — the app has no
  // background process, so "automatic" recurring transactions only actually
  // get created the next time someone has the app open. For each transaction
  // with a recurring rule whose next-due date has arrived, logs a new
  // transaction for that date and advances the rule to the following one;
  // loops (capped) to catch up if the app wasn't opened for a while.
  function runRecurringTransactions() {
    const today = todayISO();
    let loggedAny = false;
    DB.listTransactions().forEach((t) => {
      if (!t.recurring || !t.recurring.nextDate) return;
      let rule = t.recurring;
      let guard = 0;
      while (rule.nextDate <= today && guard < 104) {
        const dueDate = rule.nextDate;
        DB.addTransaction({
          date: dueDate,
          type: t.type,
          amount: t.amount,
          categoryId: t.categoryId,
          payee: t.payee,
          note: t.note,
          autoLogged: true,
        });
        rule = { freq: rule.freq, nextDate: addRecurInterval(dueDate, rule.freq) };
        guard++;
        loggedAny = true;
      }
      if (guard > 0) DB.updateTransaction(t.id, { recurring: rule });
    });
    return loggedAny;
  }

  function blobToResizedDataUrl(blob, maxW) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function handleSharedPhoto(blob) {
    let dataUrl;
    try {
      dataUrl = await blobToResizedDataUrl(blob, 900);
    } catch (e) {
      App.toast("Couldn't read the shared photo");
      return;
    }
    openTransactionForm(App.state, null, { receiptImage: dataUrl, scanning: true });
    try {
      const result = await OCR.scanReceipt(dataUrl);
      applyOcrResult(result);
    } catch (e) {
      applyOcrResult({ amount: null, date: null });
      App.toast(e.message || "OCR failed");
    }
  }

  function defaultAutoCategoryId() {
    const bills = DB.listCategories("expense").find((c) => /bills?/i.test(c.name));
    return (bills || DB.listCategories("expense")[0] || {}).id || null;
  }

  // Native gallery auto-scan (no popup, ever): OCRs the photo and, if an amount
  // is found, logs the transaction straight to the ledger. Reuses the category
  // last used for the same payee, if we've seen them before.
  async function autoLogSlip(dataUrl) {
    try {
      const result = await OCR.scanReceipt(dataUrl);
      if (!result.amount) return { logged: false };
      const categoryId = (result.payee && DB.findCategoryForPayee(result.payee)) || defaultAutoCategoryId();
      DB.addTransaction({
        date: result.date || todayISO(),
        type: "expense",
        amount: result.amount,
        categoryId,
        payee: result.payee || "",
        note: "Auto-logged from slip photo",
        receiptImage: dataUrl,
        autoLogged: true,
      });
      return { logged: true, amount: result.amount, payee: result.payee };
    } catch (e) {
      return { logged: false, error: e.message };
    }
  }

  // ---------- STATS (long-term month-over-month trends) ----------
  function stats(state) {
    setHeader("Stats");
    const wrap = el(`<div></div>`);

    const months = [];
    for (let i = 11; i >= 0; i--) months.push(Utils.shiftMonth(Utils.monthKey(), -i));

    const allTx = DB.listTransactions();
    const perMonth = months.map((mk) => {
      const txs = allTx.filter((t) => t.date.slice(0, 7) === mk);
      const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
      const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      const saving = txs.filter((t) => t.type === "saving").reduce((s, t) => s + t.amount, 0);
      return { mk, income, expense, saving, net: income - expense };
    });

    const active = perMonth.filter((m) => m.income || m.expense || m.saving);
    if (!active.length) {
      wrap.appendChild(el(`<div class="empty-state"><div class="big">📊</div><div>No history yet.</div><div style="font-size:13px;margin-top:4px">Add some transactions and come back to see monthly trends.</div></div>`));
      return wrap;
    }
    const avgExpense = active.reduce((s, m) => s + m.expense, 0) / active.length;
    const avgIncome = active.reduce((s, m) => s + m.income, 0) / active.length;

    wrap.appendChild(el(`<div class="section-title">Last 12 Months</div>`));

    const expenseData = perMonth.map((m) => ({ label: Utils.monthLabelShort(m.mk), value: m.expense, valueLabel: formatMoney(m.expense), color: "var(--expense)" }));
    wrap.appendChild(el(`
      <div class="card">
        <h2>Expense by Month</h2>
        ${Charts.barChart(expenseData)}
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Average ${formatMoney(avgExpense)}/mo across ${active.length} active month${active.length === 1 ? "" : "s"}.</div>
      </div>
    `));

    const incomeData = perMonth.map((m) => ({ label: Utils.monthLabelShort(m.mk), value: m.income, valueLabel: formatMoney(m.income), color: "var(--income)" }));
    wrap.appendChild(el(`
      <div class="card">
        <h2>Income by Month</h2>
        ${Charts.barChart(incomeData)}
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Average ${formatMoney(avgIncome)}/mo across ${active.length} active month${active.length === 1 ? "" : "s"}.</div>
      </div>
    `));

    const maxAbsNet = Math.max(1, ...perMonth.map((m) => Math.abs(m.net)));
    const netRows = perMonth
      .map((m) => {
        const pct = Math.max(2, (Math.abs(m.net) / maxAbsNet) * 100);
        const color = m.net >= 0 ? "var(--income)" : "var(--expense)";
        return `<div class="bar-row"><div class="bar-label">${Utils.monthLabelShort(m.mk)}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="bar-value">${formatMoney(m.net)}</div></div>`;
      })
      .join("");
    wrap.appendChild(el(`<div class="card"><h2>Net by Month</h2><div class="bar-chart">${netRows}</div></div>`));

    return wrap;
  }

  // ---------- SETTINGS ----------
  function settings(state) {
    setHeader("Settings");
    const wrap = el(`<div></div>`);
    const s = DB.getSettings();

    const generalCard = el(`
      <div class="card">
        <h2>General</h2>
        <div class="field"><label>Currency Symbol</label><input type="text" id="f-currency" value="${escapeHtml(s.currency)}" maxlength="4" /></div>
        <button class="primary" id="save-general">Save</button>
      </div>
    `);
    generalCard.querySelector("#save-general").addEventListener("click", () => {
      DB.updateSettings({ currency: generalCard.querySelector("#f-currency").value || "฿" });
      App.toast("Saved");
      App.render();
    });
    wrap.appendChild(generalCard);

    const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.GalleryScan);

    if (isNativeApp) {
      const slipAlbumCard = el(`
        <div class="card">
          <h2>Bank Slip Albums</h2>
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">
            Auto-scan only checks the album(s) you pick here for new photos — not your whole gallery. Select every folder any of your banking apps save transfer slips to (often named after the bank, or "Screenshots"). You can pick more than one.
          </div>
          <div class="budget-line"><span>Current albums</span><span class="amt">${(s.slipAlbums && s.slipAlbums.length) ? escapeHtml(s.slipAlbums.join(", ")) : "Not set"}</span></div>
          <button class="secondary" id="choose-album" style="width:100%;margin-top:10px">Choose Albums</button>
        </div>
      `);
      slipAlbumCard.querySelector("#choose-album").addEventListener("click", async () => {
        const GalleryScan = window.Capacitor.Plugins.GalleryScan;
        try {
          let perm = await GalleryScan.checkPhotoPermission();
          if (!perm.granted) perm = await GalleryScan.requestPhotoPermission();
          if (!perm.granted) return App.toast("Photo permission needed to list albums");
          const { albums } = await GalleryScan.listAlbums();
          if (!albums || !albums.length) return App.toast("No albums found");
          const selected = new Set(DB.getSettings().slipAlbums || []);
          App.openSheet("Choose Bank Slip Albums", `
            <div class="list" style="max-height:48vh;overflow-y:auto;padding-right:2px">${albums.map((a) => `<div class="row-item album-choice" data-name="${escapeHtml(a.name)}" style="cursor:pointer"><div class="main"><div class="title">${escapeHtml(a.name)}</div></div><div class="pill ${selected.has(a.name) ? "paid" : "unpaid"}" data-check>${selected.has(a.name) ? "Selected" : ""}</div></div>`).join("")}</div>
            <div class="sheet-actions" style="margin-top:12px"><button class="primary" id="done-albums">Done (<span id="done-count">${selected.size}</span> selected)</button></div>
          `, (body) => {
            body.querySelectorAll(".album-choice").forEach((row) => row.addEventListener("click", () => {
              const name = row.dataset.name;
              const check = row.querySelector("[data-check]");
              if (selected.has(name)) {
                selected.delete(name);
                check.textContent = "";
                check.classList.remove("paid");
                check.classList.add("unpaid");
              } else {
                selected.add(name);
                check.textContent = "Selected";
                check.classList.remove("unpaid");
                check.classList.add("paid");
              }
              body.querySelector("#done-count").textContent = selected.size;
            }));
            body.querySelector("#done-albums").addEventListener("click", () => {
              DB.updateSettings({ slipAlbums: Array.from(selected) });
              App.closeSheet();
              App.toast(selected.size ? `Watching ${selected.size} album${selected.size === 1 ? "" : "s"}` : "No albums selected — auto-scan is off");
              App.render();
            });
          });
        } catch (e) {
          App.toast("Couldn't list albums: " + e.message);
        }
      });
      wrap.appendChild(slipAlbumCard);
    }

    wrap.appendChild(el(`
      <div class="card">
        <h2>Scan Slip Photos</h2>
        <div style="font-size:13px;color:var(--text-muted)">
          ${isNativeApp
            ? "Set your Bank Slip Album(s) above, then just open the app — new slips in those albums are read and logged automatically, no confirmation needed."
            : `Install this app to your Android home screen, then use your phone's <b>Share</b> button on a bank slip photo (from Gallery or your banking app) and choose <b>Ledger</b>. It will read the amount automatically and pre-fill a transaction for you to confirm. iOS Safari doesn't support sharing into web apps, so this only works on Android.`}
        </div>
      </div>
    `));

    const catCard = el(`<div class="card"><h2>Categories</h2></div>`);
    ["income", "expense", "saving", "transfer"].forEach((t) => {
      catCard.appendChild(el(`<div class="section-title" style="margin-top:6px">${t}</div>`));
      const grid = el(`<div class="chip-grid"></div>`);
      DB.listCategories(t).forEach((c) => {
        const chip = el(`<div class="chip">${c.icon} ${escapeHtml(c.name)}</div>`);
        chip.style.cursor = "pointer";
        chip.addEventListener("click", () => openCategoryForm(c));
        grid.appendChild(chip);
      });
      catCard.appendChild(grid);
    });
    const addCatBtn = el(`<button class="secondary" style="width:100%;margin-top:12px">＋ Add Category</button>`);
    addCatBtn.addEventListener("click", () => openCategoryForm());
    catCard.appendChild(addCatBtn);
    wrap.appendChild(catCard);

    const dataCard = el(`
      <div class="card">
        <h2>Data</h2>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">All data is stored locally in this browser only.</div>
        <div style="display:flex;gap:10px;margin-bottom:10px">
          <button class="secondary" id="export-btn" style="flex:1">Export Backup</button>
          <button class="secondary" id="import-btn" style="flex:1">Import Backup</button>
        </div>
        <input type="file" id="import-file" accept="application/json" style="display:none" />
        <button class="secondary danger" id="reset-btn" style="width:100%">Reset All Data</button>
      </div>
    `);
    dataCard.querySelector("#export-btn").addEventListener("click", exportData);
    dataCard.querySelector("#import-btn").addEventListener("click", () => dataCard.querySelector("#import-file").click());
    dataCard.querySelector("#import-file").addEventListener("change", importData);
    wireDeleteButton(dataCard.querySelector("#reset-btn"), () => {
      DB.reset();
      App.toast("All data reset");
      App.navigate("#/dashboard");
    }, "Tap again to erase everything");
    wrap.appendChild(dataCard);

    return wrap;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(DB.get(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        DB.replaceAll(parsed);
        App.toast("Backup imported");
        App.render();
      } catch (err) {
        App.toast("Invalid backup file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function openCategoryForm(existing) {
    const type = { v: existing ? existing.type : "expense" };
    App.openSheet(existing ? "Edit Category" : "New Category", `
      <div class="field">
        <div class="seg">
          <button type="button" class="type-choice ${type.v === "expense" ? "active expense" : ""}" data-v="expense">Expense</button>
          <button type="button" class="type-choice ${type.v === "income" ? "active income" : ""}" data-v="income">Income</button>
          <button type="button" class="type-choice ${type.v === "saving" ? "active saving" : ""}" data-v="saving">Saving</button>
          <button type="button" class="type-choice ${type.v === "transfer" ? "active transfer" : ""}" data-v="transfer">Transfer</button>
        </div>
      </div>
      <div class="field"><label>Icon (emoji)</label><input type="text" id="f-icon" value="${existing ? existing.icon : "🏷️"}" maxlength="4" /></div>
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, (body) => {
      body.querySelectorAll(".type-choice").forEach((b) => b.addEventListener("click", () => {
        type.v = b.dataset.v;
        body.querySelectorAll(".type-choice").forEach((x) => x.classList.remove("active", "income", "expense", "saving", "transfer"));
        b.classList.add("active", type.v);
      }));
      body.querySelector("#save").addEventListener("click", () => {
        const name = body.querySelector("#f-name").value.trim();
        const icon = body.querySelector("#f-icon").value.trim() || "🏷️";
        if (!name) return App.toast("Enter a name");
        if (existing) {
          DB.updateCategory(existing.id, { name, icon, type: type.v });
        } else {
          DB.addCategory({ name, icon, type: type.v });
        }
        App.closeSheet();
        App.render();
      });
      wireDeleteButton(body.querySelector("#delete"), () => {
        DB.deleteCategory(existing.id);
        App.closeSheet();
        App.render();
      }, "Tap again to delete");
    });
  }

  window.Views = {
    dashboard,
    pocketsList,
    pocketDetail,
    stats,
    settings,
    openTransactionForm,
    handleSharedPhoto,
    autoLogSlip,
    blobToResizedDataUrl,
    runRecurringTransactions,
    runAutoDebitBills,
  };
})();
