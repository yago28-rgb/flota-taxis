# Flota · Gestión y contabilidad de licencias de taxi

Aplicación web para el titular de varias licencias de taxi en Madrid: subir facturas (foto o PDF), leerlas automáticamente con un motor propio que funciona en el mismo equipo (PaddleOCR + reglas, sin APIs de IA de pago), revisarlas en pantalla dividida, registrar los movimientos, ver estadísticas por licencia, vehículo y conductor, y exportar a Excel.

No incluye datos de ejemplo ni reglas contables inventadas. Lo que todavía no se sabe (formato de las facturas reales, Excel actual, forma de calcular liquidaciones) queda **configurable** y señalado en la propia aplicación.

---

## 1. Decisiones técnicas

| Pieza | Elección | Motivo |
|---|---|---|
| Interfaz y servidor | **Next.js 16 (App Router) + React 19 + TypeScript** | Un único proyecto tipado de punta a punta. Las páginas se renderizan en el servidor (no se exponen consultas ni claves al navegador) y las mutaciones usan *server actions* con validación. |
| Estilos | **Tailwind CSS 4** con tokens propios | Diseño sobrio tipo Apple: tipografía del sistema, superficies, modo claro/oscuro, móvil primero (barra inferior con botón de subida). |
| Base de datos | **PostgreSQL** con **Drizzle ORM** y migraciones SQL versionadas (`drizzle/`) | Relacional, con claves foráneas, `CHECK`, índices únicos parciales (p. ej. un solo vehículo vigente por licencia) y transacciones. |
| BD local sin instalación | **PGlite** (PostgreSQL embebido) si no hay `DATABASE_URL` | Para arrancar en un portátil sin instalar nada. En producción, PostgreSQL de servidor: el mismo SQL y las mismas migraciones. |
| Importes | Enteros en **céntimos** | Sin errores de coma flotante. |
| Reconocimiento | Servicio local en Python (`ocr-engine/`): **PaddleOCR** (detección + reconocimiento de texto, PP-StructureV3 para tablas) + **reglas propias** + **Qwen2.5-VL 3B opcional** vía Ollama | Sin claves de API, sin coste por factura, sin enviar documentos fuera del equipo y funcionando sin Internet. La aplicación sólo conoce el contrato `ExtractionResult` (`src/lib/extraction/types.ts`), validado con Zod: el motor se puede cambiar sin tocar nada más. |
| Excel | **ExcelJS** | Formato real: encabezados, filtros, paneles fijos, formatos de moneda y fecha, totales con `SUBTOTAL`. |
| Gráficos | **Recharts** con paleta validada para daltonismo, leyenda y vista de tabla | |
| Autenticación | Contraseñas **bcrypt**, sesión **JWT firmada** en cookie `httpOnly`/`SameSite=Lax`, bloqueo tras 5 intentos | Sin dependencias externas de identidad. |

## 2. Puesta en marcha

Requisitos: Node.js 20.9 o superior y, para la lectura automática, **Python 3.12** (PaddlePaddle aún no admite 3.13+).

```bash
npm install
cp .env.example .env.local      # y rellena SESSION_SECRET
npm run ocr:setup               # una vez: entorno de Python + PaddleOCR (~1,5 GB)
npm run ocr                     # terminal 1: motor de reconocimiento en 127.0.0.1:8765
npm run dev                     # terminal 2: http://localhost:3000
```

Genera `SESSION_SECRET` con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

La primera vez, la aplicación pide crear el **usuario administrador** (`/setup`). Después:

1. **Ajustes**: datos del titular (NIF, para distinguir facturas recibidas y emitidas) y **regla contable** (base o total de cada línea).
2. **Ajustes › Categorías**: crea tus conceptos de ingreso y gasto. No hay ninguno predefinido.
3. **Licencias, Vehículos, Conductores**: da de alta la flota y las asignaciones (con fecha de inicio; el historial se conserva).
4. **Subir factura**.

Otros comandos:

```bash
npm test            # pruebas unitarias (validaciones, formatos, plantillas)
npm run ocr:test    # pruebas de las reglas de extracción (Python)
npx tsx scripts/ocr-smoke.ts factura.pdf   # envía documentos al motor en marcha y valida el contrato
npm run typecheck   # TypeScript
npm run lint
npm run build && npm start   # producción
```

## 3. Lectura automática: motor local

```
Foto / PDF → app (Next.js) → motor local 127.0.0.1:8765 (ocr-engine)
                                ├─ PaddleOCR: texto + posición + confianza de cada fragmento
                                ├─ PP-StructureV3: tablas (sólo si no se reconocen líneas de detalle)
                                ├─ Reglas en Python: campos, importes, impuestos, líneas, NIF, matrículas, licencias
                                └─ Qwen2.5-VL 3B (opcional, Ollama local): sólo rellena huecos
           ← JSON (ExtractionResult) → validación en la app → revisión junto al original → confirmación → PostgreSQL
```

- **Sin APIs de pago ni claves.** Nada de Anthropic, OpenAI, Google, etc. La aplicación no hace llamadas a servicios externos para leer facturas; el motor sólo escucha en `127.0.0.1` y la app rechaza otra dirección salvo `OCR_ENGINE_ALLOW_REMOTE=1` (otro equipo de tu propia red).
- **Sin Internet** una vez descargados los modelos (la primera ejecución los baja a `%USERPROFILE%\.paddlex`). Nota: `paddlex` instala como dependencia la librería Python `openai`; el motor **no la usa** ni hace llamadas a ese servicio.
- **No inventa.** Sólo devuelve lo que está impreso. Un dato que no aparece queda vacío; las incoherencias (base + IVA ≠ total, NIF con dígito de control erróneo, líneas sin cabecera…) se avisan, no se corrigen. Cada valor lleva su confianza y el texto literal del que sale.
- **Nada se guarda sin validación:** la lectura sólo rellena un borrador; las validaciones de la app (apartado 4) se ejecutan siempre y la factura sólo cuenta tras confirmarla una persona.
- Rendimiento medido en este equipo (CPU Intel Core Ultra 7, sin GPU): 5–15 s por página.
- Si el motor está parado, la app **no simula** ninguna lectura: guarda el documento, registra la lectura como fallida con el motivo y permite introducir los datos a mano.

Opciones (en `.env.local`, ver `.env.example`): `OCR_MODE` (auto | ocr | structure), `OCR_DET_MODEL`/`OCR_REC_MODEL` (p. ej. modelos *mobile*, más rápidos), `OCR_UNWARP=1` (fotos muy curvadas).

**Windows Smart App Control**: bloquea algunos binarios sin firma de versiones muy recientes de librerías Python. `ocr-engine/requirements.txt` fija versiones que funcionan con él activado; no hace falta desactivarlo.

### Qwen2.5-VL (opcional, desactivado)

El conector está integrado pero desactivado. Sólo se consulta cuando faltan total, fecha o emisor, o los importes no cuadran; nunca sustituye un valor leído por el OCR y marca lo que aporta con confianza baja («Qwen2.5-VL local») para que se revise. En CPU tarda ~30–90 s por factura.

1. Instala Ollama (<https://ollama.com>) y ejecuta `ollama pull qwen2.5vl:3b`.
2. En `.env.local`: `QWEN_ENABLED=1`. Reinicia `npm run ocr`. **Ajustes** mostrará su estado.

### Cambiar o añadir un motor

- Otro OCR en Python: implementa `read() → OcrDocument` (`ocr-engine/engine/ocr.py`); las reglas no cambian.
- Otro servicio completo: implementa `ExtractionProvider` en `src/lib/extraction/`, regístralo en `index.ts` y selecciónalo con `EXTRACTION_PROVIDER=<id>`.

## 4. Flujo de una factura

1. **Subida**: foto (cámara del móvil), varias fotos de una factura (se unen en un PDF en el orden elegido) o un PDF. Se comprueba el tipo real del archivo (no la extensión), el tamaño (25 MB) y los duplicados exactos (huella SHA-256). El original se guarda sin modificar, fuera de la carpeta pública.
2. **Lectura** automática (si está configurada).
3. **Revisión** en pantalla dividida: original a la izquierda; a la derecha, cada campo con su confianza, el texto del documento del que procede, y resaltado si es dudoso o falla una validación.
4. **Validaciones**: obligatorios, fechas (inválidas, futuras, vencimiento previo, periodo invertido), base + impuestos − retenciones = total (±0,02 €), suma de líneas, cantidad × precio, categoría en cada línea, duplicados (mismo emisor y número; misma fecha y total), importe inusual frente a las facturas anteriores del emisor, mes cerrado.
   - Los **errores** sólo se pueden confirmar declarando expresamente que el documento es así.
5. **Confirmación**: crea un movimiento por línea (categoría, licencia, vehículo, conductor). Actualiza estadísticas y exportaciones.
6. Una factura confirmada no se edita: se **reabre** (sus movimientos se anulan, no se borran) y se vuelve a confirmar. Todo queda en el **Historial**.

## 5. Contabilidad: qué calcula y qué no

- Cada categoría tiene una naturaleza que define el usuario: **ingreso**, **gasto** o **neutro** (no computa).
- «Ingresos − gastos» se muestra sólo si hay ingresos registrados, y **no es un beneficio fiscal**.
- Facturación, cobros, ingresos y beneficio son conceptos distintos. Las liquidaciones con conductores **no se calculan** todavía: hay un campo en Ajustes para describir cómo las haces y configurarlas después con tus reglas reales.
- **Cierre de mes** (administrador): bloquea cambios en un mes ya presentado.

## 6. Adaptarla a tus documentos reales

- **Facturas reales**: súbelas tal cual. Las de ejemplo de `ocr-engine/samples/` son **sintéticas** (generadas para las pruebas); con facturas reales de tus proveedores se ajustan las reglas (`ocr-engine/engine/extractor.py`) y se añaden como pruebas. Las *Instrucciones adicionales para la lectura* de Ajustes sólo las usa Qwen si está activado.
- **Tu Excel actual**: en *Exportar › Mis plantillas › Nueva › Elegir .xlsx* se leen sus encabezados (el archivo no se guarda) y se sugiere qué dato va en cada columna. Las columnas sin equivalente se marcan para asignarlas o quitarlas.
- **Tus cálculos**: describe en Ajustes cómo calculas liquidaciones, porcentajes o cuotas. A partir de esa explicación se implementan como reglas configurables, sin suposiciones.

## 7. Seguridad y protección de datos (RGPD)

- Todas las páginas y APIs exigen sesión. Roles: **Administrador** (todo), **Gestión** (subir, revisar, registrar), **Consulta** (ver y exportar).
- Documentos servidos sólo a usuarios autenticados, con `nosniff`. Peticiones `POST` de API con comprobación de origen. Cabeceras de seguridad (HSTS en producción, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Claves y secretos **sólo** en variables de entorno; nunca en la base de datos ni en el navegador.
- **Minimización**: del conductor sólo nombre, un identificador interno y, opcionalmente, teléfono. Nada de DNI, dirección ni datos bancarios.
- **Trazabilidad**: cada alta, cambio, confirmación, anulación, exportación e inicio de sesión queda en `audit_events` con usuario, fecha y valores anteriores/nuevos. Nada se sobrescribe sin dejar constancia: los movimientos se anulan, las facturas se descartan y el original siempre se conserva.
- Como responsable del tratamiento: informa a los conductores del tratamiento de sus datos, y define (las facturas se procesan en tu propio equipo: no hay encargado de tratamiento para el reconocimiento) plazos de conservación (la normativa fiscal exige conservar facturas al menos 4 años; mercantil, 6).

## 8. Copias de seguridad

```bash
node scripts/backup.mjs ./backups
```

- Con `DATABASE_URL`: `pg_dump` en formato custom (restaurar con `pg_restore`).
- Con PGlite: copia de `data/pg` (detén la aplicación antes).
- Siempre: la carpeta de documentos originales.

Programa la copia a diario (Programador de tareas de Windows o `cron`) y guárdala **cifrada y fuera del servidor**.

## 9. Producción

- PostgreSQL gestionado (Supabase, Neon, RDS…) en `DATABASE_URL`. Las migraciones se aplican al arrancar (`AUTO_MIGRATE=true`) o con `npx drizzle-kit migrate`.
- `STORAGE_DIR` en un disco persistente y con copia. Para almacenamiento en la nube (S3), implementa `DocumentStorage` en `src/lib/storage.ts`.
- HTTPS obligatorio (la cookie de sesión es `Secure` en producción).

## 10. Estructura

```
drizzle/                 migraciones SQL
scripts/backup.mjs       copia de seguridad
src/db/schema.ts         modelo relacional
src/lib/extraction/      contrato de extracción y conector con el motor local
ocr-engine/engine/       motor local: ocr.py (PaddleOCR), extractor.py (reglas), qwen.py (opcional), server.py
ocr-engine/tests/        pruebas de las reglas · ocr-engine/samples/ generador de facturas sintéticas
scripts/ocr.mjs          npm run ocr | ocr:setup | ocr:test
src/lib/invoices/        subida, validaciones, revisión y confirmación
src/lib/finance.ts       consultas económicas
src/lib/export/          catálogo de campos y generación de Excel
src/lib/actions/         acciones de servidor (formularios)
src/app/(app)/           pantallas
src/app/api/             subida, lectura, documentos y exportación
tests/                   pruebas unitarias
```
