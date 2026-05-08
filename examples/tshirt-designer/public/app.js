const state = {
  prompt: "",
  headline: "LOCAL ROBOTS",
  subline: "BUILD NIGHT",
  motif: "badge",
  shirtColor: "#f2eadf",
  shirtColorName: "natural",
  inkPrimary: "#12355b",
  inkSecondary: "#f26d3d",
  inkAccent: "#f7d154",
  size: "M",
  quantity: 1,
  maxSpendUsd: "20",
  provider: "custom_ink",
  style: "classic unisex tee",
  shippingAddress: "",
  design: {
    headline: "LOCAL ROBOTS",
    subline: "BUILD NIGHT",
    motif: "badge",
    inkPrimary: "#12355b",
    inkSecondary: "#f26d3d",
    inkAccent: "#f7d154",
  },
};

const els = {
  prompt: document.querySelector("#prompt"),
  headline: document.querySelector("#headline"),
  subline: document.querySelector("#subline"),
  inkPrimary: document.querySelector("#inkPrimary"),
  inkSecondary: document.querySelector("#inkSecondary"),
  inkAccent: document.querySelector("#inkAccent"),
  size: document.querySelector("#size"),
  quantity: document.querySelector("#quantity"),
  maxSpendUsd: document.querySelector("#maxSpendUsd"),
  provider: document.querySelector("#provider"),
  style: document.querySelector("#style"),
  shippingAddress: document.querySelector("#shippingAddress"),
  payloadPreview: document.querySelector("#payloadPreview"),
  result: document.querySelector("#result"),
  estimate: document.querySelector("#estimate"),
  shirtBody: document.querySelector("#shirtBody"),
  artLayer: document.querySelector("#artLayer"),
  agentButton: document.querySelector("#agentButton"),
  randomizeButton: document.querySelector("#randomizeButton"),
  buyButton: document.querySelector("#buyButton"),
  statusBanner: document.querySelector("#statusBanner"),
};

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function estimateCents() {
  const quantity = Math.max(1, Number(state.quantity || 1));
  return quantity * 2400;
}

function text(value, max = 36) {
  return String(value || "").slice(0, max);
}

function motifMarkup(motif, colors) {
  const { primary, secondary, accent } = colors;
  if (motif === "sunburst") {
    const rays = Array.from({ length: 12 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 12;
      const x1 = 250 + Math.cos(angle) * 72;
      const y1 = 185 + Math.sin(angle) * 72;
      const x2 = 250 + Math.cos(angle) * 96;
      const y2 = 185 + Math.sin(angle) * 96;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }).join("");
    return `<circle cx="250" cy="185" r="54" fill="${accent}"/><g stroke="${primary}" stroke-width="8">${rays}</g>`;
  }
  if (motif === "wave") {
    return `<path d="M150 190 C190 130 225 250 270 190 S340 155 360 195" fill="none" stroke="${secondary}" stroke-width="20" stroke-linecap="round"/><circle cx="250" cy="185" r="42" fill="${accent}" opacity=".9"/>`;
  }
  if (motif === "orbit") {
    return `<circle cx="250" cy="185" r="38" fill="${accent}"/><ellipse cx="250" cy="185" rx="105" ry="42" fill="none" stroke="${secondary}" stroke-width="10" transform="rotate(-18 250 185)"/><circle cx="333" cy="153" r="13" fill="${primary}"/>`;
  }
  if (motif === "stack") {
    return `<rect x="174" y="136" width="152" height="36" rx="8" fill="${accent}"/><rect x="154" y="184" width="192" height="36" rx="8" fill="${secondary}"/><rect x="184" y="232" width="132" height="36" rx="8" fill="${primary}"/>`;
  }
  return `<path d="M250 108 L356 166 L356 292 L250 350 L144 292 L144 166 Z" fill="${accent}" stroke="${primary}" stroke-width="12"/><circle cx="250" cy="230" r="48" fill="${secondary}"/>`;
}

function render() {
  state.design = {
    ...state.design,
    headline: state.headline,
    subline: state.subline,
    motif: state.motif,
    inkPrimary: state.inkPrimary,
    inkSecondary: state.inkSecondary,
    inkAccent: state.inkAccent,
  };
  els.shirtBody.setAttribute("fill", state.shirtColor);
  els.artLayer.innerHTML = `
    ${motifMarkup(state.motif, {
      primary: state.inkPrimary,
      secondary: state.inkSecondary,
      accent: state.inkAccent,
    })}
    <text x="250" y="384" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="900" fill="${state.inkPrimary}" letter-spacing="2">${text(state.headline).toUpperCase()}</text>
    <text x="250" y="425" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${state.inkSecondary}" letter-spacing="4">${text(state.subline, 48).toUpperCase()}</text>
  `;
  els.estimate.textContent = money(estimateCents());
  document.querySelectorAll("[data-motif]").forEach((button) => {
    button.classList.toggle("active", button.dataset.motif === state.motif);
  });
  document.querySelectorAll("[data-shirt]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shirt === state.shirtColor);
  });
}

function syncFromInputs() {
  state.prompt = els.prompt.value;
  state.headline = els.headline.value;
  state.subline = els.subline.value;
  state.inkPrimary = els.inkPrimary.value;
  state.inkSecondary = els.inkSecondary.value;
  state.inkAccent = els.inkAccent.value;
  state.size = els.size.value;
  state.quantity = Number(els.quantity.value || 1);
  state.maxSpendUsd = els.maxSpendUsd.value;
  state.provider = els.provider.value;
  state.style = els.style.value;
  state.shippingAddress = els.shippingAddress.value;
  render();
}

function applyDesign(design) {
  state.design = design;
  state.headline = design.headline || state.headline;
  state.subline = design.subline || state.subline;
  state.motif = design.motif || state.motif;
  state.inkPrimary = design.inkPrimary || state.inkPrimary;
  state.inkSecondary = design.inkSecondary || state.inkSecondary;
  state.inkAccent = design.inkAccent || state.inkAccent;
  els.headline.value = state.headline;
  els.subline.value = state.subline;
  els.inkPrimary.value = state.inkPrimary;
  els.inkSecondary.value = state.inkSecondary;
  els.inkAccent.value = state.inkAccent;
  render();
}

function showResult(kind, payload) {
  els.result.hidden = false;
  els.result.className = `result ${kind}`;
  els.result.textContent =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function showBanner(kind, title, message) {
  els.statusBanner.hidden = false;
  els.statusBanner.className = `status-banner ${kind === "error" ? "error" : ""}`;
  els.statusBanner.replaceChildren();
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  els.statusBanner.append(titleEl, messageEl);
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function requestBody() {
  syncFromInputs();
  localStorage.setItem("ottoauth_tshirt_state", JSON.stringify(state));
  return {
    state: { ...state, design: { ...state.design } },
  };
}

async function generateDesign() {
  syncFromInputs();
  els.agentButton.disabled = true;
  try {
    const { response, payload } = await postJson("/api/agent-design", {
      prompt: state.prompt,
      headline: state.headline,
      subline: state.subline,
      shirtColor: state.shirtColor,
      inkPrimary: state.inkPrimary,
      inkSecondary: state.inkSecondary,
      inkAccent: state.inkAccent,
      vibe: `${state.provider} ${state.style}`,
    });
    if (!response.ok) throw new Error(payload?.error || "Could not generate design.");
    applyDesign(payload.design);
    showResult("ok", { design: payload.design });
  } catch (error) {
    showResult("error", error instanceof Error ? error.message : "Design failed.");
  } finally {
    els.agentButton.disabled = false;
  }
}

async function previewOrder() {
  try {
    const { response, payload } = await postJson("/api/ottoauth-preview", requestBody());
    if (!response.ok) throw new Error(payload?.error || "Preview failed.");
    els.payloadPreview.textContent = JSON.stringify(payload.orderPayload, null, 2);
    els.payloadPreview.hidden = false;
  } catch (error) {
    showResult("error", error instanceof Error ? error.message : "Preview failed.");
  }
}

async function buyWithOttoAuth() {
  els.buyButton.disabled = true;
  try {
    showBanner("ok", "Opening OttoAuth", "Creating the hosted checkout with the artwork attached.");
    const { response, payload } = await postJson("/api/buy", requestBody());
    els.payloadPreview.textContent = JSON.stringify(payload?.request || {}, null, 2);
    if (!response.ok) {
      showResult("error", payload || "OttoAuth order failed.");
      showBanner("error", "Checkout failed", payload?.error || "OttoAuth could not create the checkout.");
      return;
    }
    const checkoutUrl = payload.checkoutUrl || payload.response?.url || payload.response?.session?.url;
    if (!checkoutUrl) {
      showResult("error", payload.response || payload || "Missing checkout URL.");
      return;
    }
    showResult("ok", {
      checkout_session: payload.response?.id || payload.response?.session?.id,
      redirecting_to: checkoutUrl,
    });
    window.location.href = checkoutUrl;
  } catch (error) {
    showResult("error", error instanceof Error ? error.message : "Buy failed.");
  } finally {
    els.buyButton.disabled = false;
  }
}

function showReturnStatus() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("ottoauth_checkout");
  if (!status) return;
  const payload = { checkout: status };
  const orderId = params.get("order_id");
  const taskId = params.get("task_id");
  if (orderId) payload.order_id = orderId;
  if (taskId) payload.task_id = taskId;
  if (status === "success") {
    showBanner(
      "ok",
      "Order confirmed",
      "OttoAuth received the order, artwork, and spend cap for human fulfillment.",
    );
  } else {
    showBanner("error", "Checkout canceled", "No order was submitted.");
  }
  showResult(status === "success" ? "ok" : "error", payload);
  window.history.replaceState({}, "", window.location.pathname);
}

function randomize() {
  const prompts = [
    "campus robotics club with a crisp orbit mark",
    "quiet workbench shirt for a small hardware studio",
    "sunny neighborhood makerspace drop",
    "minimal systems shirt for local software builders",
  ];
  els.prompt.value = prompts[Math.floor(Math.random() * prompts.length)];
  generateDesign();
}

function restoreSavedState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("ottoauth_tshirt_state") || "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") return;

  Object.assign(state, saved);
  state.design = {
    ...state.design,
    ...(saved.design && typeof saved.design === "object" ? saved.design : {}),
  };
  els.prompt.value = state.prompt || "";
  els.headline.value = state.headline || "";
  els.subline.value = state.subline || "";
  els.inkPrimary.value = state.inkPrimary || "#12355b";
  els.inkSecondary.value = state.inkSecondary || "#f26d3d";
  els.inkAccent.value = state.inkAccent || "#f7d154";
  els.size.value = state.size || "M";
  els.quantity.value = state.quantity || 1;
  els.maxSpendUsd.value = state.maxSpendUsd || "20";
  els.provider.value = state.provider || "custom_ink";
  els.style.value = state.style || "classic unisex tee";
  els.shippingAddress.value = state.shippingAddress || "";
}

document.querySelectorAll("input, select, textarea").forEach((input) => {
  input.addEventListener("input", syncFromInputs);
});

document.querySelectorAll("[data-motif]").forEach((button) => {
  button.addEventListener("click", () => {
    state.motif = button.dataset.motif;
    render();
  });
});

document.querySelectorAll("[data-shirt]").forEach((button) => {
  button.addEventListener("click", () => {
    state.shirtColor = button.dataset.shirt;
    state.shirtColorName = button.dataset.name;
    render();
  });
});

els.agentButton.addEventListener("click", generateDesign);
els.randomizeButton.addEventListener("click", randomize);
els.buyButton.addEventListener("click", buyWithOttoAuth);

restoreSavedState();
render();
const returnParams = new URLSearchParams(window.location.search);
if (returnParams.has("ottoauth_checkout")) {
  showReturnStatus();
}
