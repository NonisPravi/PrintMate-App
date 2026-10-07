(() => {
  "use strict";

  const SUPABASE_URL = "https://ebofjttnqsfnvyryaksc.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVib2ZqdHRucXNmbnZ5cnlha3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODIyMzksImV4cCI6MjEwNjg1ODIzOX0.D6F15-aOfj22BXTBgmed2DV9Bbz1duWY2imyPk6uoio";
  const LOW_STOCK = { A4: 200, A5: 100 };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    supabase: null,
    user: null,
    profile: null,
    services: [],
    inventory: [],
    cart: [],
    category: "photocopy",
    config: { size: "A4", color: "bw", side: "single" },
    customerMatches: [],
    ledgerCustomers: [],
    selectedCustomer: null,
    customerPhone: "",
    paymentTouched: false,
    verifiedPricePin: null,
    resetPinUserId: null,
    pendingPinAction: null,
    dangerAction: null,
    activeSection: "pos"
  };

  const el = {
    loadingScreen: $("#loading-screen"),
    authScreen: $("#auth-screen"), mainScreen: $("#main-screen"),
    loginForm: $("#login-form"), registerForm: $("#register-form"), recoveryForm: $("#recovery-form"),
    authTitle: $("#auth-title"), authSubtitle: $("#auth-subtitle"),
    authSwitchCopy: $("#auth-switch-copy"), authSwitchButton: $("#auth-switch-button"),
    authMessage: $("#auth-message"), adminNav: $("#admin-nav"),
    posSection: $("#pos-section"), managementSection: $("#management-section"),
    historySection: $("#history-section"), serviceGrid: $("#service-grid"),
    cartItems: $("#cart-items"), cartTotal: $("#cart-total"),
    checkoutButton: $("#checkout-button"), toastRegion: $("#toast-region"),
    inventoryDialog: $("#inventory-dialog"), pinDialog: $("#pin-dialog"),
    dangerDialog: $("#danger-dialog"), priceDialog: $("#price-dialog"),
    stockSummary: $("#stock-summary"), lowStockAlert: $("#low-stock-alert"),
    customerSearch: $("#customer-search"), customerBalance: $("#customer-balance"),
    amountPaid: $("#amount-paid"), settlementSummary: $("#settlement-summary"),
    serviceConfig: $("#service-config"), ledgerSection: $("#ledger-section")
  };

  const isAdmin = () => ["admin", "super_admin"].includes(state.profile?.role);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const currency = (value) => `Rs. ${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const asError = (error) => error?.message || "Something went wrong. Please try again.";
  const notify = (message, isError = false) => {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.textContent = message;
    el.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  };
  const setAuthMessage = (message, type = "") => {
    el.authMessage.textContent = message;
    el.authMessage.className = `notice${type ? ` ${type}` : ""}`;
  };
  const callRpc = async (name, args = {}) => {
    const { data, error } = await state.supabase.rpc(name, args);
    if (error) throw error;
    return data;
  };

  function init() {
    bindEvents();
    if (!window.supabase || SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_") || /^\*+$/.test(SUPABASE_ANON_KEY)) {
      showAuth();
      hideLoadingScreen();
      setAuthMessage("Connect your Supabase project by adding its URL and anon key at the top of app.js, then run supabase-schema.sql.", "error");
      return;
    }
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    state.supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showRecovery();
      }
      if (event === "SIGNED_OUT") resetToAuth();
    });
    (async () => {
      try {
        const { data, error } = await state.supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user) await loadProfile(data.session.user);
        else showAuth();
      } catch (error) {
        showAuth();
        setAuthMessage(`Could not restore your session: ${asError(error)}`, "error");
      } finally {
        hideLoadingScreen();
      }
    })();
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", signIn);
    el.registerForm.addEventListener("submit", register);
    el.recoveryForm.addEventListener("submit", updatePassword);
    const stockForm = document.getElementById("stock-form");
    if (stockForm) stockForm.addEventListener("submit", submitStock);
    $("#pin-form").addEventListener("submit", verifyPinForAction);
    $("#danger-form").addEventListener("submit", performDangerAction);
    $("#price-form").addEventListener("submit", savePrice);
    $("#service-form").addEventListener("submit", createOtherService);
    $("#customer-form").addEventListener("submit", useCustomerDetails);
    $("#reset-pin-form").addEventListener("submit", resetStaffPin);
    el.customerSearch.addEventListener("input", handleCustomerSearchInput);
    el.customerSearch.addEventListener("change", selectCustomer);
    el.amountPaid.addEventListener("input", () => {
      state.paymentTouched = true;
      renderSettlement();
    });
    $("#category-tabs").addEventListener("click", event => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      $$(".category-tab").forEach(tab => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      el.serviceConfig.classList.toggle("hidden", state.category === "other");
      renderServices();
    });
    el.serviceConfig.addEventListener("click", event => {
      const button = event.target.closest("[data-choice]");
      if (!button) return;
      const group = button.closest("[data-choice-group]")?.dataset.choiceGroup;
      if (!group) return;
      state.config[group] = button.dataset.choice;
      $$(`[data-choice-group="${group}"] .choice-button`).forEach(choice => choice.classList.toggle("active", choice === button));
      renderServices();
    });
    $("#add-configured-service").addEventListener("click", addConfiguredService);
    el.serviceGrid.addEventListener("click", event => {
      const button = event.target.closest("[data-service-id]");
      if (button) addService(button.dataset.serviceId);
    });
    el.cartItems.addEventListener("input", updateCartInput);
    el.cartItems.addEventListener("change", event => {
      if (event.target.matches('[data-field="side"]')) updateCartSelect(event);
      if (event.target.matches('[data-field="unit_price"]')) requestPriceChange(event.target);
    });
    el.cartItems.addEventListener("click", event => {
      const button = event.target.closest("[data-remove-index]");
      if (button) requestPinToRemove(Number(button.dataset.removeIndex));
    });
    document.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action) handleAction(action, event.target.closest("[data-action]"));
      const section = event.target.closest("[data-section]")?.dataset.section;
      if (section) switchSection(section);
      const priceService = event.target.closest("[data-edit-price]")?.dataset.editPrice;
      if (priceService) openPriceDialog(priceService);
      const approvalAction = event.target.closest("[data-approval]")?.dataset.approval;
      if (approvalAction) reviewAccount(approvalAction, event.target.closest("[data-approval]"));
      const stockAction = event.target.closest("[data-stock-request]")?.dataset.stockRequest;
      if (stockAction) reviewStock(stockAction, event.target.closest("[data-stock-request]"));
      const billAction = event.target.closest("[data-bill-action]")?.dataset.billAction;
      if (billAction) handleBillAction(billAction, event.target.closest("[data-bill-action]"));
      const teamAction = event.target.closest("[data-team-action]")?.dataset.teamAction;
      if (teamAction) handleTeamAction(teamAction, event.target.closest("[data-team-action]"));
      const managementTab = event.target.closest("[data-management-tab]")?.dataset.managementTab;
      if (managementTab) switchManagementTab(managementTab);
    });
    el.checkoutButton.addEventListener("click", checkout);
    $("#customer-ledger").addEventListener("click", event => {
      const row = event.target.closest("[data-customer-id]");
      if (row) loadCustomerStatement(row.dataset.customerId);
    });
  }

  async function handleAction(action, target) {
    if (action === "toggle-auth") toggleAuth();
    if (action === "forgot-password") forgotPassword();
    if (action === "sign-out") {
      const { error } = await state.supabase.auth.signOut();
      if (error) notify(asError(error), true);
    }
    if (action === "open-inventory") openInventory();
    if (action === "new-customer") {
      const form = $("#customer-form");
      form.reset();
      $('input[name="name"]', form).value = el.customerSearch.value.trim();
      $("#customer-dialog").showModal();
    }
    if (action === "close-pin") el.pinDialog.close();
    if (action === "close-danger") el.dangerDialog.close();
    if (action === "refresh-history") loadBills();
    if (action === "refresh-ledger") loadCustomerLedger();
    if (action === "checkout") checkout();
    if (action === "remove-row") requestPinToRemove(Number(target.dataset.index));
  }

  function showAuth() {
    el.authScreen.classList.remove("hidden");
    el.mainScreen.classList.add("hidden");
  }

  function hideLoadingScreen() {
    el.loadingScreen.classList.add("hidden");
    document.body.classList.add("app-ready");
  }

  function resetToAuth() {
    state.user = null;
    state.profile = null;
    state.cart = [];
    state.selectedCustomer = null;
    state.customerPhone = "";
    state.customerMatches = [];
    state.paymentTouched = false;
    el.mainScreen.classList.add("hidden");
    el.authScreen.classList.remove("hidden");
    el.loginForm.reset();
    el.registerForm.reset();
    el.recoveryForm.reset();
    el.loginForm.classList.remove("hidden");
    el.registerForm.classList.add("hidden");
    el.recoveryForm.classList.add("hidden");
    $(".auth-switch").classList.remove("hidden");
    el.customerSearch.value = "";
    $("#customer-options").replaceChildren();
    el.customerBalance.classList.add("hidden");
    renderCart();
  }

  async function signIn(event) {
    event.preventDefault();
    if (!state.supabase) return;
    const form = new FormData(el.loginForm);
    const button = $('button[type="submit"]', el.loginForm);
    setBusy(button, true);
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({
        email: String(form.get("email")).trim(), password: String(form.get("password"))
      });
      if (error) throw error;
      await loadProfile(data.user);
    } catch (error) {
      setAuthMessage(asError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function register(event) {
    event.preventDefault();
    if (!state.supabase) return;
    const form = new FormData(el.registerForm);
    const button = $('button[type="submit"]', el.registerForm);
    setBusy(button, true);
    try {
      const { data, error } = await state.supabase.auth.signUp({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        options: { data: { full_name: String(form.get("full_name")).trim(), phone: String(form.get("phone")).trim(), quick_pin: String(form.get("pin")) } }
      });
      if (error) throw error;
      if (!data.session) {
        el.registerForm.reset();
        return setAuthMessage("Check your email to verify your account. New accounts also need Admin approval before POS access.", "success");
      }
      setAuthMessage("Account created. It is pending Admin approval.", "success");
      await loadProfile(data.user);
    } catch (error) {
      setAuthMessage(asError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function forgotPassword() {
    if (!state.supabase) return;
    const email = new FormData(el.loginForm).get("email");
    if (!email) return setAuthMessage("Enter your email address first, then choose Forgot password.", "error");
    const { error } = await state.supabase.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: window.location.href.split("#")[0]
    });
    if (error) return setAuthMessage(asError(error), "error");
    setAuthMessage("If that address belongs to an account, a password reset link is on its way.", "success");
  }

  function showRecovery() {
    showAuth();
    el.loginForm.classList.add("hidden");
    el.registerForm.classList.add("hidden");
    el.recoveryForm.classList.remove("hidden");
    $(".auth-switch").classList.add("hidden");
    el.authTitle.textContent = "Choose a new password";
    el.authSubtitle.textContent = "Your new password must be at least 8 characters.";
    el.recoveryForm.reset();
    $('input[name="password"]', el.recoveryForm).focus();
  }

  async function updatePassword(event) {
    event.preventDefault();
    const password = new FormData(el.recoveryForm).get("password");
    const button = $('button[type="submit"]', el.recoveryForm);
    setBusy(button, true);
    try {
      const { error } = await state.supabase.auth.updateUser({ password: String(password) });
      if (error) throw error;
      await state.supabase.auth.signOut();
      setAuthMessage("Password updated. Sign in with your new password.", "success");
    } catch (error) {
      setAuthMessage(asError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function loadProfile(user) {
    if (!state.supabase || !user) return;
    state.user = user;
    const { data: profile, error } = await state.supabase.from("profiles").select("id,full_name,email,phone,role,approval_status").eq("id", user.id).maybeSingle();
    if (error) {
      showAuth();
      setAuthMessage(`Could not load your account: ${asError(error)}`, "error");
      return;
    }
    if (!profile) {
      await state.supabase.auth.signOut();
      showAuth();
      return setAuthMessage("Your account profile is not ready. Please contact the shop administrator.", "error");
    }
    if (profile.approval_status !== "approved") {
      await state.supabase.auth.signOut();
      showAuth();
      return setAuthMessage(profile.approval_status === "pending" ? "Your account is pending Admin approval." : "This account has not been approved. Please contact the shop administrator.", "error");
    }
    state.profile = profile;
    $("#user-name").textContent = profile.full_name;
    $("#user-initial").textContent = (profile.full_name || "P").trim().charAt(0).toUpperCase();
    $("#role-badge").textContent = profile.role.replace("_", " ");
    $$(".admin-only").forEach(node => node.classList.toggle("hidden", !isAdmin()));
    await loadOperationalData();
    el.authScreen.classList.add("hidden");
    el.mainScreen.classList.remove("hidden");
    switchSection("pos");
  }

  async function loadOperationalData() {
    const [servicesResult, inventoryResult] = await Promise.all([
      state.supabase.from("services").select("id,name,category,paper_size,side_type,unit_price,active").eq("active", true).order("category").order("name"),
      state.supabase.from("inventory").select("paper_size,sheet_count").order("paper_size")
    ]);
    if (servicesResult.error) notify(`Could not load services: ${asError(servicesResult.error)}`, true);
    else state.services = servicesResult.data || [];
    if (inventoryResult.error) notify(`Could not load paper inventory: ${asError(inventoryResult.error)}`, true);
    else state.inventory = inventoryResult.data || [];
    renderServices();
    renderInventory();
    renderCart();
    if (isAdmin()) await loadManagement();
  }

  async function refreshInventory() {
    const { data, error } = await state.supabase.from("inventory").select("paper_size,sheet_count").order("paper_size");
    if (error) throw error;
    state.inventory = data || [];
    renderInventory();
  }

  function renderServices() {
    const services = state.services.filter(service => service.category === state.category);
    if (state.category !== "other") {
      const config = state.config;
      const wantedColor = config.color === "color";
      const service = services.find(item => {
        const name = item.name.toLowerCase();
        const isColor = /\bcolou?r\b/.test(name);
        return item.paper_size === config.size && item.side_type === config.side && isColor === wantedColor;
      });
      $("#add-configured-service").disabled = !service;
      el.serviceGrid.innerHTML = service
        ? `<div class="service-preview"><div><strong>${escapeHtml(service.name)}</strong><span>${escapeHtml(config.size)} · ${config.color === "color" ? "Color" : "B/W"} · ${config.side === "single" ? "Single" : "Double"} sided</span></div><strong>${currency(service.unit_price)}<small> / page</small></strong></div>`
        : '<div class="empty-list">No configured price for this combination. Ask an administrator to add or price the service.</div>';
      return;
    }
    $("#add-configured-service").disabled = true;
    if (!services.length) {
      el.serviceGrid.innerHTML = '<div class="empty-list">No services in this category yet.</div>';
      return;
    }
    el.serviceGrid.innerHTML = services.map(service => `
      <button class="service-card" type="button" data-service-id="${escapeHtml(service.id)}">
        <span><span class="service-name">${escapeHtml(service.name)}</span><span class="service-meta">${service.paper_size === "none" ? "Service" : `${escapeHtml(service.paper_size)} paper`} · ${escapeHtml(service.side_type)}-sided</span></span>
        <span class="service-price">${currency(service.unit_price)}</span>
      </button>`).join("");
  }

  function addConfiguredService() {
    if (state.category === "other") return;
    const { size, color, side } = state.config;
    const service = state.services.find(item => {
      const name = item.name.toLowerCase();
      return item.category === state.category && item.paper_size === size && item.side_type === side
        && /\bcolou?r\b/.test(name) === (color === "color");
    });
    if (service) addService(service.id);
  }

  function addService(serviceId) {
    const service = state.services.find(item => item.id === serviceId);
    if (!service) return;
    state.cart.push({ key: crypto.randomUUID(), serviceId: service.id, unitPrice: Number(service.unit_price), pages: 1, copies: 1 });
    renderCart();
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function getService(serviceId) {
    return state.services.find(service => service.id === serviceId);
  }

  function sideVariants(service) {
    const baseName = service.name.replace(/\s*(?:·|-)\s*(?:single|double)[ -]sided$/i, "").trim();
    return state.services.filter(candidate =>
      candidate.category === service.category &&
      candidate.paper_size === service.paper_size &&
      candidate.name.replace(/\s*(?:·|-)\s*(?:single|double)[ -]sided$/i, "").trim() === baseName
    );
  }

  function rowTotal(row) {
    const service = getService(row.serviceId);
    return service ? Math.max(0, Number(row.unitPrice ?? service.unit_price)) * row.pages * row.copies : 0;
  }

  function renderCart() {
    if (!el.cartItems) return;
    if (!state.cart.length) {
      el.cartItems.innerHTML = '<div class="empty-cart"><span class="empty-icon">＋</span><strong>Your cart is empty</strong><span>Tap a service to add it to this bill.</span></div>';
    } else {
      el.cartItems.innerHTML = state.cart.map((row, index) => {
        const service = getService(row.serviceId);
        if (!service) return "";
        return `<article class="cart-row">
          <div class="cart-row-head"><div><div class="cart-row-title">${escapeHtml(service.name)}</div><div class="service-meta">${escapeHtml(service.side_type)}-sided · ${currency(row.unitPrice ?? service.unit_price)}/page</div></div>
            <div class="cart-row-total">${currency(rowTotal(row))}</div>
            <button class="remove-row" type="button" data-remove-index="${index}" aria-label="Remove ${escapeHtml(service.name)}">×</button>
          </div>
          <div class="cart-controls">
            <label>Original pages<input type="number" inputmode="numeric" min="1" max="9999999" step="1" value="${row.pages}" data-index="${index}" data-field="pages" aria-label="Original pages for ${escapeHtml(service.name)}" required></label>
            <label>Copies<input type="number" inputmode="numeric" min="1" max="999999" step="1" value="${row.copies}" data-index="${index}" data-field="copies" aria-label="Copies for ${escapeHtml(service.name)}" required></label>
            <label>Side<select data-index="${index}" data-field="side" aria-label="Print side for ${escapeHtml(service.name)}" ${sideVariants(service).length < 2 ? "disabled" : ""}>
              ${sideVariants(service).map(variant => `<option value="${escapeHtml(variant.id)}" ${variant.id === service.id ? "selected" : ""}>${escapeHtml(variant.side_type === "double" ? "Double" : "Single")}</option>`).join("")}
            </select></label>
            <label>Unit price<input type="number" inputmode="decimal" min="0" value="${Number(row.unitPrice ?? service.unit_price).toFixed(2)}" step="0.01" ${service.category === "printout" ? `data-index="${index}" data-field="unit_price"` : "readonly"} aria-label="Unit price for ${escapeHtml(service.name)}"></label>
          </div>
          <div class="row-price"><span>${service.paper_size === "none" ? "No paper deduction" : `${escapeHtml(service.paper_size)} sheets: ${sheetsUsed(service, row.pages, row.copies)}`}</span><span>Row total ${currency(rowTotal(row))}</span></div>
        </article>`;
      }).join("");
    }
    const total = state.cart.reduce((sum, row) => sum + rowTotal(row), 0);
    $("#cart-count").textContent = `${state.cart.length} ${state.cart.length === 1 ? "item" : "items"}`;
    el.cartTotal.textContent = currency(total);
    el.checkoutButton.disabled = state.cart.length === 0;
    if (!state.paymentTouched && el.amountPaid) el.amountPaid.value = netPayable().toFixed(2);
    renderSettlement();
  }

  function sheetsUsed(service, pages, copies) {
    if (service.paper_size === "none") return 0;
    return (service.side_type === "double" ? Math.ceil(pages / 2) : pages) * copies;
  }

  function createBillPdf(receipt) {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) throw new Error("The PDF generator did not load. Check your internet connection and try again.");

    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const left = 16;
    const right = pageWidth - left;
    const printableWidth = right - left;
    let y = 18;

    const ensureSpace = (height = 8) => {
      if (y + height > pageHeight - 16) {
        doc.addPage();
        y = 18;
      }
    };
    const addLabelValue = (label, value, bold = false) => {
      ensureSpace();
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(String(label), left, y);
      doc.text(String(value), right, y, { align: "right" });
      y += 7;
    };

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(left, y, printableWidth, 34, 3, 3, "F");
    doc.setTextColor(248, 250, 252);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.text("PrintFlow POS", left + 7, y + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(191, 219, 254);
    doc.text("SALES RECEIPT", left + 7, y + 23);
    doc.setTextColor(226, 232, 240);
    doc.text(receipt.billNumber, right - 7, y + 13, { align: "right" });
    doc.text(receipt.createdAt.toLocaleString(), right - 7, y + 23, { align: "right" });
    y += 44;

    doc.setTextColor(71, 85, 105);
    doc.setFontSize(9);
    addLabelValue("Customer", receipt.customerName, true);
    addLabelValue("Cashier", state.profile?.full_name || "Staff");
    y += 3;

    doc.setFillColor(241, 245, 249);
    doc.rect(left, y - 2, printableWidth, 9, "F");
    doc.setTextColor(51, 65, 85);
    doc.setFont("helvetica", "bold");
    doc.text("ITEM", left + 2, y + 4);
    doc.text("QTY", right - 45, y + 4, { align: "right" });
    doc.text("RATE", right - 23, y + 4, { align: "right" });
    doc.text("TOTAL", right - 2, y + 4, { align: "right" });
    y += 12;

    doc.setFontSize(9);
    receipt.items.forEach(item => {
      const title = `${item.name} (${item.sideType}, ${item.paperSize})`;
      const titleLines = doc.splitTextToSize(title, printableWidth - 62);
      const lineHeight = Math.max(8, titleLines.length * 4.5);
      ensureSpace(lineHeight + 4);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      doc.text(titleLines, left + 2, y);
      doc.text(String(item.pages * item.copies), right - 45, y, { align: "right" });
      doc.text(currency(item.unitPrice), right - 23, y, { align: "right" });
      doc.text(currency(item.lineTotal), right - 2, y, { align: "right" });
      y += lineHeight;
      doc.setDrawColor(226, 232, 240);
      doc.line(left, y, right, y);
      y += 4;
    });

    y += 2;
    doc.setTextColor(51, 65, 85);
    addLabelValue("Subtotal", currency(receipt.total), true);
    if (receipt.previousBalance !== 0) {
      addLabelValue("Previous balance", currency(receipt.previousBalance));
    }
    addLabelValue("Amount paid", currency(receipt.amountPaid));
    if (receipt.changeDue > 0.005) {
      addLabelValue("Change", currency(receipt.changeDue));
    }

    ensureSpace(20);
    const balance = Number(receipt.newBalance) || 0;
    const balanceLabel = balance > 0.005 ? "DUE" : balance < -0.005 ? "OVERPAID" : "BALANCE";
    const balanceColor = balance > 0.005 ? [185, 28, 28] : balance < -0.005 ? [4, 120, 87] : [30, 41, 59];
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(left, y, printableWidth, 17, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...balanceColor);
    doc.text(balanceLabel, left + 4, y + 11);
    doc.text(currency(Math.abs(balance)), right - 4, y + 11, { align: "right" });
    y += 28;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("Thank you for choosing PrintFlow.", pageWidth / 2, y, { align: "center" });

    return doc.output("blob");
  }

  function openBillPdf(receipt, pdfWindow) {
    try {
      const blob = createBillPdf(receipt);
      const url = URL.createObjectURL(blob);
      if (pdfWindow && !pdfWindow.closed) {
        pdfWindow.location.replace(url);
      } else {
        const download = document.createElement("a");
        download.href = url;
        download.download = `${receipt.billNumber}.pdf`;
        download.click();
        notify("Receipt PDF downloaded. Allow pop-ups to open the PDF in a new tab.");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (pdfWindow && !pdfWindow.closed) pdfWindow.close();
      notify(`Bill was completed, but the PDF could not be generated: ${asError(error)}`, true);
    }
  }

  function updateCartInput(event) {
    const input = event.target.closest("[data-field]");
    if (!input) return;
    const index = Number(input.dataset.index);
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 1) return;
    const row = state.cart[index];
    if (!row) return;
    row[input.dataset.field] = value;
    renderCartPreservingFocus(index, input.dataset.field, input.value);
  }

  function subtotal() {
    return state.cart.reduce((sum, row) => sum + rowTotal(row), 0);
  }

  function previousCustomerBalance() {
    return Number(state.selectedCustomer?.balance) || 0;
  }

  function netPayable() {
    return Math.max(0, subtotal() + previousCustomerBalance());
  }

  function renderSettlement() {
    if (!el.amountPaid || !el.settlementSummary) return;
    const due = netPayable();
    const paid = Math.max(0, Number(el.amountPaid.value) || 0);
    const previous = previousCustomerBalance();
    const enteredName = el.customerSearch.value.trim();
    const hasLedgerCustomer = Boolean(state.selectedCustomer)
      || Boolean(enteredName && !["walk-in", "cash customer"].includes(enteredName.toLowerCase()));
    const applied = hasLedgerCustomer ? paid : Math.min(paid, due);
    const nextBalance = previous + subtotal() - applied;
    let settlement = `Net payable: ${currency(due)}`;
    if (paid < due) settlement += ` · Remaining: ${currency(due - paid)}`;
    else if (paid > due && !hasLedgerCustomer) settlement += ` · Change due: ${currency(paid - due)}`;
    else if (paid > due && hasLedgerCustomer) settlement += ` · OVERPAID: ${currency(Math.abs(nextBalance))}`;
    if (nextBalance > 0.005) settlement += ` · DUE: ${currency(nextBalance)}`;
    el.settlementSummary.textContent = settlement;
  }

  async function searchCustomers() {
    const query = el.customerSearch.value.trim();
    if (query.length < 2 || !state.supabase) {
      state.customerMatches = [];
      $("#customer-options").replaceChildren();
      return;
    }
    window.clearTimeout(state.customerSearchTimer);
    state.customerSearchTimer = window.setTimeout(async () => {
      try {
        const results = await callRpc("search_customers", { p_query: query });
        state.customerMatches = results || [];
        $("#customer-options").innerHTML = state.customerMatches.map(customer => {
          const option = document.createElement("option");
          option.value = `${customer.name} [${customer.customer_code}]${customer.phone ? ` · ${customer.phone}` : ""}`;
          option.dataset.customerId = customer.id;
          return option.outerHTML;
        }).join("");
      } catch (error) {
        notify(`Could not search customers: ${asError(error)}`, true);
      }
    }, 220);
  }

  function handleCustomerSearchInput() {
    const value = el.customerSearch.value.trim();
    if (state.selectedCustomer && value !== state.selectedCustomer.name
      && !value.includes(`[${state.selectedCustomer.customer_code}]`)) {
      state.selectedCustomer = null;
      state.customerPhone = "";
      state.paymentTouched = false;
      el.customerBalance.classList.add("hidden");
      el.amountPaid.value = netPayable().toFixed(2);
      renderSettlement();
    }
    searchCustomers();
  }

  async function selectCustomer() {
    const value = el.customerSearch.value.trim();
    let customer = state.customerMatches.find(item => value.includes(`[${item.customer_code}]`) || value === item.name || value === item.phone);
    if (!customer && value.length >= 2) {
      try {
        const matches = await callRpc("search_customers", { p_query: value });
        state.customerMatches = matches || [];
        customer = state.customerMatches.find(item => value.includes(`[${item.customer_code}]`) || value === item.name || value === item.phone);
      } catch (error) {
        notify(`Could not find customer: ${asError(error)}`, true);
      }
    }
    if (customer) {
      let balance = 0;
      try {
        balance = Number(await callRpc("get_customer_balance", { p_customer_id: customer.id })) || 0;
        if (el.customerSearch.value.trim() !== value) return;
        state.selectedCustomer = { ...customer, balance };
        state.customerPhone = customer.phone || "";
      } catch (error) {
        state.selectedCustomer = null;
        state.customerPhone = "";
        el.customerSearch.value = "";
        notify(`Could not load customer balance: ${asError(error)}`, true);
        return;
      }
      el.customerBalance.textContent = balance > 0
        ? `DUE: ${currency(balance)}`
        : balance < 0
          ? `OVERPAID: ${currency(Math.abs(balance))}`
          : "No outstanding balance";
      el.customerBalance.className = `customer-balance${balance > 0 ? " due" : balance < 0 ? " overpaid" : ""}`;
    } else {
      state.selectedCustomer = null;
      state.customerPhone = "";
      el.customerBalance.classList.add("hidden");
    }
    state.paymentTouched = false;
    if (el.amountPaid) el.amountPaid.value = netPayable().toFixed(2);
    renderSettlement();
  }

  function useCustomerDetails(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    state.selectedCustomer = null;
    state.customerPhone = String(form.get("phone") || "").trim();
    el.customerSearch.value = name;
    el.customerBalance.classList.add("hidden");
    state.paymentTouched = false;
    el.amountPaid.value = netPayable().toFixed(2);
    $("#customer-dialog").close();
    renderSettlement();
  }

  function requestPriceChange(input) {
    const index = Number(input.dataset.index);
    const row = state.cart[index];
    const price = Number(input.value);
    if (!row || !Number.isFinite(price) || price < 0 || price > 999999) {
      renderCart();
      notify("Enter a valid unit price.", true);
      return;
    }
    const service = getService(row.serviceId);
    if (!service || service.category !== "printout") return renderCart();
    if (price === Number(row.unitPrice ?? service.unit_price)) return;
    state.pendingPinAction = { type: "edit_price", index, price };
    const form = $("#pin-form");
    form.reset();
    $("#pin-description").textContent = "Enter your four-digit staff PIN to confirm this printout rate.";
    el.pinDialog.showModal();
    $('input[name="pin"]', form).focus();
  }

  function updateCartSelect(event) {
    const select = event.target.closest('select[data-field="side"]');
    if (!select) return;
    const index = Number(select.dataset.index);
    const service = getService(select.value);
    if (!state.cart[index] || !service) return;
    state.cart[index].serviceId = service.id;
    state.cart[index].unitPrice = Number(service.unit_price);
    renderCart();
  }

  function renderCartPreservingFocus(index, field, value) {
    renderCart();
    const input = $(`[data-index="${index}"][data-field="${field}"]`, el.cartItems);
    if (input) {
      input.value = value;
      input.focus({ preventScroll: true });
    }
  }

  function requestPinToRemove(index) {
    if (!state.cart[index]) return;
    state.pendingPinAction = { type: "remove_cart", index };
    $("#pin-form").reset();
    $("#pin-description").textContent = "Enter your PIN or an administrator PIN to remove this draft item.";
    el.pinDialog.showModal();
    $('input[name="pin"]', $("#pin-form")).focus();
  }

  async function verifyPinForAction(event) {
    event.preventDefault();
    const pin = new FormData(event.currentTarget).get("pin");
    const submit = $('button[type="submit"]', event.currentTarget);
    setBusy(submit, true);
    try {
      const valid = await callRpc("verify_pos_pin", { p_pin: String(pin) });
      if (!valid) throw new Error("That PIN was not recognized. Try your PIN or ask an administrator.");
      if (state.pendingPinAction?.type === "remove_cart") {
        state.cart.splice(state.pendingPinAction.index, 1);
        renderCart();
        notify("Draft item removed.");
      } else if (state.pendingPinAction?.type === "edit_price") {
        const row = state.cart[state.pendingPinAction.index];
        if (!row) throw new Error("That bill item is no longer available.");
        row.unitPrice = state.pendingPinAction.price;
        state.verifiedPricePin = String(pin);
        renderCart();
        notify("Custom printout price confirmed.");
      }
      el.pinDialog.close();
      state.pendingPinAction = null;
    } catch (error) {
      notify(asError(error), true);
    } finally {
      setBusy(submit, false);
    }
  }

  async function checkout() {
    if (!state.cart.length || el.checkoutButton.disabled) return;
    const customerName = state.selectedCustomer?.name || el.customerSearch.value.trim();
    if (!customerName) {
      el.customerSearch.focus();
      return notify("Enter or select a customer name before completing the bill.", true);
    }
    const invalidInput = $$('input[data-field="pages"], input[data-field="copies"]', el.cartItems).find(input => !input.checkValidity());
    if (invalidInput) {
      invalidInput.reportValidity();
      invalidInput.focus();
      return;
    }
    const items = state.cart.map(row => ({
      service_id: row.serviceId, pages: row.pages, copies: row.copies,
      unit_price: Number(row.unitPrice ?? getService(row.serviceId)?.unit_price)
    }));
    const paid = Number(el.amountPaid.value);
    if (!Number.isFinite(paid) || paid < 0) {
      el.amountPaid.focus();
      return notify("Enter a valid amount paid.", true);
    }
    const cartSnapshot = state.cart.map(row => {
      const service = getService(row.serviceId);
      return {
        name: service?.name || "Service",
        paperSize: service?.paper_size === "none" ? "No paper" : service?.paper_size || "No paper",
        sideType: service?.side_type === "double" ? "Double-sided" : "Single-sided",
        pages: row.pages,
        copies: row.copies,
        unitPrice: Number(row.unitPrice ?? service?.unit_price) || 0,
        lineTotal: rowTotal(row)
      };
    });
    let pdfWindow = null;
    try {
      pdfWindow = window.open("about:blank", "_blank");
      if (pdfWindow) {
        pdfWindow.document.title = "Preparing PrintFlow receipt";
        pdfWindow.document.body.textContent = "Preparing your receipt PDF...";
      }
    } catch {
      pdfWindow = null;
    }
    setBusy(el.checkoutButton, true);
    try {
      let result;
      try {
        result = await callRpc("create_bill", {
          p_items: items,
          p_customer_id: state.selectedCustomer?.id || null,
          p_customer_name: customerName,
          p_customer_phone: state.customerPhone || null,
          p_amount_paid: paid,
          p_pin: state.verifiedPricePin
        });
        if (!result?.id) throw new Error("The bill was created without a returned ID. Please refresh Bills & Reports.");
      } catch (error) {
        if (pdfWindow && !pdfWindow.closed) pdfWindow.close();
        notify(asError(error), true);
        return;
      }
      openBillPdf({
        billNumber: result.bill_number,
        customerName,
        createdAt: new Date(),
        total: Number(result.total),
        previousBalance: Number(result.previous_balance) || 0,
        amountPaid: Number(result.amount_paid) || 0,
        newBalance: state.selectedCustomer ? Number(result.new_balance) || 0 : 0,
        changeDue: Math.max(0, paid - (Number(result.amount_paid) || 0)),
        items: cartSnapshot
      }, pdfWindow);
      pdfWindow = null;
      state.cart = [];
      state.selectedCustomer = null;
      state.customerPhone = "";
      state.customerMatches = [];
      state.paymentTouched = false;
      state.verifiedPricePin = null;
      el.customerSearch.value = "";
      $("#customer-options").replaceChildren();
      el.customerBalance.classList.add("hidden");
      renderCart();
      notify(`Bill ${result.bill_number} completed · ${currency(result.total)}`);
      const refreshResults = await Promise.allSettled([refreshInventory(), loadBills()]);
      refreshResults.forEach((refreshResult, index) => {
        if (refreshResult.status === "rejected") {
          notify(`${index === 0 ? "Bill saved, but inventory" : "Bill saved, but history"} could not refresh: ${asError(refreshResult.reason)}`, true);
        }
      });
      if (state.activeSection === "ledger" && isAdmin()) await loadCustomerLedger();
    } finally {
      setBusy(el.checkoutButton, false);
      el.checkoutButton.disabled = state.cart.length === 0;
    }
  }

  async function openInventory() {
    $("#inventory-message").textContent = "";
    try {
      await refreshInventory();
      el.inventoryDialog.showModal();
    } catch (error) { notify(asError(error), true); }
  }

  function renderInventory() {
    const counts = Object.fromEntries(state.inventory.map(item => [item.paper_size, Number(item.sheet_count)]));
    $("#inventory-balances").innerHTML = ["A4", "A5"].map(size => {
      const count = counts[size] || 0;
      return `<div class="balance-card${count < LOW_STOCK[size] ? " low" : ""}"><span>${size} sheets</span><strong>${count.toLocaleString()}</strong></div>`;
    }).join("");
    el.stockSummary.textContent = `A4 ${Number(counts.A4 || 0).toLocaleString()} · A5 ${Number(counts.A5 || 0).toLocaleString()} sheets`;
    const lowSizes = ["A4", "A5"].filter(size => Number(counts[size] || 0) < LOW_STOCK[size]);
    el.lowStockAlert.classList.toggle("hidden", lowSizes.length === 0);
    el.lowStockAlert.classList.toggle("critical", lowSizes.some(size => Number(counts[size] || 0) < LOW_STOCK[size] / 2));
    el.lowStockAlert.textContent = lowSizes.length ? `Low paper stock: ${lowSizes.map(size => `${size} has ${(counts[size] || 0).toLocaleString()} sheets (reorder below ${LOW_STOCK[size]}).`).join(" ")}` : "";
  }

  async function submitStock(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = $('button[type="submit"]', event.currentTarget);
    setBusy(submit, true);
    try {
      const result = await callRpc("add_paper_stock", {
        p_paper_size: String(form.get("paper_size")),
        p_sheets: Number(form.get("sheets")),
        p_note: String(form.get("note") || "").trim() || null
      });
      const stockForm = document.getElementById("stock-form");
      if (stockForm) stockForm.reset();
      await refreshInventory();
      $("#inventory-message").textContent = result.status === "approved" ? "Sheets added to active stock." : "Stock request sent to an administrator for approval.";
      notify(result.status === "approved" ? "Paper stock updated." : "Stock request submitted.");
      if (isAdmin()) await loadManagement();
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(submit, false); }
  }

  async function loadManagement() {
    const [users, requests, team] = await Promise.all([
      state.supabase.from("profiles").select("id,full_name,email,role,approval_status,created_at").eq("approval_status", "pending").order("created_at"),
      state.supabase.from("stock_requests").select("id,paper_size,sheets,note,status,created_at,requester:profiles!fk_stock_requests_profiles(full_name)").eq("status", "pending_approval").order("created_at"),
      state.supabase.from("profiles").select("id,full_name,email,role").eq("approval_status", "approved").order("full_name")
    ]);
    if (users.error) notify(`Could not load account approvals: ${asError(users.error)}`, true);
    else renderPendingUsers(users.data || []);
    if (requests.error) notify(`Could not load stock requests: ${asError(requests.error)}`, true);
    else renderStockRequests(requests.data || []);
    if (team.error) notify(`Could not load team: ${asError(team.error)}`, true);
    else renderTeam(team.data || []);
    renderPrices();
    const pending = (users.data || []).length + (requests.data || []).length;
    $("#pending-count").textContent = pending;
    $("#pending-count").classList.toggle("hidden", !pending);
  }

  function renderPendingUsers(users) {
    $("#pending-users").innerHTML = users.length ? users.map(user => `
      <div class="list-row"><div class="list-primary">${escapeHtml(user.full_name)}<span class="list-secondary">${escapeHtml(user.email)}</span></div>
      <div class="row-actions"><button class="small-button approve" data-approval="approve:${escapeHtml(user.id)}">Approve</button><button class="small-button reject" data-approval="reject:${escapeHtml(user.id)}">Reject</button></div></div>`).join("") : '<div class="empty-list">No accounts waiting for approval.</div>';
  }

  function renderStockRequests(requests) {
    $("#stock-requests").innerHTML = requests.length ? requests.map(request => `
      <div class="list-row"><div class="list-primary">${escapeHtml(request.paper_size)} · ${Number(request.sheets).toLocaleString()} sheets<span class="list-secondary">${escapeHtml(request.requester?.full_name || "Staff")} · ${escapeHtml(request.note || "No note")}</span></div>
      <div class="row-actions"><button class="small-button approve" data-stock-request="approve:${escapeHtml(request.id)}">Approve</button><button class="small-button reject" data-stock-request="reject:${escapeHtml(request.id)}">Reject</button></div></div>`).join("") : '<div class="empty-list">No stock requests awaiting approval.</div>';
  }

  function renderPrices() {
    $("#service-prices").innerHTML = state.services.length ? state.services.map(service => `
      <div class="list-row price-row"><div class="list-primary">${escapeHtml(service.name)}<span class="list-secondary">${escapeHtml(service.category)} · ${escapeHtml(service.paper_size || "No paper")} · ${escapeHtml(service.side_type)}</span></div><span class="price-value">${currency(service.unit_price)}</span><button class="small-button" data-edit-price="${escapeHtml(service.id)}">Edit price</button></div>`).join("") : '<div class="empty-list">No active services.</div>';
  }

  async function createOtherService(event) {
    event.preventDefault();
    if (!isAdmin()) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const price = Number(values.get("unit_price"));
    if (!name || !Number.isFinite(price) || price < 0) return notify("Enter a valid service name and price.", true);
    const submit = $('button[type="submit"]', form);
    setBusy(submit, true);
    try {
      const { data, error } = await state.supabase.from("services").insert({
        name, category: "other", paper_size: "none", side_type: "single", unit_price: price
      }).select("id,name,category,paper_size,side_type,unit_price,active").single();
      if (error) throw error;
      state.services.push(data);
      form.reset();
      renderPrices();
      if (state.category === "other") renderServices();
      notify("Other service added.");
    } catch (error) {
      notify(`Could not create service: ${asError(error)}`, true);
    } finally {
      setBusy(submit, false);
    }
  }

  async function resetStaffPin(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submit = $('button[type="submit"]', event.currentTarget);
    setBusy(submit, true);
    try {
      await callRpc("admin_reset_pin", {
        p_user_id: state.resetPinUserId,
        p_new_pin: String(values.get("new_pin")),
        p_admin_pin: String(values.get("admin_pin"))
      });
      $("#reset-pin-dialog").close();
      state.resetPinUserId = null;
      event.currentTarget.reset();
      notify("Staff PIN reset.");
    } catch (error) {
      notify(asError(error), true);
    } finally {
      setBusy(submit, false);
    }
  }

  function switchManagementTab(tabName) {
    $$("[data-management-tab]").forEach(tab => {
      const active = tab.dataset.managementTab === tabName;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$("[data-management-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.managementPanel !== tabName));
  }

  async function loadCustomerLedger() {
    if (!isAdmin()) return;
    const { data, error } = await state.supabase.from("customers")
      .select("id,customer_code,name,phone,balance,created_at").order("name");
    if (error) return notify(`Could not load customer ledger: ${asError(error)}`, true);
    const customers = data || [];
    state.ledgerCustomers = customers;
    $("#customer-ledger").innerHTML = customers.length ? customers.map(customer => `
      <button class="list-row ledger-row" type="button" data-customer-id="${escapeHtml(customer.id)}">
        <span class="list-primary">${escapeHtml(customer.name)}<span class="list-secondary">${escapeHtml(customer.customer_code)} · ${escapeHtml(customer.phone || "No phone")}</span></span>
        <span class="ledger-balance${Number(customer.balance) > 0 ? " due" : Number(customer.balance) < 0 ? " overpaid" : ""}">${Number(customer.balance) > 0 ? "DUE " : Number(customer.balance) < 0 ? "OVERPAID " : ""}${currency(Math.abs(Number(customer.balance)))}</span>
      </button>`).join("") : '<div class="empty-list">No registered customer accounts yet.</div>';
  }

  async function loadCustomerStatement(customerId) {
    if (!isAdmin()) return;
    const customer = state.ledgerCustomers.find(item => item.id === customerId);
    const { data, error } = await state.supabase.from("bills")
      .select("id,bill_number,total,status,customer_name,previous_balance,amount_paid,new_balance,created_at,billed_by_profile:profiles!fk_bills_profiles(full_name),bill_items(service_name,pages,copies,line_total)")
      .eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100);
    if (error) return notify(`Could not load customer statement: ${asError(error)}`, true);
    $("#statement-title").textContent = customer ? `${customer.name} · ${customer.customer_code}` : "Customer statement";
    $("#statement-rows").innerHTML = data?.length ? data.map(bill => `
      <div class="list-row"><div class="list-primary">${escapeHtml(bill.bill_number)} · ${currency(bill.total)}<span class="list-secondary">${new Date(bill.created_at).toLocaleString()} · Paid ${currency(bill.amount_paid)} · Previous ${currency(bill.previous_balance)} · Balance ${currency(bill.new_balance)}</span><span class="bill-items-summary">${(bill.bill_items || []).map(item => `${escapeHtml(item.service_name)} × ${item.pages}p × ${item.copies}`).join(" · ")}</span></div><span class="status-pill ${escapeHtml(bill.status)}">${escapeHtml(bill.billed_by_profile?.full_name || "Former user")}</span></div>`).join("") : '<div class="empty-list">No bills for this customer.</div>';
    $("#customer-statement").classList.remove("hidden");
  }

  function renderTeam(team) {
    $("#team-list").innerHTML = team.length ? team.map(member => {
      const targetIsSuper = member.role === "super_admin";
      const canManage = !targetIsSuper && member.id !== state.user.id
        && (state.profile.role === "super_admin" || member.role === "staff");
      const badge = targetIsSuper ? '<span class="protected-badge">Protected Super Admin</span>' : `<span class="role-badge">${escapeHtml(member.role.replace("_", " "))}</span>`;
      return `<div class="list-row"><div class="list-primary">${escapeHtml(member.full_name)}<span class="list-secondary">${escapeHtml(member.email)} · ${badge}</span></div>
        ${canManage ? `<div class="row-actions"><button class="small-button" data-team-action="reset:${escapeHtml(member.id)}">Reset PIN</button>${state.profile.role === "super_admin" ? `<button class="small-button" data-team-action="role:${escapeHtml(member.id)}:${member.role === "admin" ? "staff" : "admin"}">Make ${member.role === "admin" ? "staff" : "admin"}</button>` : ""}<button class="small-button reject" data-team-action="delete:${escapeHtml(member.id)}">Delete</button></div>` : ""}</div>`;
    }).join("") : '<div class="empty-list">No approved team accounts.</div>';
  }

  async function reviewAccount(value, button) {
    const [decision, userId] = value.split(":");
    if (decision === "reject") {
      openDanger({
        kind: "reject_account", userId,
        title: "Reject this account?",
        impact: "This account will not be able to access the point of sale. The account record is retained for audit and can be reviewed by an administrator.",
        requireReason: true, reasonLabel: "Reason for rejection"
      });
      return;
    }
    setBusy(button, true);
    try {
      await callRpc("admin_review_account", { p_user_id: userId, p_approve: true, p_reason: null });
      notify("Account approved.");
      await loadManagement();
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(button, false); }
  }

  async function reviewStock(value, button) {
    const [decision, requestId] = value.split(":");
    if (decision === "reject") {
      openDanger({
        kind: "reject_stock", requestId, title: "Reject this stock request?",
        impact: "The requested sheets will not be added to inventory. This decision is recorded for the shop audit.",
        requireReason: true, reasonLabel: "Reason for rejection"
      });
      return;
    }
    setBusy(button, true);
    try {
      await callRpc("resolve_stock_request", { p_request_id: requestId, p_approve: true, p_reason: null });
      await Promise.all([refreshInventory(), loadManagement()]);
      notify("Stock request approved and sheets added.");
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(button, false); }
  }

  function openPriceDialog(serviceId) {
    const service = getService(serviceId);
    if (!service) return;
    $("#price-title").textContent = service.name;
    $("#price-form").dataset.serviceId = service.id;
    $('input[name="unit_price"]', $("#price-form")).value = Number(service.unit_price).toFixed(2);
    el.priceDialog.showModal();
  }

  async function savePrice(event) {
    event.preventDefault();
    const serviceId = event.currentTarget.dataset.serviceId;
    const price = Number(new FormData(event.currentTarget).get("unit_price"));
    const submit = $('button[type="submit"]', event.currentTarget);
    setBusy(submit, true);
    try {
      const { error } = await state.supabase.from("services").update({ unit_price: price }).eq("id", serviceId);
      if (error) throw error;
      const service = getService(serviceId);
      service.unit_price = price;
      renderServices();
      renderCart();
      renderPrices();
      el.priceDialog.close();
      notify("Service price updated.");
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(submit, false); }
  }

  async function handleTeamAction(value) {
    const [action, userId, role] = value.split(":");
    if (action === "reset") {
      state.resetPinUserId = userId;
      $("#reset-pin-form").reset();
      $("#reset-pin-dialog").showModal();
    } else if (action === "delete") {
      openDanger({
        kind: "delete_user", userId, title: "Delete this staff account?",
        impact: "This permanently removes their login and profile. Historical bills remain in the audit trail. This cannot be undone.",
        requireReason: true, requirePin: true, reasonLabel: "Mandatory deletion reason"
      });
    } else if (action === "role") {
      openDanger({
        kind: "set_role", userId, role, title: `Change this account to ${role.replace("_", " ")}?`,
        impact: "This changes the account's access to management and financial information.",
        requireReason: true, requirePin: true, reasonLabel: "Reason for role change"
      });
    }
  }

  function openDanger(action) {
    state.dangerAction = action;
    $("#danger-title").textContent = action.title;
    $("#danger-impact").textContent = action.impact;
    $("#danger-reason-label").classList.toggle("hidden", !action.requireReason);
    $("#danger-reason-label").firstChild.textContent = action.reasonLabel || "Reason";
    $('input[name="reason"]', $("#danger-form")).required = Boolean(action.requireReason);
    $("#danger-pin-label").classList.toggle("hidden", !action.requirePin);
    $('input[name="pin"]', $("#danger-form")).required = Boolean(action.requirePin);
    $("#danger-confirm").textContent = action.kind.startsWith("reject") ? "Reject request" : action.kind === "delete_user" ? "Delete account" : action.kind === "void_bill" ? "Void bill" : "Confirm action";
    $("#danger-form").reset();
    el.dangerDialog.showModal();
  }

  async function performDangerAction(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = state.dangerAction;
    if (!action) return;
    const submit = $("#danger-confirm");
    setBusy(submit, true);
    try {
      const reason = String(form.get("reason") || "").trim();
      if (action.kind === "reject_account") {
        await callRpc("admin_review_account", { p_user_id: action.userId, p_approve: false, p_reason: reason });
      } else if (action.kind === "reject_stock") {
        await callRpc("resolve_stock_request", { p_request_id: action.requestId, p_approve: false, p_reason: reason });
      } else if (action.kind === "void_bill") {
        await callRpc("void_bill", { p_bill_id: action.billId, p_reason: reason });
      } else if (action.kind === "delete_user") {
        await callRpc("admin_delete_user", { p_user_id: action.userId, p_pin: String(form.get("pin")), p_reason: reason });
      } else if (action.kind === "set_role") {
        await callRpc("admin_set_role", { p_user_id: action.userId, p_role: action.role, p_pin: String(form.get("pin")), p_reason: reason });
      } else if (action.kind === "request_void") {
        await submitCancellationRequest(action, reason);
      } else if (action.kind === "reject_cancellation") {
        await resolveRejectedCancellation(action, reason);
      }
      el.dangerDialog.close();
      state.dangerAction = null;
      notify("Action completed.");
      await Promise.all([loadManagement(), refreshInventory(), loadBills()]);
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(submit, false); }
  }

  function handleBillAction(action, button) {
    const [operation, billId] = action.split(":");
    if (operation === "request") {
      openDanger({
        kind: "request_void", billId, title: "Request cancellation?",
        impact: "The bill will be marked for admin review. Paper stays deducted until the request is approved.",
        requireReason: true, reasonLabel: "Cancellation reason"
      });
    } else if (operation === "void") {
      openDanger({
        kind: "void_bill", billId, title: "Void this bill?",
        impact: "The bill will be marked voided and its exact A4/A5 sheet usage will be returned to active stock.",
        requireReason: true, reasonLabel: "Mandatory cancellation reason"
      });
    } else if (operation === "approve-cancel") {
      resolveCancellation(billId, true, button);
    } else if (operation === "reject-cancel") {
      resolveCancellation(billId, false, button);
    }
  }

  async function resolveCancellation(billId, approve, button) {
    if (!approve) {
      return openDanger({
        kind: "reject_cancellation", billId, title: "Reject cancellation request?",
        impact: "The bill will return to completed status and paper will remain deducted.",
        requireReason: true, reasonLabel: "Reason for rejection"
      });
    }
    setBusy(button, true);
    try {
      await callRpc("resolve_bill_cancellation", { p_bill_id: billId, p_approve: true, p_reason: null });
      await Promise.all([loadBills(), refreshInventory()]);
      notify("Cancellation approved and paper stock restored.");
    } catch (error) { notify(asError(error), true); }
    finally { setBusy(button, false); }
  }

  async function submitCancellationRequest(action, reason) {
    await callRpc("request_bill_cancellation", { p_bill_id: action.billId, p_reason: reason });
    await loadBills();
    notify("Cancellation request submitted.");
  }

  async function resolveRejectedCancellation(action, reason) {
    await callRpc("resolve_bill_cancellation", { p_bill_id: action.billId, p_approve: false, p_reason: reason });
  }

  async function loadBills() {
    if (!state.user || !state.supabase) return;
    let query = state.supabase.from("bills").select("id,bill_number,total,status,cancellation_reason,customer_name,previous_balance,amount_paid,new_balance,created_at,created_by,billed_by_profile:profiles!fk_bills_profiles(full_name),bill_items(id,service_name,pages,copies,unit_price,line_total,sheets_used,paper_size)").order("created_at", { ascending: false }).limit(100);
    if (!isAdmin()) query = query.eq("created_by", state.user.id);
    const { data, error } = await query;
    if (error) return notify(`Could not load bills: ${asError(error)}`, true);
    renderBills(data || []);
  }

  function renderBills(bills) {
    $("#bill-history").innerHTML = bills.length ? bills.map(bill => {
      const canCancel = bill.status === "completed" && bill.created_by === state.user.id;
      return `<div class="list-row"><div class="list-primary">${escapeHtml(bill.bill_number)} · ${currency(bill.total)}<span class="list-secondary">${escapeHtml(bill.customer_name)} · ${new Date(bill.created_at).toLocaleString()} · ${escapeHtml(bill.billed_by_profile?.full_name || "Former user")}</span><span class="bill-items-summary">Paid ${currency(bill.amount_paid)} · Balance ${currency(bill.new_balance)} · ${(bill.bill_items || []).map(item => `${escapeHtml(item.service_name)} × ${item.pages}p × ${item.copies}`).join(" · ")}</span></div>
        <div class="row-actions"><span class="status-pill ${escapeHtml(bill.status)}">${escapeHtml(bill.status.replaceAll("_", " "))}</span>
          ${isAdmin() && ["completed", "cancellation_pending"].includes(bill.status) ? `<button class="small-button reject" data-bill-action="void:${escapeHtml(bill.id)}">Void</button>` : ""}
          ${isAdmin() && bill.status === "cancellation_pending" ? `<button class="small-button approve" data-bill-action="approve-cancel:${escapeHtml(bill.id)}">Approve</button><button class="small-button reject" data-bill-action="reject-cancel:${escapeHtml(bill.id)}">Reject</button>` : ""}
          ${canCancel ? `<button class="small-button reject" data-bill-action="request:${escapeHtml(bill.id)}">Void bill</button>` : ""}
        </div></div>`;
    }).join("") : '<div class="empty-list">No bills found.</div>';
  }

  function switchSection(section) {
    if (["management", "ledger"].includes(section) && !isAdmin()) return;
    state.activeSection = section;
    el.posSection.classList.toggle("hidden", section !== "pos");
    el.managementSection.classList.toggle("hidden", section !== "management");
    el.historySection.classList.toggle("hidden", section !== "history");
    el.ledgerSection.classList.toggle("hidden", section !== "ledger");
    $$(".nav-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.section === section));
    if (section === "management") loadManagement();
    if (section === "history") loadBills();
    if (section === "ledger") loadCustomerLedger();
  }

  function toggleAuth() {
    const registering = el.registerForm.classList.contains("hidden");
    el.loginForm.classList.toggle("hidden", registering);
    el.registerForm.classList.toggle("hidden", !registering);
    el.authTitle.textContent = registering ? "Create your account" : "Welcome back";
    el.authSubtitle.textContent = registering ? "Get set up with your PrintFlow team." : "Sign in to start serving customers.";
    el.authSwitchCopy.textContent = registering ? "Already have an account?" : "New to PrintFlow?";
    el.authSwitchButton.textContent = registering ? "Sign in" : "Create an account";
    el.authMessage.classList.add("hidden");
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.classList.toggle("loading", busy);
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  init();
})();
