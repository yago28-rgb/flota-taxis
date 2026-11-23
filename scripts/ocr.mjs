// Inicia el motor local de reconocimiento (ocr-engine) con el Python de su entorno virtual.
//   npm run ocr          → arranca el servicio en 127.0.0.1:8765
//   npm run ocr:setup    → crea el entorno e instala dependencias (una vez)
//   npm run ocr:test     → pruebas de las reglas de extracción
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(root, "ocr-engine");
// Ruta corta: Windows limita la longitud de las rutas y PaddleOCR tiene ficheros muy anidados.
const venv =
  process.env.OCR_VENV ||
  (process.platform === "win32" ? join(process.env.LOCALAPPDATA || os.homedir(), "flota-ocr", "venv") : join(engineDir, ".venv"));
const py = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");

// Variables del motor definidas en .env.local (OCR_*, QWEN_*, OLLAMA_*).
const env = { ...process.env, PYTHONUTF8: "1", PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True" };
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*((?:OCR|QWEN|OLLAMA)_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const cmd = process.argv[2] || "start";

if (cmd === "setup") {
  if (!existsSync(py)) {
    const base = process.platform === "win32" ? ["py", ["-3.12", "-m", "venv", venv]] : ["python3.12", ["-m", "venv", venv]];
    const r = spawnSync(base[0], base[1], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error("No se pudo crear el entorno. Instala Python 3.12 (PaddlePaddle aún no admite 3.13+).");
      process.exit(1);
    }
  }
  spawnSync(py, ["-m", "pip", "install", "--upgrade", "pip"], { stdio: "inherit" });
  const r = spawnSync(py, ["-m", "pip", "install", "-r", join(engineDir, "requirements.txt")], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (!existsSync(py)) {
  console.error(`No se encuentra el entorno del motor (${venv}). Ejecuta primero: npm run ocr:setup`);
  process.exit(1);
}

if (cmd === "test") {
  const r = spawnSync(py, ["-m", "pytest", "-q", "tests"], { cwd: engineDir, stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

console.log("Iniciando el motor local de reconocimiento (PaddleOCR) en http://127.0.0.1:" + (env.OCR_PORT || "8765"));
console.log("La primera vez descarga los modelos; después funciona sin Internet. Deja esta ventana abierta.");
const child = spawn(py, ["-m", "engine.server"], { cwd: engineDir, stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
