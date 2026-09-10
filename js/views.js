(function () {
  "use strict";

  const { el, formatMoney, formatDateShort, monthLabel, shiftMonth, todayISO, escapeHtml } = Utils;

  function setHeader(title, actionsHtml) {
    document.getElementById("page-title").textContent = title;
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

  function recurringIncomeStatus(item, mk) {
    const received = !!(item.receivedRecords && item.receivedRecords[mk]);
    if (received) return "received";
    const cmp = monthCompare(mk, Utils.monthKey());
    if (cmp < 0) return "overdue";
    if (cmp > 0) return "upcoming";
    if (item.dueDay && new Date().getDate() > item.dueDay) return "overdue";
    return "unreceived";
  }

  function toggleReceived(item, mk) {
    const isReceived = !!(item.receivedRecords && item.receivedRecords[mk]);
    if (isReceived) {
      const rec = item.receivedRecords[mk];
      if (rec && rec.transactionId) DB.deleteTransaction(rec.transactionId);
      DB.setRecurringIncomeReceived(item.id, mk, false);
      App.toast("Unmarked");
    } else {
      const cat = item.categoryId ? categoryById(item.categoryId) : null;
      const tx = DB.addTransaction({
        date: transactionDateForMonth(mk, item.dueDay),
        type: "income",
        amount: item.amount,
        categoryId: cat ? cat.id : null,
        note: item.name,
      });
      DB.setRecurringIncomeReceived(item.id, mk, true, tx.id);
      App.toast("Logged to ledger");
    }
    App.render();
  }

  function recurringIncomeRow(item, mk) {
    const status = recurringIncomeStatus(item, mk);
    const pillClass = status === "received" ? "paid" : status === "overdue" ? "overdue" : "unpaid";
    const pillText = status === "received" ? "Logged" : status === "overdue" ? "Not yet logged" : status === "upcoming" ? "Upcoming" : "Not logged";
    const cat = item.categoryId ? categoryById(item.categoryId) : null;
    const row = el(`
      <div class="row-item">
        <div class="emoji">${cat ? cat.icon : "💰"}</div>
        <div class="main">
          <div class="title">${escapeHtml(item.name)}</div>
          <div class="sub">${item.dueDay ? "usually by day " + item.dueDay : ""} · <span class="pill ${pillClass}">${pillText}</span></div>
        </div>
        <div class="amt income">${formatMoney(item.amount)}</div>
      </div>
    `);
    row.style.cursor = "pointer";
    row.addEventListener("click", () => toggleReceived(item, mk));
    return row;
  }

  function txInMonth(tx, mk) {
    return tx.date && tx.date.slice(0, 7) === mk;
  }

  function categoryById(id) {
    return DB.listCategories().find((c) => c.id === id);
  }

  // ---------- HOME (statement + budget overview) ----------
  function dashboard(state) {
    setHeader("Ledger");
    const wrap = el(`<div></div>`);
    wrap.appendChild(monthSwitcher(state));

    const recurringIncomes = DB.listRecurringIncomes();
    if (recurringIncomes.length) {
      const pending = recurringIncomes.filter((r) => recurringIncomeStatus(r, state.month) !== "received");
      if (pending.length) {
        const incomeCard = el(`<div class="card"><h2>Recurring Income</h2></div>`);
        const list = el(`<div class="list"></div>`);
        pending.forEach((r) => list.appendChild(recurringIncomeRow(r, state.month)));
        incomeCard.appendChild(list);
        wrap.appendChild(incomeCard);
      }
    }

    const txs = DB.listTransactions().filter((t) => txInMonth(t, state.month));
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const saved = txs.filter((t) => t.type === "saving").reduce((s, t) => s + t.amount, 0);
    const net = income - expense;

    wrap.appendChild(el(`
      <div class="card">
        <h2>This Month</h2>
        <div class="summary-grid">
          <div class="stat"><div class="label">Income</div><div class="value income">${formatMoney(income)}</div></div>
          <div class="stat"><div class="label">Expense</div><div class="value expense">${formatMoney(expense)}</div></div>
        </div>
        ${saved > 0 ? `<div class="budget-line"><span>Saved</span><span class="amt saving">${formatMoney(saved)}</span></div>` : ""}
        <div class="budget-line remaining ${net < 0 ? "negative" : ""}" style="margin-top:10px">
          <span>Remaining after expenses</span><span class="amt">${formatMoney(net)}</span>
        </div>
      </div>
    `));

    // Statement list: day -> category -> amount -> note
    const statementCard = el(`<div class="card"><h2>Statement</h2></div>`);
    if (!txs.length) {
      statementCard.appendChild(el(`<div class="chart-empty">No transactions this month yet. Tap + to add one.</div>`));
    } else {
      const byDate = {};
      txs.forEach((t) => (byDate[t.date] = byDate[t.date] || []).push(t));
      const list = el(`<div></div>`);
      Object.keys(byDate)
        .sort((a, b) => (a < b ? 1 : -1))
        .forEach((date) => {
          list.appendChild(el(`<div class="section-title">${formatDateShort(date)}</div>`));
          const dayList = el(`<div class="list"></div>`);
          byDate[date].forEach((t) => {
            const c = categoryById(t.categoryId);
            const pocket = t.pocketId ? DB.getPocket(t.pocketId) : null;
            const fallbackIcon = t.type === "income" ? "💰" : t.type === "saving" ? "🐷" : "💸";
            const subParts = [];
            if (pocket) subParts.push(escapeHtml(pocket.name));
            if (t.payee) subParts.push(escapeHtml(t.payee));
            if (t.note) subParts.push(escapeHtml(t.note));
            const row = el(`
              <div class="row-item">
                <div class="emoji">${c ? c.icon : fallbackIcon}</div>
                <div class="main">
                  <div class="title">${c ? escapeHtml(c.name) : "Uncategorized"}${t.tag ? " · " + escapeHtml(t.tag) : ""}${t.receiptImage ? " 📷" : ""}${t.autoLogged ? " 🤖" : ""}</div>
                  <div class="sub">${subParts.join(" · ")}</div>
                </div>
                <div class="amt ${t.type}">${t.type === "income" ? "+" : "-"}${formatMoney(t.amount)}</div>
              </div>
            `);
            row.style.cursor = "pointer";
            row.addEventListener("click", () => openTransactionForm(state, t));
            dayList.appendChild(row);
          });
          list.appendChild(dayList);
        });
      statementCard.appendChild(list);
    }
    wrap.appendChild(statementCard);

    // Category pie chart with monthly-average comparison
    const catTotals = {};
    txs.filter((t) => t.type === "expense").forEach((t) => {
      const c = categoryById(t.categoryId);
      const key = c ? c.id : "uncategorized";
      catTotals[key] = (catTotals[key] || 0) + t.amount;
    });
    const allExpenseTx = DB.listTransactions().filter((t) => t.type === "expense");
    const activeMonths = new Set(allExpenseTx.map((t) => t.date.slice(0, 7)));
    const monthCount = Math.max(1, activeMonths.size);
    const catData = Object.entries(catTotals).map(([catId, value]) => {
      const c = catId === "uncategorized" ? null : categoryById(catId);
      const label = c ? `${c.icon} ${c.name}` : "🏷️ Uncategorized";
      const histTotal = allExpenseTx
        .filter((t) => (t.categoryId || "uncategorized") === catId)
        .reduce((s, t) => s + t.amount, 0);
      const avg = histTotal / monthCount;
      const diffPct = avg > 0 ? Math.round(((value - avg) / avg) * 100) : null;
      let sub = `avg ${formatMoney(avg)}/mo`;
      let subClass = "";
      if (diffPct != null && Math.abs(diffPct) >= 1) {
        subClass = diffPct > 0 ? "up" : "down";
        sub += ` · ${diffPct > 0 ? "+" : ""}${diffPct}% vs avg`;
      }
      return { label, value, sub: `<span class="${subClass}">${sub}</span>` };
    });
    wrap.appendChild(el(`<div class="card"><h2>Expense by Category</h2>${Charts.pieChart(catData)}<div style="font-size:11px;color:var(--text-muted);margin-top:10px">Average is calculated across ${monthCount} month${monthCount === 1 ? "" : "s"} of history.</div></div>`));

    // Income & pocket overview
    const pockets = DB.listPockets();
    const items = pockets.flatMap((p) => DB.listPocketItems(p.id));
    const totalPocketCost = items.filter((i) => i.kind !== "saving").reduce((s, i) => s + i.amount, 0);
    const totalPocketSaving = items.filter((i) => i.kind === "saving").reduce((s, i) => s + i.amount, 0);
    const remainingAfterPockets = income - totalPocketCost - totalPocketSaving;
    const spentPct = income > 0 ? Math.min(100, (expense / income) * 100) : 0;

    wrap.appendChild(el(`
      <div class="card">
        <h2>Overview</h2>
        <div class="budget-line"><span>Total Income</span><span class="amt">${formatMoney(income)}</span></div>
        <div class="budget-line"><span>Pocket fixed costs</span><span class="amt">-${formatMoney(totalPocketCost)}</span></div>
        ${totalPocketSaving > 0 ? `<div class="budget-line"><span>Pocket savings</span><span class="amt saving">-${formatMoney(totalPocketSaving)}</span></div>` : ""}
        <div class="budget-line remaining ${remainingAfterPockets < 0 ? "negative" : ""}"><span>Remaining after pockets</span><span class="amt">${formatMoney(remainingAfterPockets)}</span></div>
        <div class="progress-track"><div class="progress-fill ${income > 0 && expense > income ? "over" : ""}" style="width:${spentPct}%"></div></div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${formatMoney(expense)} spent of ${formatMoney(income)} income</div>
      </div>
    `));

    return wrap;
  }

  function billStatusLabel(status, isSaving) {
    if (status === "paid") return isSaving ? "Saved" : "Paid";
    if (status === "overdue") return isSaving ? "Not saved yet" : "Overdue";
    if (status === "upcoming") return "Upcoming";
    return isSaving ? "Not saved" : "Unpaid";
  }

  function pocketItemRow(item, pocket, mk) {
    const status = pocketItemStatus(item, mk);
    const isSaving = item.kind === "saving";
    const pillClass = status === "paid" ? "paid" : status === "overdue" ? "overdue" : "unpaid";
    const pillText = billStatusLabel(status, isSaving);
    const cat = item.categoryId ? categoryById(item.categoryId) : null;
    const installBadge = item.installments ? `<span class="pill installment">${paidMonthsCount(item)}/${item.installments}</span>` : "";
    const kindBadge = isSaving ? `<span class="pill installment">🐷 Reminder</span>` : "";
    const row = el(`
      <div class="row-item">
        <div class="emoji">${cat ? cat.icon : isSaving ? "🐷" : pocket ? pocket.icon : "💼"}</div>
        <div class="main">
          <div class="title">${escapeHtml(item.name)}</div>
          <div class="sub">${pocket ? escapeHtml(pocket.name) : ""}${item.dueDay ? " · due " + item.dueDay : ""} · <span class="pill ${pillClass}">${pillText}</span> ${installBadge} ${kindBadge}</div>
        </div>
        <div style="text-align:right">
          <div class="amt">${formatMoney(item.amount)}</div>
        </div>
      </div>
    `);
    row.style.cursor = "pointer";
    row.addEventListener("click", () => togglePaid(item, mk));
    return row;
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
    const cat = item.categoryId ? categoryById(item.categoryId) : null;
    const txType = isSaving ? "saving" : "expense";
    const fallbackCat = cat || (isSaving
      ? DB.listCategories("saving")[0]
      : DB.listCategories("expense").find((c) => /bills?/i.test(c.name)) || DB.listCategories("expense")[0]);
    const pocket = DB.getPocket(item.pocketId);
    const tx = DB.addTransaction({
      date: transactionDateForMonth(mk, item.dueDay),
      type: txType,
      amount: item.amount,
      categoryId: fallbackCat ? fallbackCat.id : null,
      note: item.name,
      pocketId: item.pocketId,
      pocketItemId: item.id,
    });
    DB.setPocketItemPaid(item.id, mk, true, tx.id);

    const fresh = DB.getPocketItem(item.id);
    if (fresh && fresh.installments && paidMonthsCount(fresh) >= fresh.installments) {
      DB.deletePocketItem(item.id);
      App.toast(`Installment plan complete — "${item.name}" cleared from ${pocket ? pocket.name : "pocket"}`);
    } else {
      App.toast(isSaving ? "Marked as saved & logged" : "Marked paid & logged to ledger");
    }
    App.render();
  }

  // ---------- POCKETS ----------
  function pocketsList(state) {
    setHeader("Pockets", `<button class="icon-btn" id="add-pocket">＋</button>`);
    const wrap = el(`<div></div>`);
    wrap.appendChild(monthSwitcher(state));

    const pockets = DB.listPockets();
    const allItems = pockets.flatMap((p) => DB.listPocketItems(p.id));

    const dueRows = allItems
      .map((i) => ({ item: i, pocket: pockets.find((p) => p.id === i.pocketId), status: pocketItemStatus(i, state.month) }))
      .filter((r) => r.status !== "paid")
      .sort((a, b) => (a.item.dueDay || 99) - (b.item.dueDay || 99));

    const billsCard = el(`<div class="card"><h2>Bills To Pay</h2></div>`);
    if (!pockets.length) {
      billsCard.appendChild(el(`<div class="chart-empty">No pockets yet. Create one below to track recurring bills.</div>`));
    } else if (!dueRows.length) {
      billsCard.appendChild(el(`<div class="chart-empty">All bills paid this month 🎉</div>`));
    } else {
      const list = el(`<div class="list"></div>`);
      dueRows.forEach((r) => list.appendChild(pocketItemRow(r.item, r.pocket, state.month)));
      billsCard.appendChild(list);
    }
    wrap.appendChild(billsCard);

    wrap.appendChild(el(`<div class="section-title">Pockets</div>`));
    if (!pockets.length) {
      wrap.appendChild(el(`
        <div class="empty-state">
          <div class="big">💼</div>
          <div>No pockets yet.</div>
          <div style="font-size:13px;margin-top:4px">Create pockets like "Fixed Cost", "Investment" or "Big Spend" to track recurring monthly bills.</div>
        </div>
      `));
    } else {
      const list = el(`<div class="list"></div>`);
      pockets.forEach((p) => {
        const items = DB.listPocketItems(p.id);
        const total = items.reduce((s, i) => s + i.amount, 0);
        const paidCount = items.filter((i) => pocketItemStatus(i, state.month) === "paid").length;
        const row = el(`
          <div class="row-item">
            <div class="emoji" style="background:${p.color}22;border-radius:8px">${p.icon}</div>
            <div class="main">
              <div class="title">${escapeHtml(p.name)}</div>
              <div class="sub">${items.length} bill${items.length === 1 ? "" : "s"} · ${paidCount}/${items.length} paid</div>
            </div>
            <div class="amt">${formatMoney(total)}</div>
          </div>
        `);
        row.style.cursor = "pointer";
        row.addEventListener("click", () => App.navigate(`#/pocket/${p.id}`));
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }

    document.getElementById("add-pocket").addEventListener("click", () => openPocketForm());
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
      const delBtn = body.querySelector("#delete");
      if (delBtn) delBtn.addEventListener("click", () => {
        if (confirm("Delete this pocket and all its bills?")) {
          DB.deletePocket(existing.id);
          App.closeSheet();
          App.navigate("#/pockets");
        }
      });
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
      body.querySelector("#delete-item").addEventListener("click", () => {
        if (confirm("Delete this bill?")) {
          DB.deletePocketItem(item.id);
          App.closeSheet();
          App.render();
        }
      });
    });
  }

  function openPocketItemForm(pocketId, existing) {
    const kind = { v: existing && existing.kind === "saving" ? "saving" : "bill" };
    const categoryId = { v: existing ? existing.categoryId : null };
    function catChips() {
      return DB.listCategories(kind.v === "saving" ? "saving" : "expense")
        .map((c) => `<div class="chip cat-choice ${c.id === categoryId.v ? "active" : ""}" data-v="${c.id}">${c.icon} ${escapeHtml(c.name)}</div>`)
        .join("");
    }
    App.openSheet(existing ? "Edit Bill" : "New Bill", `
      <div class="field">
        <label>Type</label>
        <div class="seg">
          <button type="button" class="kind-choice ${kind.v === "bill" ? "active expense" : ""}" data-v="bill">Bill</button>
          <button type="button" class="kind-choice ${kind.v === "saving" ? "active saving" : ""}" data-v="saving">Savings Reminder</button>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px">A Bill logs a real expense when paid. A Savings Reminder just reminds you to set money aside before spending — it won't count as spending.</div>
      </div>
      <div class="field"><label>Name</label><input type="text" id="f-name" placeholder="e.g. Rent" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="field"><label>Amount</label><input type="number" id="f-amount" inputmode="decimal" value="${existing ? existing.amount : ""}" /></div>
      <div class="field"><label>Category</label><div class="chip-grid" id="f-cats">${catChips()}</div></div>
      <div class="field"><label>Due day of month (optional)</label><input type="number" id="f-due" min="1" max="31" value="${existing && existing.dueDay ? existing.dueDay : ""}" /></div>
      <div class="field">
        <label>Installments (optional)</label>
        <input type="number" id="f-installments" min="1" placeholder="e.g. 5 — clears after 5 payments" value="${existing && existing.installments ? existing.installments : ""}" />
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">Leave blank to repeat every month until you delete it. Set a number for an installment plan (e.g. a 5-month payment) that auto-clears once fully paid.</div>
      </div>
      <div class="field"><label>Note (optional)</label><textarea id="f-note">${existing ? escapeHtml(existing.note || "") : ""}</textarea></div>
      <div class="sheet-actions"><button class="primary" id="save">Save</button></div>
    `, (body) => {
      function refreshCats() {
        body.querySelector("#f-cats").innerHTML = catChips();
        body.querySelectorAll(".cat-choice").forEach((b) => b.addEventListener("click", () => {
          categoryId.v = b.dataset.v;
          body.querySelectorAll(".cat-choice").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        }));
      }
      body.querySelectorAll(".kind-choice").forEach((b) => b.addEventListener("click", () => {
        kind.v = b.dataset.v;
        categoryId.v = null;
        body.querySelectorAll(".kind-choice").forEach((x) => x.classList.remove("active", "expense", "saving"));
        b.classList.add("active", kind.v === "saving" ? "saving" : "expense");
        refreshCats();
      }));
      refreshCats();
      body.querySelector("#save").addEventListener("click", () => {
        const name = body.querySelector("#f-name").value.trim();
        const amount = Number(body.querySelector("#f-amount").value);
        if (!name || !amount) return App.toast("Enter name and amount");
        const dueRaw = body.querySelector("#f-due").value;
        const installRaw = body.querySelector("#f-installments").value;
        const note = body.querySelector("#f-note").value.trim();
        const payload = {
          name,
          amount,
          kind: kind.v,
          categoryId: categoryId.v,
          dueDay: dueRaw ? Number(dueRaw) : null,
          installments: installRaw ? Number(installRaw) : null,
          note,
        };
        if (existing) {
          DB.updatePocketItem(existing.id, payload);
        } else {
          DB.addPocketItem(Object.assign({ pocketId }, payload));
        }
        App.closeSheet();
        App.render();
      });
    });
  }

  // ---------- TRANSACTION FORM (with optional receipt/OCR pre-fill) ----------
  let activeTxSheetBody = null;

  function openTransactionForm(state, existing, ocr) {
    ocr = ocr || {};
    const type = { v: existing ? existing.type : "expense" };
    const categoryId = { v: existing ? existing.categoryId : null };
    const pockets = DB.listPockets();

    function categoryChips() {
      return DB.listCategories(type.v)
        .map((c) => `<div class="chip cat-choice ${c.id === categoryId.v ? "active" : ""}" data-v="${c.id}">${c.icon} ${escapeHtml(c.name)}</div>`)
        .join("");
    }

    const receiptImage = ocr.receiptImage || (existing ? existing.receiptImage : null);
    const receiptHtml = receiptImage
      ? `<div class="receipt-preview"><img src="${receiptImage}" alt="Receipt" />${ocr.scanning ? `<div class="ocr-status" id="ocr-status">🔍 Scanning photo for the amount…</div>` : ""}</div>`
      : "";

    App.openSheet(existing ? "Edit Transaction" : "Add Transaction", `
      ${receiptHtml}
      <div class="field">
        <div class="seg">
          <button type="button" class="type-choice ${type.v === "expense" ? "active expense" : ""}" data-v="expense">Expense</button>
          <button type="button" class="type-choice ${type.v === "income" ? "active income" : ""}" data-v="income">Income</button>
          <button type="button" class="type-choice ${type.v === "saving" ? "active saving" : ""}" data-v="saving">Saving</button>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px">Saving is money you set aside — it won't count as spending in your totals.</div>
      </div>
      <div class="field"><label>Amount</label><input type="number" id="f-amount" inputmode="decimal" value="${existing ? existing.amount : ""}" /></div>
      <div class="field"><label>Date</label><input type="date" id="f-date" value="${existing ? existing.date : todayISO()}" /></div>
      <div class="field"><label>Category</label><div class="chip-grid" id="f-cats">${categoryChips()}</div></div>
      <div class="field"><label>Pocket (optional)</label>
        <select id="f-pocket">
          <option value="">None</option>
          ${pockets.map((p) => `<option value="${p.id}" ${existing && existing.pocketId === p.id ? "selected" : ""}>${p.icon} ${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Payee / Recipient (optional)</label><input type="text" id="f-payee" value="${existing ? escapeHtml(existing.payee || "") : escapeHtml(ocr.payee || "")}" placeholder="e.g. 7-Eleven" /><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Future slips from the same payee will reuse whatever category you pick here.</div></div>
      <div class="field"><label>Tag (optional)</label><input type="text" id="f-tag" value="${existing ? escapeHtml(existing.tag || "") : ""}" placeholder="e.g. groceries" /></div>
      <div class="field"><label>Note (optional)</label><textarea id="f-note">${existing ? escapeHtml(existing.note || "") : (ocr.receiptImage ? "Imported from slip photo" : "")}</textarea></div>
      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, wire);

    function wire(sheetBody) {
      activeTxSheetBody = sheetBody;
      if (receiptImage) sheetBody.dataset.receiptImage = receiptImage;

      function refreshCats() {
        sheetBody.querySelector("#f-cats").innerHTML = categoryChips();
        sheetBody.querySelectorAll(".cat-choice").forEach((b) => b.addEventListener("click", () => {
          categoryId.v = b.dataset.v;
          sheetBody.querySelectorAll(".cat-choice").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        }));
      }
      sheetBody.querySelectorAll(".type-choice").forEach((b) => b.addEventListener("click", () => {
        type.v = b.dataset.v;
        categoryId.v = null;
        sheetBody.querySelectorAll(".type-choice").forEach((x) => x.classList.remove("active", "income", "expense", "saving"));
        b.classList.add("active", type.v);
        refreshCats();
      }));
      refreshCats();

      sheetBody.querySelector("#save").addEventListener("click", () => {
        const amount = Number(sheetBody.querySelector("#f-amount").value);
        const date = sheetBody.querySelector("#f-date").value || todayISO();
        if (!amount) return App.toast("Enter an amount");
        const payload = {
          type: type.v,
          amount,
          date,
          categoryId: categoryId.v,
          pocketId: sheetBody.querySelector("#f-pocket").value || null,
          payee: sheetBody.querySelector("#f-payee").value.trim(),
          tag: sheetBody.querySelector("#f-tag").value.trim(),
          note: sheetBody.querySelector("#f-note").value.trim(),
          receiptImage: sheetBody.dataset.receiptImage || null,
        };
        if (existing) {
          DB.updateTransaction(existing.id, payload);
        } else {
          DB.addTransaction(payload);
        }
        activeTxSheetBody = null;
        App.closeSheet();
        App.render();
      });
      const delBtn = sheetBody.querySelector("#delete");
      if (delBtn) delBtn.addEventListener("click", () => {
        if (confirm("Delete this transaction?")) {
          DB.deleteTransaction(existing.id);
          activeTxSheetBody = null;
          App.closeSheet();
          App.render();
        }
      });
    }
  }

  function applyOcrResult(result) {
    if (!activeTxSheetBody || !document.body.contains(activeTxSheetBody)) return;
    const statusEl = activeTxSheetBody.querySelector("#ocr-status");
    if (result.amount) {
      activeTxSheetBody.querySelector("#f-amount").value = result.amount;
    }
    if (result.date) {
      activeTxSheetBody.querySelector("#f-date").value = result.date;
    }
    if (result.payee) {
      activeTxSheetBody.querySelector("#f-payee").value = result.payee;
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

    const incomeCard = el(`<div class="card"><h2>Recurring Income</h2></div>`);
    const recurring = DB.listRecurringIncomes();
    if (!recurring.length) {
      incomeCard.appendChild(el(`<div class="chart-empty">No recurring income yet, e.g. a monthly salary.</div>`));
    } else {
      const list = el(`<div class="list"></div>`);
      recurring.forEach((r) => {
        const cat = r.categoryId ? categoryById(r.categoryId) : null;
        const row = el(`
          <div class="row-item">
            <div class="emoji">${cat ? cat.icon : "💰"}</div>
            <div class="main">
              <div class="title">${escapeHtml(r.name)}</div>
              <div class="sub">${r.dueDay ? "usually by day " + r.dueDay : "no fixed day"}</div>
            </div>
            <div class="amt income">${formatMoney(r.amount)}</div>
          </div>
        `);
        row.style.cursor = "pointer";
        row.addEventListener("click", () => openRecurringIncomeForm(r));
        list.appendChild(row);
      });
      incomeCard.appendChild(list);
    }
    const addIncomeBtn = el(`<button class="secondary" style="width:100%;margin-top:12px">＋ Add Recurring Income</button>`);
    addIncomeBtn.addEventListener("click", () => openRecurringIncomeForm());
    incomeCard.appendChild(addIncomeBtn);
    wrap.appendChild(incomeCard);

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
    ["income", "expense", "saving"].forEach((t) => {
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
    dataCard.querySelector("#reset-btn").addEventListener("click", () => {
      if (confirm("This will permanently delete all data. Continue?")) {
        DB.reset();
        App.toast("All data reset");
        App.navigate("#/dashboard");
      }
    });
    wrap.appendChild(dataCard);

    return wrap;
  }

  function openRecurringIncomeForm(existing) {
    const categoryId = { v: existing ? existing.categoryId : null };
    function catChips() {
      return DB.listCategories("income")
        .map((c) => `<div class="chip cat-choice ${c.id === categoryId.v ? "active" : ""}" data-v="${c.id}">${c.icon} ${escapeHtml(c.name)}</div>`)
        .join("");
    }
    App.openSheet(existing ? "Edit Recurring Income" : "New Recurring Income", `
      <div class="field"><label>Name</label><input type="text" id="f-name" placeholder="e.g. Salary" value="${existing ? escapeHtml(existing.name) : ""}" /></div>
      <div class="field"><label>Amount</label><input type="number" id="f-amount" inputmode="decimal" value="${existing ? existing.amount : ""}" /></div>
      <div class="field"><label>Category</label><div class="chip-grid" id="f-cats">${catChips()}</div></div>
      <div class="field"><label>Usually received by day (optional)</label><input type="number" id="f-due" min="1" max="31" value="${existing && existing.dueDay ? existing.dueDay : ""}" /></div>
      <div class="sheet-actions">
        ${existing ? `<button class="secondary danger" id="delete">Delete</button>` : ""}
        <button class="primary" id="save">Save</button>
      </div>
    `, (body) => {
      body.querySelectorAll(".cat-choice").forEach((b) => b.addEventListener("click", () => {
        categoryId.v = b.dataset.v;
        body.querySelectorAll(".cat-choice").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      }));
      body.querySelector("#save").addEventListener("click", () => {
        const name = body.querySelector("#f-name").value.trim();
        const amount = Number(body.querySelector("#f-amount").value);
        if (!name || !amount) return App.toast("Enter name and amount");
        const dueRaw = body.querySelector("#f-due").value;
        const payload = { name, amount, categoryId: categoryId.v, dueDay: dueRaw ? Number(dueRaw) : null };
        if (existing) {
          DB.updateRecurringIncome(existing.id, payload);
        } else {
          DB.addRecurringIncome(payload);
        }
        App.closeSheet();
        App.render();
      });
      const delBtn = body.querySelector("#delete");
      if (delBtn) delBtn.addEventListener("click", () => {
        if (confirm("Delete this recurring income?")) {
          DB.deleteRecurringIncome(existing.id);
          App.closeSheet();
          App.render();
        }
      });
    });
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
        body.querySelectorAll(".type-choice").forEach((x) => x.classList.remove("active", "income", "expense", "saving"));
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
      const delBtn = body.querySelector("#delete");
      if (delBtn) delBtn.addEventListener("click", () => {
        if (confirm("Delete this category?")) {
          DB.deleteCategory(existing.id);
          App.closeSheet();
          App.render();
        }
      });
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
  };
})();
