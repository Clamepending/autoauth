const state = {
  material: "PLA",
  color: "black",
  quantity: 1,
  maxSpendUsd: "20",
  infill: "20%",
  layerHeight: "0.20 mm",
  finish: "standard",
  provider: "treatstock",
  shippingAddress: "",
  notes: "",
  analysis: null,
};

let selectedFile = null;

const els = {
  stlFile: document.querySelector("#stlFile"),
  sampleButton: document.querySelector("#sampleButton"),
  checkoutButton: document.querySelector("#checkoutButton"),
  material: document.querySelector("#material"),
  color: document.querySelector("#color"),
  quantity: document.querySelector("#quantity"),
  maxSpendUsd: document.querySelector("#maxSpendUsd"),
  infill: document.querySelector("#infill"),
  layerHeight: document.querySelector("#layerHeight"),
  finish: document.querySelector("#finish"),
  provider: document.querySelector("#provider"),
  shippingAddress: document.querySelector("#shippingAddress"),
  notes: document.querySelector("#notes"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  triangles: document.querySelector("#triangles"),
  bounds: document.querySelector("#bounds"),
  volume: document.querySelector("#volume"),
  estimate: document.querySelector("#estimate"),
  sideEstimate: document.querySelector("#sideEstimate"),
  result: document.querySelector("#result"),
  statusBanner: document.querySelector("#statusBanner"),
};

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function bytes(size) {
  if (!Number.isFinite(size)) return "-";
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  if (size > 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function estimateCents() {
  const quantity = Math.max(1, Number(state.quantity || 1));
  const volumeCm3 = Number(state.analysis?.volume_cm3 || 0);
  const billableVolume = Math.max(8, Math.min(2000, volumeCm3 || 20));
  const material = String(state.material || "PLA").toLowerCase();
  const rate =
    material === "resin" ? 36 : material === "nylon" ? 45 : material === "petg" ? 24 : 18;
  const setup = material === "resin" ? 1200 : 900;
  const finish = String(state.finish || "").toLowerCase();
  const finishCents = finish.includes("smooth") || finish.includes("paint") ? 900 : 0;
  return Math.max(1800, Math.round((setup + billableVolume * rate + finishCents) * quantity));
}

function syncFromInputs() {
  state.material = els.material.value;
  state.color = els.color.value;
  state.quantity = Number(els.quantity.value || 1);
  state.maxSpendUsd = els.maxSpendUsd.value;
  state.infill = els.infill.value;
  state.layerHeight = els.layerHeight.value;
  state.finish = els.finish.value;
  state.provider = els.provider.value;
  state.shippingAddress = els.shippingAddress.value;
  state.notes = els.notes.value;
  const estimate = money(estimateCents());
  els.estimate.textContent = estimate;
  els.sideEstimate.textContent = estimate;
}

function showResult(kind, payload) {
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

function triangleVolume(a, b, c) {
  return (
    a.x * (b.y * c.z - b.z * c.y) -
    a.y * (b.x * c.z - b.z * c.x) +
    a.z * (b.x * c.y - b.y * c.x)
  ) / 6;
}

function boundsAccumulator() {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

function addPoint(bounds, point) {
  bounds.min.x = Math.min(bounds.min.x, point.x);
  bounds.min.y = Math.min(bounds.min.y, point.y);
  bounds.min.z = Math.min(bounds.min.z, point.z);
  bounds.max.x = Math.max(bounds.max.x, point.x);
  bounds.max.y = Math.max(bounds.max.y, point.y);
  bounds.max.z = Math.max(bounds.max.z, point.z);
}

function finishAnalysis({ name, size, triangleCount, bounds, volumeMm3, mode }) {
  const hasBounds = Number.isFinite(bounds.min.x);
  const boundsMm = hasBounds
    ? {
        x: Math.max(0, bounds.max.x - bounds.min.x),
        y: Math.max(0, bounds.max.y - bounds.min.y),
        z: Math.max(0, bounds.max.z - bounds.min.z),
      }
    : null;
  return {
    name,
    size,
    mode,
    triangle_count: triangleCount,
    bounds_mm: boundsMm,
    volume_cm3: Math.abs(volumeMm3 || 0) / 1000,
  };
}

function parseBinaryStl(name, buffer) {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const bounds = boundsAccumulator();
  let volumeMm3 = 0;
  let offset = 84;
  for (let index = 0; index < triangleCount; index += 1) {
    offset += 12;
    const vertices = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point = {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true),
      };
      vertices.push(point);
      addPoint(bounds, point);
      offset += 12;
    }
    volumeMm3 += triangleVolume(vertices[0], vertices[1], vertices[2]);
    offset += 2;
  }
  return finishAnalysis({
    name,
    size: buffer.byteLength,
    triangleCount,
    bounds,
    volumeMm3,
    mode: "binary",
  });
}

function parseAsciiStl(name, buffer) {
  const text = new TextDecoder().decode(buffer);
  const matches = text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g);
  const bounds = boundsAccumulator();
  const vertices = [];
  let volumeMm3 = 0;
  let triangleCount = 0;
  for (const match of matches) {
    const point = {
      x: Number(match[1]),
      y: Number(match[2]),
      z: Number(match[3]),
    };
    if (!Number.isFinite(point.x + point.y + point.z)) continue;
    vertices.push(point);
    addPoint(bounds, point);
    if (vertices.length === 3) {
      volumeMm3 += triangleVolume(vertices[0], vertices[1], vertices[2]);
      vertices.length = 0;
      triangleCount += 1;
    }
  }
  return finishAnalysis({
    name,
    size: buffer.byteLength,
    triangleCount,
    bounds,
    volumeMm3,
    mode: "ascii",
  });
}

function parseStl(name, buffer) {
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    if (84 + triangleCount * 50 === buffer.byteLength) {
      return parseBinaryStl(name, buffer);
    }
  }
  return parseAsciiStl(name, buffer);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function updateStats() {
  const analysis = state.analysis;
  els.fileName.textContent = selectedFile?.name || "No STL selected";
  els.fileSize.textContent = selectedFile ? bytes(selectedFile.size) : "-";
  els.triangles.textContent = analysis?.triangle_count ? String(analysis.triangle_count) : "-";
  els.bounds.textContent = analysis?.bounds_mm
    ? `${analysis.bounds_mm.x.toFixed(1)} x ${analysis.bounds_mm.y.toFixed(1)} x ${analysis.bounds_mm.z.toFixed(1)} mm`
    : "-";
  els.volume.textContent =
    analysis && Number.isFinite(analysis.volume_cm3)
      ? `${analysis.volume_cm3.toFixed(2)} cm3`
      : "-";
  syncFromInputs();
}

async function setSelectedStl(name, buffer, type = "model/stl") {
  if (!/\.stl$/i.test(name)) throw new Error("Choose a .stl file.");
  if (buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error("This demo accepts STL files up to 25 MB.");
  }
  const analysis = parseStl(name, buffer);
  selectedFile = {
    name,
    size: buffer.byteLength,
    content_type: type || "model/stl",
    content_base64: arrayBufferToBase64(buffer),
  };
  state.analysis = analysis;
  updateStats();
  showResult("ok", `${name} is ready to print.`);
}

async function loadChosenFile() {
  const file = els.stlFile.files?.[0];
  if (!file) return;
  try {
    await setSelectedStl(file.name, await file.arrayBuffer(), file.type || "model/stl");
  } catch (error) {
    showResult("error", error instanceof Error ? error.message : "Could not read STL.");
  }
}

function sampleCubeStl() {
  const triangles = [
    [[0, 0, 0], [20, 0, 0], [20, 20, 0]], [[0, 0, 0], [20, 20, 0], [0, 20, 0]],
    [[0, 0, 20], [20, 20, 20], [20, 0, 20]], [[0, 0, 20], [0, 20, 20], [20, 20, 20]],
    [[0, 0, 0], [0, 0, 20], [20, 0, 20]], [[0, 0, 0], [20, 0, 20], [20, 0, 0]],
    [[20, 0, 0], [20, 0, 20], [20, 20, 20]], [[20, 0, 0], [20, 20, 20], [20, 20, 0]],
    [[20, 20, 0], [20, 20, 20], [0, 20, 20]], [[20, 20, 0], [0, 20, 20], [0, 20, 0]],
    [[0, 20, 0], [0, 20, 20], [0, 0, 20]], [[0, 20, 0], [0, 0, 20], [0, 0, 0]],
  ];
  return `solid sample_cube\n${triangles
    .map(
      (tri) => `facet normal 0 0 0
  outer loop
${tri.map((point) => `    vertex ${point[0]} ${point[1]} ${point[2]}`).join("\n")}
  endloop
endfacet`,
    )
    .join("\n")}\nendsolid sample_cube\n`;
}

async function loadSampleCube() {
  const buffer = new TextEncoder().encode(sampleCubeStl()).buffer;
  await setSelectedStl("sample-cube-20mm.stl", buffer, "model/stl");
}

function requestBody() {
  syncFromInputs();
  if (!selectedFile) throw new Error("Choose an STL file first.");
  return {
    state: { ...state, analysis: state.analysis ? { ...state.analysis } : null },
    file: { ...selectedFile },
  };
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

async function buyWithOttoAuth() {
  els.checkoutButton.disabled = true;
  try {
    showResult("ok", "Creating checkout...");
    const { response, payload } = await postJson("/api/buy", requestBody());
    if (!response.ok) throw new Error(payload?.error || "Could not create checkout.");
    const checkoutUrl = payload.checkoutUrl || payload.session?.url;
    if (!checkoutUrl) throw new Error("OttoAuth did not return a checkout URL.");
    window.location.href = checkoutUrl;
  } catch (error) {
    showResult("error", error instanceof Error ? error.message : "Buy failed.");
  } finally {
    els.checkoutButton.disabled = false;
  }
}

function showReturnStatus() {
  const params = new URLSearchParams(window.location.search);
  const orderStatus = params.get("print_order");
  if (!orderStatus) return false;
  window.history.replaceState({}, "", window.location.pathname);
  if (orderStatus === "success") {
    showBanner("ok", "Print order confirmed", "OttoAuth received the STL, print specs, and spend cap for fulfillment.");
    showResult("ok", {
      checkout: "success",
      order_id: params.get("order_id"),
      task_id: params.get("task_id"),
    });
  } else {
    showBanner("error", "Checkout canceled", "No print order was submitted.");
    showResult("error", { checkout: orderStatus });
  }
  return true;
}

document.querySelectorAll("input, select, textarea").forEach((input) => {
  input.addEventListener("input", () => {
    syncFromInputs();
    updateStats();
  });
});

els.stlFile.addEventListener("change", loadChosenFile);
els.sampleButton.addEventListener("click", loadSampleCube);
els.checkoutButton.addEventListener("click", buyWithOttoAuth);

syncFromInputs();
updateStats();
if (!showReturnStatus()) {
  showResult("ok", "Choose an STL or use the sample cube.");
}
