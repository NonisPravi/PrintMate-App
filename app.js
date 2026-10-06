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
    category: "printout",
    pendingPinAction: null,
    dangerAction: null,
    activeSection: "pos"
  };

  const el = {
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
    stockSummary: $("#stock-summary"), lowStockAlert: $("#low-stock-alert")
  };

  const isAdmin = () => ["admin", "super_admin"].includes(state.profile?.role);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const currency = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "INR" }).format(Number(value) || 0);
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
    if (!window.supabase || SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_")) {
      el.authScreen.classList.remove("hidden");
      setAuthMessage("Connect your Supabase project by adding its URL and anon key at the top of app.js, then run supabase-schema.sql.", "error");
      bindEvents();
      return;
    }
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    bindEvents();
    state.supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showRecovery();
      }
      if (event === "SIGNED_OUT") resetToAuth();
    });
    state.supabase.auth.getSession().then(({ data, error }) => {
      if (error) return notify(asError(error), true);
      if (data.session?.user) loadProfile(data.session.user);
      else showAuth();
    });
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", signIn);
    el.registerForm.addEventListener("submit", register);
    el.recoveryForm.addEventListener("submit", updatePassword);
    $("#stock-form").addEventListener("submit", submitStock);
    $("#pin-form").addEventListener("submit", verifyPinForAction);
    $("#danger-form").addEventListener("submit", performDangerAction);
    $("#price-form").addEventListener("submit", savePrice);
    $("#category-tabs").addEventListener("click", event => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      $$(".category-tab").forEach(tab => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      renderServices();
    });
    el.serviceGrid.addEventListener("click", event => {
      const button = event.target.closest("[data-service-id]");
      if (button) addService(button.dataset.serviceId);
    });
    el.cartItems.addEventListener("input", updateCartInput);
    el.cartItems.addEventListener("change", updateCartSelect);
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
    });
    el.checkoutButton.addEventListener("click", checkout);
  }

  async function handleAction(action, target) {
    if (action === "toggle-auth") toggleAuth();
    if (action === "forgot-password") forgotPassword();
    if (action === "sign-out") {
      const { error } = await state.supabase.auth.signOut();
      if (error) notify(asError(error), true);
    }
    if (action === "open-inventory") openInventory();
    if (action === "close-pin") el.pinDialog.close();
    if (action === "close-danger") el.dangerDialog.close();
    if (action === "refresh-history") loadBills();
    if (action === "checkout") checkout();
    if (action === "remove-row") requestPinToRemove(Number(target.dataset.index));
  }

  function showAuth() {
    el.authScreen.classList.remove("hidden");
    el.mainScreen.classList.add("hidden");
  }

  function resetToAuth() {
    state.user = null;
    state.profile = null;
    state.cart = [];
    el.mainScreen.classList.add("hidden");
    el.authScreen.classList.remove("hidden");
    el.loginForm.reset();
    el.registerForm.reset();
    el.recoveryForm.reset();
    el.loginForm.classList.remove("hidden");
    el.registerForm.classList.add("hidden");
    el.recoveryForm.classList.add("hidden");
    $(".auth-switch").classList.remove("hidden");
    renderCart();
  }

  async function signIn(event) {
    event.preventDefault();
    if (!state.supabase) return;
    const form = new FormData(el.loginForm);
    const button = $('button[type="submit"]', el.loginForm);
    setBusy(button, true);
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(), password: String(form.get("password"))
    });
    setBusy(button, false);
    if (error) return setAuthMessage(asError(error), "error");
    await loadProfile(data.user);
  }

  async function register(event) {
    event.preventDefault();
    if (!state.supabase) return;
    const form = new FormData(el.registerForm);
    const button = $('button[type="submit"]', el.registerForm);
    setBusy(button, true);
    const { data, error } = await state.supabase.auth.signUp({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
      options: { data: { full_name: String(form.get("full_name")).trim(), phone: String(form.get("phone")).trim(), quick_pin: String(form.get("pin")) } }
    });
    setBusy(button, false);
    if (error) return setAuthMessage(asError(error), "error");
    if (!data.session) {
      el.registerForm.reset();
      return setAuthMessage("Check your email to verify your account. New accounts also need Admin approval before POS access.", "success");
    }
    setAuthMessage("Account created. It is pending Admin approval.", "success");
    await loadProfile(data.user);
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
      notify(`Could not load your account: ${asError(error)}`, true);
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
    el.adminNav.classList.toggle("hidden", !isAdmin());
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
    if (!services.length) {
      el.serviceGrid.innerHTML = '<div class="empty-list">No services in this category yet.</div>';
      return;
    }
    el.serviceGrid.innerHTML = services.map(service => `
      <button class="service-card" type="button" data-service-id="${escapeHtml(service.id)}">
        <span><span class="service-name">${escapeHtml(service.name)}</span><span class="service-meta">${service.paper_size === "none" ? "Service" : `${escapeHtml(service.paper_size)} paper`} · ${escapeHtml(service.side_type)}-sided</span></span>
        <span class="service-price">${currency(service.unit_price)}<small style="font-size:10px;color:#8994a6"> /page</small></span>
      </button>`).join("");
  }

  function addService(serviceId) {
    const service = state.services.find(item => item.id === serviceId);
    if (!service) return;
    state.cart.push({ key: crypto.randomUUID(), serviceId: service.id, pages: 1, copies: 1 });
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
    return service ? Math.max(0, Number(service.unit_price)) * row.pages * row.copies : 0;
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
          <div class="cart-row-head"><div><div class="cart-row-title">${escapeHtml(service.name)}</div><div class="service-meta">${escapeHtml(service.side_type)}-sided · ${currency(service.unit_price)}/page</div></div>
            <div class="cart-row-total">${currency(rowTotal(row))}</div>
            <button class="remove-row" type="button" data-remove-index="${index}" aria-label="Remove ${escapeHtml(service.name)}">×</button>
          </div>
          <div class="cart-controls">
            <label>Original pages<input type="number" inputmode="numeric" min="1" max="9999999" step="1" value="${row.pages}" data-index="${index}" data-field="pages" aria-label="Original pages for ${escapeHtml(service.name)}" required></label>
            <label>Copies<input type="number" inputmode="numeric" min="1" max="999999" step="1" value="${row.copies}" data-index="${index}" data-field="copies" aria-label="Copies for ${escapeHtml(service.name)}" required></label>
            <label>Side<select data-index="${index}" data-field="side" aria-label="Print side for ${escapeHtml(service.name)}" ${sideVariants(service).length < 2 ? "disabled" : ""}>
              ${sideVariants(service).map(variant => `<option value="${escapeHtml(variant.id)}" ${variant.id === service.id ? "selected" : ""}>${escapeHtml(variant.side_type === "double" ? "Double" : "Single")}</option>`).join("")}
            </select></label>
            <label>Unit price<input type="number" inputmode="decimal" value="${Number(service.unit_price).toFixed(2)}" step="0.01" readonly aria-label="Unit price for ${escapeHtml(service.name)}"></label>
          </div>
          <div class="row-price"><span>${service.paper_size === "none" ? "No paper deduction" : `${escapeHtml(service.paper_size)} sheets: ${sheetsUsed(service, row.pages, row.copies)}`}</span><span>Row total ${currency(rowTotal(row))}</span></div>
        </article>`;
      }).join("");
    }
    const total = state.cart.reduce((sum, row) => sum + rowTotal(row), 0);
    $("#cart-count").textContent = `${state.cart.length} ${state.cart.length === 1 ? "item" : "items"}`;
    el.cartTotal.textContent = currency(total);
    el.checkoutButton.disabled = state.cart.length === 0;
  }

  function sheetsUsed(service, pages, copies) {
    if (service.paper_size === "none") return 0;
    return (service.side_type === "double" ? Math.ceil(pages / 2) : pages) * copies;
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

  function updateCartSelect(event) {
    const select = event.target.closest('select[data-field="side"]');
    if (!select) return;
    const index = Number(select.dataset.index);
    const service = getService(select.value);
    if (!state.cart[index] || !service) return;
    state.cart[index].serviceId = service.id;
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
    const invalidInput = $$('input[data-field="pages"], input[data-field="copies"]', el.cartItems).find(input => !input.checkValidity());
    if (invalidInput) {
      invalidInput.reportValidity();
      invalidInput.focus();
      return;
    }
    const items = state.cart.map(row => ({ service_id: row.serviceId, pages: row.pages, copies: row.copies }));
    setBusy(el.checkoutButton, true);
    try {
      const result = await callRpc("create_bill", { p_items: items });
      state.cart = [];
      renderCart();
      await refreshInventory();
      notify(`Bill ${result.bill_number} completed · ${currency(result.total)}`);
      if (state.activeSection === "history") await loadBills();
    } catch (error) {
      notify(asError(error), true);
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
      event.currentTarget.reset();
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
      state.supabase.from("stock_requests").select("id,paper_size,sheets,note,status,created_at,requester:profiles!stock_requests_requested_by_fkey(full_name)").eq("status", "pending_approval").order("created_at"),
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

  function renderTeam(team) {
    $("#team-list").innerHTML = team.length ? team.map(member => {
      const targetIsSuper = member.role === "super_admin";
      const canManage = state.profile.role === "super_admin" || (!targetIsSuper && member.role !== "admin");
      return `<div class="list-row"><div class="list-primary">${escapeHtml(member.full_name)}<span class="list-secondary">${escapeHtml(member.email)} · ${escapeHtml(member.role.replace("_", " "))}</span></div>
        ${canManage ? `<div class="row-actions">${state.profile.role === "super_admin" ? `<button class="small-button" data-team-action="role:${escapeHtml(member.id)}:${member.role === "admin" ? "staff" : "admin"}">Make ${member.role === "admin" ? "staff" : "admin"}</button>` : ""}<button class="small-button reject" data-team-action="delete:${escapeHtml(member.id)}">Delete</button></div>` : ""}</div>`;
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
    if (action === "delete") {
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
    let query = state.supabase.from("bills").select("id,bill_number,total,status,cancellation_reason,created_at,created_by,creator:profiles!bills_created_by_fkey(full_name),bill_items(id,service_name,pages,copies,unit_price,line_total,sheets_used,paper_size)").order("created_at", { ascending: false }).limit(100);
    if (!isAdmin()) query = query.eq("created_by", state.user.id);
    const { data, error } = await query;
    if (error) return notify(`Could not load bills: ${asError(error)}`, true);
    renderBills(data || []);
  }

  function renderBills(bills) {
    $("#bill-history").innerHTML = bills.length ? bills.map(bill => {
      const canCancel = bill.status === "completed" && bill.created_by === state.user.id;
      return `<div class="list-row"><div class="list-primary">${escapeHtml(bill.bill_number)} · ${currency(bill.total)}<span class="list-secondary">${new Date(bill.created_at).toLocaleString()} · ${escapeHtml(bill.creator?.full_name || "Former user")}</span><span class="bill-items-summary">${(bill.bill_items || []).map(item => `${escapeHtml(item.service_name)} × ${item.pages}p × ${item.copies}`).join(" · ")}</span></div>
        <div class="row-actions"><span class="status-pill ${escapeHtml(bill.status)}">${escapeHtml(bill.status.replaceAll("_", " "))}</span>
          ${isAdmin() && ["completed", "cancellation_pending"].includes(bill.status) ? `<button class="small-button reject" data-bill-action="void:${escapeHtml(bill.id)}">Void</button>` : ""}
          ${isAdmin() && bill.status === "cancellation_pending" ? `<button class="small-button approve" data-bill-action="approve-cancel:${escapeHtml(bill.id)}">Approve</button><button class="small-button reject" data-bill-action="reject-cancel:${escapeHtml(bill.id)}">Reject</button>` : ""}
          ${canCancel ? `<button class="small-button reject" data-bill-action="request:${escapeHtml(bill.id)}">Void bill</button>` : ""}
        </div></div>`;
    }).join("") : '<div class="empty-list">No bills found.</div>';
  }

  function switchSection(section) {
    if (section !== "pos" && !isAdmin()) return;
    state.activeSection = section;
    el.posSection.classList.toggle("hidden", section !== "pos");
    el.managementSection.classList.toggle("hidden", section !== "management");
    el.historySection.classList.toggle("hidden", section !== "history");
    $$(".nav-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.section === section));
    if (section === "management") loadManagement();
    if (section === "history") loadBills();
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
