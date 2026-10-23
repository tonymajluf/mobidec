const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEMO_FILE = path.join(ROOT, "data", "demo-products.json");
const DATA_FILE = path.join(ROOT, "data", "products.json");

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fsSync.existsSync(envPath)) return;
  for (const line of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#") || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "gmobidec_admin";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const fmTokenState = { token: null, expiresAt: 0 };
const propertyNames = ["tipo", "diseno", "modelo", "descripcion", "precio", "foto"];
const defaultFields = {
  tipo: "Tipo",
  diseno: "Diseño",
  modelo: "Modelo",
  descripcion: "Descripción",
  precio: "Precio Web",
  foto: "Foto 1"
};

function fileMakerConfig() {
  const configured = [
    process.env.FM_BASE_URL,
    process.env.FM_DATABASE,
    process.env.FM_LAYOUT,
    process.env.FM_USERNAME,
    process.env.FM_PASSWORD
  ];
  const count = configured.filter(Boolean).length;
  if (count === 0) return null;
  if (count !== configured.length) {
    throw new Error("Configure FM_BASE_URL, FM_DATABASE, FM_LAYOUT, FM_USERNAME y FM_PASSWORD juntos.");
  }

  let fields = defaultFields;
  if (process.env.FM_FIELDS_JSON) {
    try {
      const customFields = JSON.parse(process.env.FM_FIELDS_JSON);
      if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
        throw new Error("debe ser un objeto JSON");
      }
      fields = { ...defaultFields, ...customFields };
    } catch (error) {
      throw new Error(`FM_FIELDS_JSON no es válido: ${error.message}`);
    }
  }
  for (const property of propertyNames) {
    if (typeof fields[property] !== "string" || !fields[property].trim()) {
      throw new Error(`FM_FIELDS_JSON necesita un nombre de campo para "${property}".`);
    }
  }
  const photoMode = process.env.FM_PHOTO_MODE || "container";
  if (!["url", "container"].includes(photoMode)) {
    throw new Error('FM_PHOTO_MODE debe ser "url" o "container".');
  }

  let baseUrl;
  try {
    baseUrl = new URL(process.env.FM_BASE_URL);
  } catch {
    throw new Error("FM_BASE_URL debe ser una URL HTTPS válida.");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("FM_BASE_URL debe ser HTTPS y no incluir credenciales, parámetros ni fragmentos.");
  }

  return {
    baseUrl: process.env.FM_BASE_URL.replace(/\/+$/, ""),
    database: process.env.FM_DATABASE,
    layout: process.env.FM_LAYOUT,
    username: process.env.FM_USERNAME,
    password: process.env.FM_PASSWORD,
    photoMode,
    fields
  };
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("El cuerpo de la solicitud es demasiado grande."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("El cuerpo debe ser JSON válido."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateProduct(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("El producto debe ser un objeto."), { status: 400 });
  }
  const product = {
    tipo: String(value.tipo || "").trim(),
    diseno: String(value.diseno || "").trim(),
    modelo: String(value.modelo || "").trim(),
    descripcion: String(value.descripcion || "").trim(),
    precio: Number(value.precio),
    foto: String(value.foto || "").trim()
  };
  if (!product.tipo || !product.diseno || !product.modelo || !product.descripcion) {
    throw Object.assign(new Error("Completa Tipo, Diseño, Modelo y Descripción."), { status: 400 });
  }
  if (!Number.isFinite(product.precio) || product.precio < 0) {
    throw Object.assign(new Error("Precio Web debe ser un número igual o mayor que cero."), { status: 400 });
  }
  if (product.foto && !/^(https:\/\/|data:image\/)/i.test(product.foto)) {
    throw Object.assign(new Error("Foto 1 debe ser una URL HTTPS o una imagen data:image válida."), { status: 400 });
  }
  return product;
}

async function readDemoProducts() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return JSON.parse(await fs.readFile(DEMO_FILE, "utf8"));
  }
}

async function saveDemoProducts(products) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(products, null, 2)}\n`, "utf8");
}

function fmUrl(config, suffix) {
  return `${config.baseUrl}/fmi/data/vLatest/databases/${encodeURIComponent(config.database)}/${suffix}`;
}

async function getFileMakerToken(config) {
  const now = Date.now();
  if (fmTokenState.token && fmTokenState.expiresAt > now) return fmTokenState.token;
  const login = await fetch(fmUrl(config, "sessions"), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const loginBody = await login.json().catch(() => ({}));
  if (!login.ok || !loginBody.response?.token) {
    const description = loginBody.messages?.[0]?.message || login.statusText;
    throw Object.assign(new Error(`FileMaker rechazó el inicio de sesión: ${description}`), { status: 502 });
  }
  fmTokenState.token = loginBody.response.token;
  fmTokenState.expiresAt = now + 14 * 60 * 1000;
  return fmTokenState.token;
}

async function fileMakerRequest(config, suffix, options = {}, retry = true) {
  const token = await getFileMakerToken(config);
  const result = await fetch(fmUrl(config, suffix), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok && retry && String(body.messages?.[0]?.code) === "952") {
    fmTokenState.token = null;
    fmTokenState.expiresAt = 0;
    return fileMakerRequest(config, suffix, options, false);
  }
  if (!result.ok) {
    const description = body.messages?.[0]?.message || result.statusText;
    throw Object.assign(new Error(`FileMaker Data API respondió ${result.status}: ${description}`), { status: 502 });
  }
  return body.response || {};
}

async function fileMakerImage(config, suffix, retry = true) {
  const token = await getFileMakerToken(config);
  const result = await fetch(fmUrl(config, suffix), {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*" }
  });
  if (result.ok && result.headers.get("content-type")?.startsWith("image/")) {
    return {
      contentType: result.headers.get("content-type"),
      content: Buffer.from(await result.arrayBuffer())
    };
  }
  const body = await result.json().catch(() => ({}));
  if (retry && String(body.messages?.[0]?.code) === "952") {
    fmTokenState.token = null;
    fmTokenState.expiresAt = 0;
    return fileMakerImage(config, suffix, false);
  }
  const description = body.messages?.[0]?.message || result.statusText;
  throw Object.assign(new Error(`No se pudo descargar Foto 1 desde FileMaker: ${description}`), { status: 502 });
}

function mapFromFileMaker(record, config) {
  const fields = record.fieldData || {};
  const product = { id: String(record.recordId) };
  for (const key of propertyNames) {
    product[key] = fields[config.fields[key]] ?? "";
  }
  const photo = String(product.foto || "");
  if (photo && (config.photoMode === "container" || !/^(https:\/\/|data:image\/)/i.test(photo))) {
    product.foto = `/api/products/${encodeURIComponent(product.id)}/photo`;
  }
  const parsedPrice = String(product.precio).trim() ? Number(product.precio) : NaN;
  product.precio = Number.isFinite(parsedPrice) ? parsedPrice : "";
  return product;
}

function mapToFileMaker(product, config, { omitBlankPhoto = false } = {}) {
  const fields = {};
  for (const key of propertyNames) {
    if (omitBlankPhoto && key === "foto" && !product.foto) continue;
    fields[config.fields[key]] = product[key];
  }
  return fields;
}

async function getProducts(config) {
  if (!config) return { products: await readDemoProducts(), source: "demo", photoMode: "url" };
  const layout = encodeURIComponent(config.layout);
  const result = await fileMakerRequest(config, `layouts/${layout}/records?_limit=1000`);
  return {
    products: (result.data || []).map((record) => mapFromFileMaker(record, config)),
    source: "filemaker",
    photoMode: config.photoMode
  };
}

function getSession(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function sameOrigin(request) {
  if (!request.headers.origin) return true;
  return request.headers.origin === `http://${request.headers.host}` ||
    request.headers.origin === `https://${request.headers.host}`;
}

function requireAdmin(request, response) {
  if (!sameOrigin(request)) {
    jsonResponse(response, 403, { error: "Origen no permitido." });
    return false;
  }
  if (!getSession(request)) {
    jsonResponse(response, 401, { error: "Inicia sesión para administrar el catálogo." });
    return false;
  }
  return true;
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const fullPath = path.resolve(PUBLIC_DIR, relativePath);
  if (!fullPath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    jsonResponse(response, 404, { error: "No encontrado." });
    return;
  }
  try {
    const content = await fs.readFile(fullPath);
    response.writeHead(200, {
      "Content-Type": contentType(fullPath),
      "Cache-Control": fullPath.endsWith(".html") ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    jsonResponse(response, 404, { error: "No encontrado." });
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/")) {
    await serveStatic(request, response, pathname);
    return;
  }
  const needsCatalogConfig = pathname === "/api/status" ||
    pathname === "/api/products" ||
    /^\/api\/admin\/products(?:\/|$)/.test(pathname) ||
    /^\/api\/products\/[^/]+\/photo$/.test(pathname);
  const config = needsCatalogConfig ? fileMakerConfig() : null;

  if (request.method === "GET" && pathname === "/api/status") {
    jsonResponse(response, 200, { source: config ? "filemaker" : "demo", configured: Boolean(config) });
    return;
  }
  if (request.method === "GET" && pathname === "/api/products") {
    const result = await getProducts(config);
    jsonResponse(response, 200, result);
    return;
  }
  if (request.method === "POST" && pathname === "/api/admin/login") {
    if (!sameOrigin(request)) {
      jsonResponse(response, 403, { error: "Origen no permitido." });
      return;
    }
    const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "demo");
    if (!password) {
      jsonResponse(response, 503, { error: "Configura ADMIN_PASSWORD antes de activar el panel de administración." });
      return;
    }
    const body = await readBody(request);
    const supplied = Buffer.from(String(body.password || ""));
    const expected = Buffer.from(password);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      jsonResponse(response, 401, { error: "Contraseña incorrecta." });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/status") {
    jsonResponse(response, 200, { authenticated: getSession(request) });
    return;
  }
  if (request.method === "POST" && pathname === "/api/admin/logout") {
    if (!sameOrigin(request)) {
      jsonResponse(response, 403, { error: "Origen no permitido." });
      return;
    }
    const cookie = request.headers.cookie || "";
    const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (token) sessions.delete(token);
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    jsonResponse(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/products") {
    if (!requireAdmin(request, response)) return;
    const product = validateProduct(await readBody(request));
    if (config) {
      const layout = encodeURIComponent(config.layout);
      const result = await fileMakerRequest(config, `layouts/${layout}/records`, {
        method: "POST",
        body: JSON.stringify({
          fieldData: mapToFileMaker(product, config, { omitBlankPhoto: config.photoMode === "container" })
        })
      });
      jsonResponse(response, 201, { product: { ...product, id: String(result.recordId) } });
      return;
    }
    const products = await readDemoProducts();
    product.id = crypto.randomUUID();
    products.unshift(product);
    await saveDemoProducts(products);
    jsonResponse(response, 201, { product });
    return;
  }

  const productRoute = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productRoute && ["PUT", "DELETE"].includes(request.method)) {
    if (!requireAdmin(request, response)) return;
    const id = decodeURIComponent(productRoute[1]);
    if (config) {
      const layout = encodeURIComponent(config.layout);
      if (request.method === "DELETE") {
        await fileMakerRequest(config, `layouts/${layout}/records/${encodeURIComponent(id)}`, { method: "DELETE" });
        jsonResponse(response, 200, { ok: true });
        return;
      }
      const product = validateProduct(await readBody(request));
      await fileMakerRequest(config, `layouts/${layout}/records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          fieldData: mapToFileMaker(product, config, {
            omitBlankPhoto: config.photoMode === "container" || !product.foto
          })
        })
      });
      jsonResponse(response, 200, { product: { ...product, id } });
      return;
    }
    const products = await readDemoProducts();
    const index = products.findIndex((item) => String(item.id) === id);
    if (index < 0) {
      jsonResponse(response, 404, { error: "Producto no encontrado." });
      return;
    }
    if (request.method === "DELETE") {
      products.splice(index, 1);
      await saveDemoProducts(products);
      jsonResponse(response, 200, { ok: true });
      return;
    }
    const product = validateProduct(await readBody(request));
    products[index] = { ...product, id };
    await saveDemoProducts(products);
    jsonResponse(response, 200, { product: products[index] });
    return;
  }

  const photoRoute = pathname.match(/^\/api\/products\/([^/]+)\/photo$/);
  if (request.method === "GET" && photoRoute) {
    if (!config) {
      jsonResponse(response, 404, { error: "La foto no está disponible." });
      return;
    }
    const recordId = decodeURIComponent(photoRoute[1]);
    const layout = encodeURIComponent(config.layout);
    const field = encodeURIComponent(config.fields.foto);
    const image = await fileMakerImage(config, `layouts/${layout}/records/${encodeURIComponent(recordId)}/containers/${field}/1`);
    response.writeHead(200, {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(image.content);
    return;
  }

  await serveStatic(request, response, pathname);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = error.status || 500;
    if (status >= 500) console.error(error.message);
    if (!response.headersSent) jsonResponse(response, status, { error: error.message || "Error interno del servidor." });
    else response.destroy();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`gMobidec está disponible en http://localhost:${PORT}`);
  try {
    console.log(fileMakerConfig()
      ? "Origen de catálogo: FileMaker Data API"
      : "Origen de catálogo: demostración local (sin sincronización FileMaker)");
  } catch (error) {
    console.error(`Configuración FileMaker incompleta: ${error.message}`);
  }
});
