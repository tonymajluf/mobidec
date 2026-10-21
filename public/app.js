const productGrid = document.querySelector("#productGrid");
const filters = document.querySelector("#filters");
const searchInput = document.querySelector("#searchInput");
const resultMeta = document.querySelector("#resultMeta");
const emptyState = document.querySelector("#emptyState");
const statusLabel = document.querySelector("#connectionStatus");
const dialog = document.querySelector("#adminDialog");
const loginPanel = document.querySelector("#loginPanel");
const dashboardPanel = document.querySelector("#dashboardPanel");
const adminProducts = document.querySelector("#adminProducts");
const productForm = document.querySelector("#productForm");
const loginForm = document.querySelector("#loginForm");

let products = [];
let selectedType = "Todos";
let source = "demo";
let photoMode = "url";
let toastTimer;

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3300);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}

function renderFilters() {
  const types = ["Todos", ...new Set(products.map((product) => product.tipo).filter(Boolean))];
  if (!types.includes(selectedType)) selectedType = "Todos";
  filters.innerHTML = types.map((type) =>
    `<button class="filter-button${type === selectedType ? " active" : ""}" type="button" data-type="${escapeHtml(type)}">${escapeHtml(type)}</button>`
  ).join("");
}

function renderProducts() {
  const query = searchInput.value.trim().toLocaleLowerCase("es");
  const visibleProducts = products.filter((product) => {
    const matchesType = selectedType === "Todos" || product.tipo === selectedType;
    const searchable = [product.tipo, product.diseno, product.modelo, product.descripcion].join(" ").toLocaleLowerCase("es");
    return matchesType && searchable.includes(query);
  });
  resultMeta.textContent = `${String(visibleProducts.length).padStart(2, "0")} ${visibleProducts.length === 1 ? "PIEZA" : "PIEZAS"} · SELECCIÓN GM`;
  productGrid.innerHTML = visibleProducts.map((product) => {
    const photo = String(product.foto || "");
    const imageMarkup = photo
      ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(product.modelo)}" loading="lazy">`
      : `<span class="photo-empty" aria-label="Sin foto">g.</span>`;
    const price = product.precio === "" || product.precio == null ? NaN : Number(product.precio);
    return `<article class="product-card">
      <div class="product-photo">${imageMarkup}<span class="product-type">${escapeHtml(product.tipo)}</span></div>
      <div class="product-info"><div>
        <p class="product-design">${escapeHtml(product.diseno)}</p>
        <h3 class="product-name">${escapeHtml(product.modelo)}</h3>
        <p class="product-description">${escapeHtml(product.descripcion)}</p>
      </div><span class="product-price">${Number.isFinite(price) ? money.format(price) : "Consultar"}</span></div>
    </article>`;
  }).join("");
  productGrid.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => {
      const placeholder = document.createElement("span");
      placeholder.className = "photo-empty";
      placeholder.setAttribute("aria-label", "Foto no disponible");
      placeholder.textContent = "g.";
      image.replaceWith(placeholder);
    }, { once: true });
  });
  emptyState.hidden = visibleProducts.length > 0;
}

async function loadCatalog() {
  const result = await requestJson("/api/products");
  products = result.products || [];
  source = result.source;
  photoMode = result.photoMode || "url";
  statusLabel.textContent = source === "filemaker"
    ? "Sincronizado desde FileMaker"
    : "Modo demostración · No sincronizado con FileMaker";
  statusLabel.dataset.source = source;
  renderFilters();
  renderProducts();
}

function renderAdminProducts() {
  adminProducts.innerHTML = products.map((product) => {
    const price = product.precio === "" || product.precio == null ? NaN : Number(product.precio);
    return `<div class="admin-product-row">
      ${product.foto ? `<img src="${escapeHtml(product.foto)}" alt="" loading="lazy">` : `<span class="photo-empty">g.</span>`}
      <div><strong>${escapeHtml(product.modelo)}</strong><small>${escapeHtml(product.tipo)} · ${Number.isFinite(price) ? money.format(price) : "Precio pendiente"}</small></div>
      <button class="row-action" type="button" data-edit="${escapeHtml(product.id)}">Editar</button>
      <button class="row-action delete" type="button" data-delete="${escapeHtml(product.id)}">Borrar</button>
    </div>`;
  }).join("") || `<p class="dialog-description">Todavía no hay productos. Añade la primera pieza.</p>`;
}

function resetProductForm() {
  productForm.reset();
  document.querySelector("#productId").value = "";
  document.querySelector("#productFormTitle").textContent = "Añadir pieza";
  document.querySelector("#productMessage").textContent = "";
  productForm.elements.foto.disabled = false;
  productForm.elements.foto.placeholder = "https://...";
  document.querySelector("#photoHelp").textContent = "Usa la URL HTTPS pública de la imagen.";
  productForm.hidden = true;
}

function beginEdit(product) {
  productForm.hidden = false;
  document.querySelector("#productId").value = product.id;
  document.querySelector("#productFormTitle").textContent = "Editar pieza";
  const containerPhoto = (source === "filemaker" && photoMode === "container") ||
    String(product.foto || "").startsWith("/api/products/");
  for (const key of ["tipo", "diseno", "modelo", "descripcion", "precio", "foto"]) {
    const value = key === "foto" && containerPhoto ? "" : product[key];
    productForm.elements[key].value = value ?? "";
  }
  productForm.elements.foto.disabled = containerPhoto;
  document.querySelector("#photoHelp").textContent = containerPhoto
    ? "Foto almacenada en contenedor FileMaker; cámbiala directamente en FileMaker."
    : "Usa la URL HTTPS pública de la imagen.";
  productForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function refreshAdmin() {
  const { authenticated } = await requestJson("/api/admin/status");
  loginPanel.hidden = authenticated;
  dashboardPanel.hidden = !authenticated;
  if (authenticated) {
    await loadCatalog();
    renderAdminProducts();
    document.querySelector("#adminModeLabel").textContent = source === "filemaker"
      ? "Los cambios se guardan directamente en FileMaker."
      : "Modo demostración local: los cambios no se sincronizan con FileMaker.";
  }
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) return;
  selectedType = button.dataset.type;
  renderFilters();
  renderProducts();
});

searchInput.addEventListener("input", renderProducts);
document.querySelector("#year").textContent = String(new Date().getFullYear());
document.querySelector("#adminOpen").addEventListener("click", async () => {
  dialog.showModal();
  try {
    await refreshAdmin();
  } catch (error) {
    document.querySelector("#loginMessage").textContent = error.message;
  }
});
document.querySelector("#adminClose").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  document.querySelector("#loginMessage").textContent = "";
  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: loginForm.elements.password.value })
    });
    loginForm.reset();
    await refreshAdmin();
  } catch (error) {
    document.querySelector("#loginMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  try {
    await requestJson("/api/admin/logout", { method: "POST", body: "{}" });
    resetProductForm();
    await refreshAdmin();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#addProductButton").addEventListener("click", () => {
  resetProductForm();
  productForm.hidden = false;
  if (source === "filemaker" && photoMode === "container") {
    productForm.elements.foto.disabled = true;
    document.querySelector("#photoHelp").textContent = "El campo es un contenedor FileMaker; carga la foto directamente en FileMaker.";
  }
  productForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  productForm.elements.tipo.focus();
});
document.querySelector("#cancelEdit").addEventListener("click", resetProductForm);
document.querySelector("#cancelEditSecondary").addEventListener("click", resetProductForm);

adminProducts.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  if (editButton) {
    const product = products.find((item) => String(item.id) === editButton.dataset.edit);
    if (product) beginEdit(product);
    return;
  }
  if (!deleteButton) return;
  const product = products.find((item) => String(item.id) === deleteButton.dataset.delete);
  if (!product || !window.confirm(`¿Borrar “${product.modelo}” del catálogo?`)) return;
  deleteButton.disabled = true;
  try {
    await requestJson(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    await loadCatalog();
    renderAdminProducts();
    showToast("La pieza se eliminó correctamente.");
  } catch (error) {
    deleteButton.disabled = false;
    showToast(error.message);
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = document.querySelector("#productId").value;
  const product = Object.fromEntries(["tipo", "diseno", "modelo", "descripcion", "precio", "foto"].map((key) => [
    key, productForm.elements[key].value.trim()
  ]));
  product.precio = Number(product.precio);
  const button = productForm.querySelector("button[type=submit]");
  const message = document.querySelector("#productMessage");
  button.disabled = true;
  message.textContent = "";
  try {
    await requestJson(productId ? `/api/admin/products/${encodeURIComponent(productId)}` : "/api/admin/products", {
      method: productId ? "PUT" : "POST",
      body: JSON.stringify(product)
    });
    await loadCatalog();
    renderAdminProducts();
    resetProductForm();
    showToast(source === "filemaker" ? "La pieza se guardó en FileMaker." : "La pieza se guardó en el catálogo demo local.");
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

loadCatalog().catch((error) => {
  statusLabel.textContent = `No se pudo cargar el catálogo: ${error.message}`;
  statusLabel.dataset.source = "error";
  resultMeta.textContent = "No fue posible conectar con el catálogo.";
});
